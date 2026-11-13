/*
 * servidor.js — puxa os dados do banco (back-end em Python, pasta backend/) para o aparelho.
 *
 * Como funciona:
 *   - No GitHub Pages ou abrindo o index.html direto, não existe servidor: nada muda, o app
 *     segue só com os dados do aparelho, como sempre.
 *   - Quando o site é aberto pelo servidor (python -m uvicorn backend.principal:app), depois do
 *     login o app entra também no servidor, busca as coleções que o perfil pode ver e grava no
 *     aparelho pelo dados.js (substituirColecao). A tela continua lendo do dados.js, então o
 *     app.js e o store.js não mudam, e o app abre sem internet com a última cópia puxada.
 *   - Vale o perfil do servidor: a pessoa só vê e faz o que os dois perfis (aparelho e servidor) deixam.
 *   - Ao sair, a cópia dos dados do banco é apagada do aparelho; quem entrar depois recebe os dados dela.
 *   - Nesta primeira etapa o banco só é LIDO. Por isso, no modo servidor, registrar e desfazer
 *     ficam desligados (o acesso.js consulta modoServidor()): o que fosse lançado só no aparelho
 *     seria apagado na próxima vez que os dados fossem puxados. Gravar no banco é a próxima etapa.
 *
 * Precisa, carregado antes: dados.js. Usado por: acesso.js e login.js.
 */
(function () {
  'use strict';

  const ESPERA_MS = 8000;
  // Coleção do dados.js → permissão que o perfil precisa para recebê-la. Igual às rotas da API.
  const COLECOES = { itens: 'ver_estoque', doacoes: 'ver_estoque', dinheiro: 'ver_financeiro' };
  // O que fica desligado enquanto o banco só pode ser lido.
  const ACOES_QUE_GRAVAM = ['doacao_item', 'saida_item', 'entrada_dinheiro', 'saida_dinheiro', 'desfazer'];

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
   * servidor) deixam. E ações que gravam ficam desligadas até a API aceitar gravações.
   */
  function bloqueadoPeloServidor(acao) {
    if (!modoServidor()) return false;
    const pode = lerConfig().servidor.pode;
    return ACOES_QUE_GRAVAM.includes(acao) || !Array.isArray(pode) || !pode.includes(acao);
  }

  // O servidor responde igual para senha errada, conta bloqueada ou desativada (não revela nada a quem é de fora).
  const MSG_SENHA_DIFERENTE = 'O servidor da casa não aceitou esta entrada. A senha precisa ser a mesma no aparelho e no servidor, ' +
    'e a conta do servidor pode estar bloqueada por tentativas erradas (espere 15 minutos) ou desativada. ' +
    'Se continuar, peça a quem cuida do servidor da casa para conferir a sua conta.';

  async function entrarNoServidor(email, senha, manter = false) {
    const r = await pedir('api/entrar', { method: 'POST', body: JSON.stringify({ email, senha, manter: Boolean(manter) }) });
    if (r.status === 200) return { ok: true };
    // A senha já foi aceita no aparelho: se o servidor recusou com 401, as duas senhas estão diferentes.
    const erro = r.corpo && r.corpo.erro;
    return falha(r.status === 401 && erro === 'E-mail ou senha incorretos.' ? MSG_SENHA_DIFERENTE : erro || 'O servidor recusou a entrada.');
  }

  /**
   * Troca a senha no servidor (quem chama troca a do aparelho também). Sem servidor, não faz nada.
   * Devolve { ok: true } ou { ok: false, erro }.
   */
  async function trocarSenhaNoServidor(atual, nova) {
    if (!modoServidor()) return { ok: true };
    // Sem resposta do servidor, trocar só no aparelho deixaria as duas senhas diferentes.
    if (!(await temServidor())) return falha('Não foi possível falar com o servidor da casa. A senha não foi trocada; tente de novo quando houver conexão.');
    try {
      const r = await pedir('api/trocar-senha', { method: 'POST', body: JSON.stringify({ senhaAtual: atual, novaSenha: nova }) });
      if (r.status === 200) return { ok: true };
      if (r.status === 401) return falha('Sua sessão no servidor acabou. Saia e entre de novo para trocar a senha.');
      return falha((r.corpo && r.corpo.erro) || 'O servidor não trocou a senha. Tente de novo.');
    } catch (e) {
      return falha('A conexão com o servidor caiu. Tente de novo.');
    }
  }

  /**
   * Antes de trocar a senha provisória no aparelho: o servidor aceita esta conta com a provisória?
   * Se não aceitar, nada muda em lugar nenhum (antes, o aparelho trocava e a pessoa ficava presa).
   * Sem servidor (GitHub Pages), responde { ok: true }.
   */
  async function conferirNoServidor(email, senha) {
    if (!(await temServidor())) return { ok: true };
    try {
      const r = await entrarNoServidor(email, senha);
      if (r.ok) return r;
      return falha('A sua conta ainda não está pronta no servidor da casa com esta senha provisória. ' +
        'Peça ao administrador para conferir; nada foi trocado.');
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
   * credenciais.novaSenha: primeiro acesso com senha provisória; entra com a provisória e troca no servidor.
   * Devolve { ok: true, servidor: false } quando não há servidor (nada muda),
   * { ok: true, servidor: true } quando puxou, ou { ok: false, servidor: true, erro }.
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
        if (credenciais.novaSenha) {
          const r = await pedir('api/trocar-senha', { method: 'POST', body: JSON.stringify({ senhaAtual: credenciais.senha, novaSenha: credenciais.novaSenha }) });
          if (r.status !== 200) return falha((r.corpo && r.corpo.erro) || 'O servidor não trocou a senha.');
        }
      }
      const eu = await pedir('api/eu');
      if (eu.status === 401) return falha('Entre de novo para atualizar os dados do banco.');
      if (eu.status !== 200 || !eu.corpo || !Array.isArray(eu.corpo.pode)) return falha('O servidor não respondeu como esperado. Tente de novo.');
      // A sessão do servidor (cookie) vale para o navegador todo: se outra pessoa entrou em outra aba,
      // ela é de outra conta. Nunca grava aqui os dados de outra pessoa.
      if (email && String(eu.corpo.email || '').toLowerCase() !== email) {
        limparCopia();
        return falha('O servidor está com a sessão de outra conta (talvez em outra aba). Entre de novo.');
      }

      // Busca tudo antes de gravar: ou entram as três coleções, ou nenhuma muda.
      const novas = {};
      for (const [colecao, permissao] of Object.entries(COLECOES)) {
        // Coleção que o perfil não pode ver fica vazia neste aparelho, e não com dado de outra pessoa.
        if (!eu.corpo.pode.includes(permissao)) { novas[colecao] = []; continue; }
        const r = await pedir(`api/${colecao}`);
        if (r.status !== 200 || !Array.isArray(r.corpo)) return falha((r.corpo && r.corpo.erro) || 'Não foi possível buscar os dados do banco.');
        novas[colecao] = r.corpo;
      }
      for (const [colecao, lista] of Object.entries(novas)) {
        const gravado = substituirColecao(colecao, lista);
        if (!gravado.ok) return falha(gravado.erros[0]);
      }
      // "iniciado" impede o store.js de colocar os dados de exemplo por cima do banco vazio.
      salvarConfig({ iniciado: true, servidor: { ativo: true, dono: String(eu.corpo.email || '').toLowerCase(), perfil: eu.corpo.perfil, pode: eu.corpo.pode, atualizadoEm: new Date().toISOString() } });
      return { ok: true, servidor: true };
    } catch (e) {
      console.warn('Não foi possível puxar os dados do banco.', e);
      return falha('A conexão com o servidor caiu. Tente de novo.');
    }
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

  Object.assign(globalThis, { modoServidor, limparCopia, copiaDeOutraPessoa, conferirNoServidor, terminarSaidaPendente, bloqueadoPeloServidor, puxarDoServidor, sairDoServidor, trocarSenhaNoServidor });
})();
