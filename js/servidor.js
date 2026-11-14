/*
 * servidor.js — puxa os dados do banco (back-end em Python, pasta backend/) para o aparelho.
 *
 * Como funciona:
 *   - No GitHub Pages ou abrindo o index.html direto, não existe servidor: nada muda, o app
 *     segue só com os dados do aparelho, como sempre.
 *   - Quando o site é aberto pelo servidor (python -m uvicorn backend.principal:app), é o SERVIDOR
 *     que confere e-mail e senha (entrarPeloServidor). A conta do aparelho vira uma cópia da conta do
 *     servidor (nome, perfil, termos), sem senha guardada. Depois, o app busca as coleções que o perfil
 *     pode ver e grava no aparelho pelo dados.js (substituirColecao). A tela continua lendo do dados.js, então o
 *     app.js e o store.js não mudam, e o app abre sem internet com a última cópia puxada.
 *   - Vale o perfil do servidor: a pessoa só vê e faz o que os dois perfis (aparelho e servidor) deixam.
 *   - Ao sair, a cópia dos dados do banco é apagada do aparelho; quem entrar depois recebe os dados dela.
 *   - Registrar e desfazer vão para o banco (gravarNoServidor, estornarNoServidor): o servidor confere
 *     as regras, grava e responde; depois o app puxa as coleções de novo. A cópia do aparelho continua
 *     só leitura (nada é lançado só nela), então nada se perde na próxima vez que os dados forem puxados.
 *
 * Precisa, carregados antes: dados.js e store.js. Usado por: acesso.js, login.js e app.js.
 */
(function () {
  'use strict';

  const ESPERA_MS = 8000;
  // Coleção do dados.js → permissão que o perfil precisa para recebê-la. Igual às rotas da API.
  const COLECOES = { itens: 'ver_estoque', doacoes: 'ver_estoque', dinheiro: 'ver_financeiro' };
  const falha = (erro) => ({ ok: false, servidor: true, erro });

  // Caminho relativo ("api/..."), para funcionar também se o site for publicado numa subpasta.
  async function pedir(caminho, opcoes = {}) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), ESPERA_MS);
    try {
      const resposta = await fetch(caminho, {
        credentials: 'same-origin',
        ...opcoes,
        headers: { 'Content-Type': 'application/json', ...(opcoes.headers || {}) },
        signal: controle.signal,
      });
      let corpo = null;
      try { corpo = await resposta.json(); } catch (e) { /* resposta sem JSON */ }
      return { status: resposta.status, corpo };
    } finally {
      clearTimeout(relogio);
    }
  }

  /** Este aparelho recebe os dados do banco? (Fica valendo mesmo sem internet, com a última cópia.) */
  function modoServidor() {
    const s = lerConfig().servidor;
    return Boolean(s && s.ativo);
  }

  /**
   * No modo servidor, vale o perfil do SERVIDOR: a pessoa só faz o que os dois perfis (aparelho e
   * servidor) deixam. (O servidor confere de novo em cada gravação.)
   */
  function bloqueadoPeloServidor(acao) {
    if (!modoServidor()) return false;
    const pode = lerConfig().servidor.pode;
    return !Array.isArray(pode) || !pode.includes(acao);
  }

  const MSG_FORA_DO_AR = 'Não foi possível falar com o servidor da casa, e é ele que confere a senha. ' +
    'Confira a internet e tente de novo em instantes.';
  const MSG_CONEXAO_CAIU = 'A conexão com o servidor caiu. Tente de novo.';

  // O servidor responde igual para senha errada, conta bloqueada ou desativada (não revela nada a quem é de fora).
  async function entrarNoServidor(email, senha, manter = false) {
    const r = await pedir('api/entrar', { method: 'POST', body: JSON.stringify({ email, senha, manter: Boolean(manter) }) });
    if (r.status === 200) return { ok: true };
    return { ...falha((r.corpo && r.corpo.erro) || 'O servidor recusou a entrada.'), campo: (r.corpo && r.corpo.campo) || null };
  }

  /**
   * Login com o servidor da casa: ele confere e-mail e senha, o app puxa os dados e a conta do aparelho
   * vira a cópia da conta do servidor (acesso.js: abrirSessaoDoServidor). A senha não fica no aparelho.
   * Devolve { ok: true }, { ok: false, erro, campo } ou { ok: false, semServidor: true } quando não há
   * servidor e o aparelho nunca usou um (GitHub Pages, arquivo local): aí vale a conta do aparelho.
   */
  async function entrarPeloServidor(email, senha, manter = false) {
    if (!(await temServidor())) {
      // Aparelho que já usa o servidor: sem ele, ninguém novo entra (a senha não fica no aparelho).
      return modoServidor() ? falha(MSG_FORA_DO_AR) : { ok: false, semServidor: true };
    }
    let entrou;
    try {
      entrou = await entrarNoServidor(email, senha, manter);
    } catch (e) {
      return falha(MSG_CONEXAO_CAIU);
    }
    if (!entrou.ok) return entrou;
    salvarConfig({ sairPendente: false }); // a sessão antiga do servidor foi trocada pela nova
    const puxado = await puxarDoServidor(null, email);
    if (!puxado.ok) return puxado;
    return abrirSessaoDoServidor(puxado.conta, manter);
  }

  /*
   * Senha provisória ou termos sem aceite: o servidor recusa a entrada com 403 e campo "senhaProvisoria"
   * ou "termos" (a tela de entrada mostra a tela certa). Estas duas funções resolvem a pendência no
   * servidor, conferindo e-mail e senha de novo, e depois entram normalmente.
   */
  async function resolverEEntrar(caminho, corpo, email, senhaParaEntrar, manter) {
    let r;
    try {
      r = await pedir(caminho, { method: 'POST', body: JSON.stringify(corpo) });
    } catch (e) {
      return falha(MSG_CONEXAO_CAIU);
    }
    if (r.status !== 200) {
      return { ...falha((r.corpo && r.corpo.erro) || 'O servidor recusou. Tente de novo.'), campo: (r.corpo && r.corpo.campo) || null };
    }
    return entrarPeloServidor(email, senhaParaEntrar, manter);
  }

  /** Primeiro acesso: troca a senha provisória pela da pessoa, com o aceite dos termos, e entra. */
  function definirSenhaPeloServidor(email, senhaAtual, novaSenha, aceitouTermos, manter = false) {
    return resolverEEntrar('api/definir-senha', { email, senhaAtual, novaSenha, aceitouTermos: aceitouTermos === true },
      email, novaSenha, manter);
  }

  /** Quem já tem senha própria aceita a versão atual dos termos e entra. */
  function aceitarTermosPeloServidor(email, senha, aceito, manter = false) {
    return resolverEEntrar('api/aceitar-termos', { email, senha, aceito: aceito === true }, email, senha, manter);
  }

  /** O servidor da casa responde agora? (A tela de entrada usa para escolher os textos.) */
  const servidorNoAr = () => temServidor();

  /**
   * No modo servidor, a senha existe só no servidor: trocar é só lá. Devolve { ok: true } ou { ok: false, erro, campo }.
   */
  async function trocarSenhaNoServidor(atual, nova) {
    if (!modoServidor()) return falha('Este aparelho não está ligado ao servidor da casa.');
    if (!(await temServidor())) return falha('Não foi possível falar com o servidor da casa. A senha não foi trocada; tente de novo quando houver conexão.');
    try {
      const r = await pedir('api/trocar-senha', { method: 'POST', body: JSON.stringify({ senhaAtual: atual, novaSenha: nova }) });
      if (r.status === 200) return { ok: true };
      if (r.status === 401) return falha('Sua sessão no servidor acabou. Saia e entre de novo para trocar a senha.');
      return { ...falha((r.corpo && r.corpo.erro) || 'O servidor não trocou a senha. Tente de novo.'), campo: (r.corpo && r.corpo.campo) || null };
    } catch (e) {
      return falha('A conexão com o servidor caiu. Tente de novo.');
    }
  }

  async function temServidor() {
    // Abrindo o arquivo direto ou no GitHub Pages não existe servidor: nem pergunta, para o
    // navegador não anotar um erro 404 no console a cada abertura.
    if (location.protocol === 'file:' || location.hostname.endsWith('github.io')) return false;
    try {
      const r = await pedir('api/saude');
      return r.status === 200 && Boolean(r.corpo) && r.corpo.servico === 'casa-via-matris';
    } catch (e) {
      return false; // sem internet ou servidor fora do ar: segue com o que está no aparelho
    }
  }

  /**
   * Entra no servidor (se vierem e-mail e senha) e traz os dados do banco para o aparelho.
   * Sem credenciais, usa a sessão do servidor que já estiver aberta (cookie).
   * A cada vez, a conta do aparelho é atualizada com a do servidor (nome e perfil podem ter mudado lá).
   * Devolve { ok: true, servidor: false } quando não há servidor (nada muda),
   * { ok: true, servidor: true, conta } quando puxou, ou { ok: false, servidor: true, erro }.
   */
  async function puxarDoServidor(credenciais = null, email = '') {
    email = String(email || (credenciais && credenciais.email) || '').trim().toLowerCase();
    if (!(await temServidor())) {
      if (!modoServidor()) return { ok: true, servidor: false };
      // Sem servidor, só abre com a cópia guardada se ela for desta mesma pessoa: nunca com os
      // dados (e o perfil do servidor) de quem usou o aparelho antes.
      const s = lerConfig().servidor;
      if (s.dono && s.dono === email && Array.isArray(s.pode) && s.pode.length) return { ok: true, servidor: false };
      limparCopia();
      return falha('Não foi possível falar com o servidor da casa. Confira a internet e tente de novo.');
    }
    try {
      if (credenciais) {
        const entrou = await entrarNoServidor(credenciais.email, credenciais.senha, credenciais.manter);
        if (!entrou.ok) return entrou;
        salvarConfig({ sairPendente: false }); // a sessão antiga foi trocada pela nova
      }
      const eu = await pedir('api/eu');
      if (eu.status === 401) return falha('Entre de novo para atualizar os dados do banco.');
      if (eu.status !== 200 || !eu.corpo || !Array.isArray(eu.corpo.pode)) return falha('O servidor não respondeu como esperado. Tente de novo.');
      // A sessão do servidor (cookie) vale para o navegador todo: se outra pessoa entrou em outra aba,
      // ela é de outra conta. Nunca grava aqui os dados de outra pessoa.
      if (email && String(eu.corpo.email || '').toLowerCase() !== email) {
        limparCopia();
        // outraConta: quem chama sai só do aparelho. Fechar a sessão do servidor derrubaria a outra pessoa.
        return { ...falha('O servidor está com a sessão de outra conta (talvez em outra aba). Entre de novo.'), outraConta: true };
      }

      const puxado = await puxarColecoes(eu.corpo.pode);
      if (!puxado.ok) return puxado;
      // "iniciado" impede o store.js de colocar os dados de exemplo por cima do banco vazio.
      salvarConfig({ iniciado: true, servidor: { ativo: true, dono: String(eu.corpo.email || '').toLowerCase(), perfil: eu.corpo.perfil, pode: eu.corpo.pode, atualizadoEm: new Date().toISOString() } });
      // A conta do aparelho segue a do servidor (perfil trocado lá vale aqui na próxima abertura).
      if (typeof espelharContaDoServidor === 'function') {
        const espelho = espelharContaDoServidor(eu.corpo);
        if (!espelho.ok) return falha(espelho.erro);
      }
      return { ok: true, servidor: true, conta: eu.corpo };
    } catch (e) {
      console.warn('Não foi possível puxar os dados do banco.', e);
      return falha('A conexão com o servidor caiu. Tente de novo.');
    }
  }

  /**
   * Busca as coleções que o perfil pode ver e troca a cópia do aparelho por elas.
   * Busca tudo antes de gravar: ou entram as três coleções, ou nenhuma muda.
   */
  async function puxarColecoes(pode) {
    const novas = {};
    for (const [colecao, permissao] of Object.entries(COLECOES)) {
      // Coleção que o perfil não pode ver fica vazia neste aparelho, e não com dado de outra pessoa.
      if (!pode.includes(permissao)) { novas[colecao] = []; continue; }
      const r = await pedir(`api/${colecao}`);
      if (r.status !== 200 || !Array.isArray(r.corpo)) return falha((r.corpo && r.corpo.erro) || 'Não foi possível buscar os dados do banco.');
      novas[colecao] = r.corpo;
    }
    for (const [colecao, lista] of Object.entries(novas)) {
      const gravado = substituirColecao(colecao, lista);
      if (!gravado.ok) return falha(gravado.erros[0]);
    }
    return { ok: true };
  }

  // ---------- gravar no banco ----------

  // Número digitado ("2,5") vira número (2.5). Se não for número, segue o texto: o servidor responde
  // com a mesma explicação do store.js ("Informe uma quantidade maior que zero.").
  function numeroOuTexto(valor) {
    const n = ViaMatris.quantidadeDeTexto(valor ?? '');
    return Number.isFinite(n) ? n : String(valor ?? '');
  }

  /** A entrada do formulário (a mesma do store.registrar) no formato da API: dinheiro em centavos. */
  function corpoDoMovimento(entrada) {
    const centavos = textoParaCentavos(entrada.valor);
    const corpo = {
      tipo: entrada.tipo, data: entrada.data || null, itemId: entrada.itemId || null,
      quantidade: numeroOuTexto(entrada.quantidade), validade: entrada.validade || null,
      valorCentavos: Number.isSafeInteger(centavos) ? centavos : null,
      descricao: entrada.descricao ?? '', pessoa: entrada.pessoa ?? '',
    };
    if (entrada.novoItem) {
      corpo.novoItem = {
        nome: entrada.novoItem.nome ?? '', categoria: entrada.novoItem.categoria ?? '', unidade: entrada.novoItem.unidade ?? '',
        minimo: numeroOuTexto(entrada.novoItem.minimo || '0'), // vazio vale 0, como no store.js
      };
    }
    return corpo;
  }

  /*
   * Manda a gravação. Deu certo: põe na cópia do aparelho o que o servidor gravou (a tela mostra na hora,
   * mesmo se a busca seguinte falhar) e puxa as coleções de novo, para trazer também o que outras
   * pessoas lançaram. Recusado: { ok: false, erro, campo }, com a explicação do servidor.
   */
  async function enviarGravacao(caminho, corpo) {
    let r;
    try {
      r = await pedir(caminho, { method: 'POST', body: JSON.stringify(corpo) });
    } catch (e) {
      // A resposta pode ter se perdido depois de o servidor gravar: melhor conferir do que lançar duas vezes.
      return falha('A conexão com o servidor caiu. Confira no Histórico se entrou antes de tentar de novo.');
    }
    if (r.status === 401) return falha('Sua sessão no servidor acabou. Saia e entre de novo.');
    if (r.status !== 200 || !r.corpo || !r.corpo.movimento) {
      return { ...falha((r.corpo && r.corpo.erro) || 'O servidor não gravou. Tente de novo.'), campo: (r.corpo && r.corpo.campo) || null };
    }
    const { movimento, item } = r.corpo;
    salvarRegistro('valorCentavos' in movimento ? 'dinheiro' : 'doacoes', movimento);
    if (item) salvarRegistro('itens', item);
    try {
      await puxarColecoes(lerConfig().servidor.pode || []);
    } catch (e) { /* sem conexão agora: a cópia já tem o que foi gravado; o resto vem na próxima vez */ }
    return { ok: true, movimento };
  }

  /** Registra no banco (o servidor confere as mesmas regras do store.js). Devolve como o store.registrar. */
  function gravarNoServidor(entrada) {
    return enviarGravacao('api/movimentos', corpoDoMovimento(entrada));
  }

  /** Desfaz no banco: o servidor grava o lançamento contrário. Devolve como o store.estornar. */
  function estornarNoServidor(codigo) {
    return enviarGravacao(`api/movimentos/${encodeURIComponent(codigo)}/estorno`, {});
  }

  /**
   * Fecha a sessão no servidor e apaga do aparelho a cópia dos dados do banco: a próxima pessoa
   * que usar o aparelho não fica com os dados de quem saiu (ela recebe os dela ao entrar).
   * keepalive: o pedido termina mesmo com a página recarregando logo depois.
   */
  /** Apaga do aparelho a cópia dos dados do banco (sem falar com o servidor). */
  function limparCopia() {
    if (!modoServidor()) return;
    Object.keys(COLECOES).forEach((colecao) => substituirColecao(colecao, []));
    salvarConfig({ servidor: { ...lerConfig().servidor, dono: '', pode: [] } });
  }

  /** A cópia guardada no aparelho é de outra pessoa (ou de ninguém)? */
  function copiaDeOutraPessoa(email) {
    if (!modoServidor()) return false;
    return lerConfig().servidor.dono !== String(email || '').trim().toLowerCase();
  }

  function sairDoServidor() {
    if (!modoServidor()) return;
    limparCopia();
    fecharSessaoNoServidor();
  }

  /**
   * POST api/sair. Se falhar (sem internet), anota e tenta de novo na próxima abertura: senão a
   * sessão do servidor (cookie) continuaria valendo neste navegador por horas.
   */
  function fecharSessaoNoServidor() {
    salvarConfig({ sairPendente: true });
    try {
      fetch('api/sair', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' } })
        .then((r) => { if (r.ok) salvarConfig({ sairPendente: false }); })
        .catch(() => { });
    } catch (e) { /* sem servidor: tenta na próxima abertura */ }
  }

  /** Na abertura, sem ninguém logado: termina um "Sair" que ficou pela metade por falta de internet. */
  function terminarSaidaPendente() {
    if (lerConfig().sairPendente) fecharSessaoNoServidor();
  }

  Object.assign(globalThis, { gravarNoServidor, estornarNoServidor, entrarPeloServidor, definirSenhaPeloServidor, aceitarTermosPeloServidor, servidorNoAr, modoServidor, limparCopia, copiaDeOutraPessoa, terminarSaidaPendente, bloqueadoPeloServidor, puxarDoServidor, sairDoServidor, trocarSenhaNoServidor });
})();
