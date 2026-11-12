/*
 * acesso.js — contas, perfis e sessão. Não mexe na tela: quem desenha é o login.js e o app.js.
 *
 * Segue o fluxo do mapa do projeto no FigJam (diagrama 3): sessão válida → conta bloqueada?
 * → senha correta? → 5 erros bloqueiam por 15 minutos → senha provisória exige nova senha.
 *
 * IMPORTANTE: enquanto não existir back-end, isto é um controle de quem usa o aparelho, não
 * um cofre. Os dados da casa continuam abertos no localStorage, e quem abrir as ferramentas
 * do navegador consegue ler ou burlar qualquer regra daqui. A proteção de verdade só existe
 * no servidor (Fase 3). Por isso as telas continuam pedindo para não registrar dados de
 * pessoas acolhidas.
 *
 * As contas ficam na "config" do dados.js. Assim não vão para as planilhas de backup.
 */
(function () {
  'use strict';

  const ESTOQUE = ['ver_estoque', 'doacao_item', 'saida_item'];
  const DINHEIRO = ['ver_financeiro', 'entrada_dinheiro', 'saida_dinheiro'];

  /**
   * Os 4 perfis do FigJam. Ainda são proposta: falta validar com a equipe da casa.
   * "resumo" é o que a pessoa vê na Visão geral; os textos aparecem na página Acessos.
   */
  const PERFIS = {
    administrador: {
      rotulo: 'Administrador', resumo: 'Vê e faz tudo, inclusive cadastrar pessoas e fazer backup.',
      pode: [...ESTOQUE, ...DINHEIRO, 'historico', 'desfazer', 'administrar'],
    },
    financeiro: {
      rotulo: 'Financeiro', resumo: 'Cuida do dinheiro: saldo, gráfico, entradas, despesas e o histórico do caixa. Não vê o estoque.',
      pode: [...DINHEIRO, 'historico', 'desfazer'],
    },
    almoxarifado: {
      rotulo: 'Almoxarifado', resumo: 'Cuida do estoque: itens, doações, saídas e o histórico do estoque. Não vê o dinheiro.',
      pode: [...ESTOQUE, 'historico', 'desfazer'],
    },
    voluntario: {
      rotulo: 'Voluntário', resumo: 'Consulta o estoque e registra doações e saídas de itens. Não vê dinheiro nem histórico, e não desfaz.',
      pode: ESTOQUE,
    },
  };

  /*
   * Cada página do painel e o que é preciso para abri-la (basta uma das permissões).
   * Esconder o link no menu é só conforto: quem digita o endereço cai em "Sem permissão".
   * No back-end, cada rota da API repete esta conferência e responde 403.
   */
  const PAGINAS = {
    inicio: { rotulo: 'Visão geral', precisa: [] },
    estoque: { rotulo: 'Estoque', precisa: ['ver_estoque'] },
    registrar: { rotulo: 'Registrar', precisa: ['doacao_item', 'saida_item', 'entrada_dinheiro', 'saida_dinheiro'] },
    historico: { rotulo: 'Histórico', precisa: ['historico'] },
    acessos: { rotulo: 'Acessos', precisa: ['administrar'] },
  };

  /*
   * Versão dos Termos de uso e do Aviso de privacidade (termos.html). Ao mudar o texto dos
   * termos, mude esta data: todo mundo precisa aceitar de novo na próxima entrada.
   */
  const TERMOS_VERSAO = '2026-11-12';

  const ITERACOES = 600000; // PBKDF2-SHA256, número recomendado pela OWASP
  const SENHA_MINIMA = 8;
  const SENHA_MAXIMA = 128;
  const MAX_ERROS = 5;
  const BLOQUEIO_MS = 15 * 60 * 1000;
  const SESSAO_CURTA_MS = 8 * 60 * 60 * 1000;
  const SESSAO_LONGA_MS = 30 * 24 * 60 * 60 * 1000;
  const LIMITE_AUDITORIA = 200;
  const CHAVE_SESSAO = 'via-matris:sessao';
  const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem I, L, O, 0 e 1, que se confundem
  const ERRO_LOGIN = 'E-mail ou senha incorretos.';

  const falha = (erro) => ({ ok: false, erro });
  const contas = () => { const c = lerConfig().contas; return Array.isArray(c) ? c : []; };
  const normalizar = (email) => String(email ?? '').trim().toLocaleLowerCase('pt-BR');
  const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 120;
  // Com cookies bloqueados, alguns navegadores dão erro só de olhar o armazenamento.
  const espaco = (nome) => { try { return globalThis[nome] || null; } catch (e) { return null; } };
  const sessaoGuardada = () => [espaco('sessionStorage'), espaco('localStorage')].filter(Boolean);

  function gravar(lista, extra = {}) {
    const r = salvarConfig({ contas: lista, ...extra });
    return r.ok ? { ok: true } : falha(r.erros[0]);
  }

  function aoAcaso(tamanho) {
    const bytes = crypto.getRandomValues(new Uint8Array(tamanho * 2));
    // Descarta o que passaria do múltiplo do alfabeto, para nenhuma letra sair mais que outra.
    const limite = 256 - (256 % ALFABETO.length);
    return [...bytes].filter((b) => b < limite).slice(0, tamanho).map((b) => ALFABETO[b % ALFABETO.length]).join('');
  }

  const paraHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const deHex = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));

  async function derivar(senha, sal, iteracoes) {
    const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
    return paraHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deHex(sal), iterations: iteracoes }, chave, 256));
  }

  async function novaSenhaGuardada(senha) {
    const sal = paraHex(crypto.getRandomValues(new Uint8Array(16)));
    return { sal, iteracoes: ITERACOES, hash: await derivar(senha, sal, ITERACOES) };
  }

  const confere = async (senha, g) => (await derivar(senha, g.sal, g.iteracoes)) === g.hash;

  function erroDaSenha(senha) {
    if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
    if (senha.length > SENHA_MAXIMA) return `A senha pode ter no máximo ${SENHA_MAXIMA} caracteres.`;
    return null;
  }

  function erroDosDados({ nome, email, perfil }) {
    if (!String(nome ?? '').trim()) return 'Informe o nome da pessoa.';
    if (!emailValido(normalizar(email))) return 'Informe um e-mail válido, como nome@exemplo.com.';
    if (!PERFIS[perfil]) return 'Escolha um perfil.';
    if (contas().some((c) => c.email === normalizar(email))) return 'Esse e-mail já tem uma conta.';
    return null;
  }

  function registrarAuditoria(acao, detalhe = '') {
    const quem = contaAtual()?.nome ?? '';
    const lista = [{ quando: new Date().toISOString(), quem, acao, detalhe }, ...(lerConfig().auditoria ?? [])];
    salvarConfig({ auditoria: lista.slice(0, LIMITE_AUDITORIA) }); // falhar aqui não pode impedir o uso
  }

  // Devolve o que a tela precisa, sem o hash da senha.
  function publica(c) {
    const { codigo, nome, email, perfil, ativo, provisoria, bloqueadoAte } = c;
    return {
      codigo, nome, email, perfil, ativo, provisoria: Boolean(provisoria), bloqueada: (bloqueadoAte ?? 0) > Date.now(),
      termosAceitosEm: aceitouOsTermos(c) ? c.termos.em : null,
    };
  }

  /** Aceitou a versão atual dos termos? Quem aceitou uma versão antiga precisa aceitar de novo. */
  const aceitouOsTermos = (conta) => conta?.termos?.versao === TERMOS_VERSAO;
  const aceiteDeAgora = () => ({ termos: { versao: TERMOS_VERSAO, em: new Date().toISOString() } });
  const ERRO_TERMOS = 'Para continuar, leia e marque que aceita os Termos de uso e o Aviso de privacidade.';

  function abrirSessao(conta, manter) {
    sair(false);
    const onde = manter ? espaco('localStorage') : (espaco('sessionStorage') ?? espaco('localStorage'));
    onde.setItem(CHAVE_SESSAO, JSON.stringify({ contaCodigo: conta.codigo, expiraEm: Date.now() + (manter ? SESSAO_LONGA_MS : SESSAO_CURTA_MS) }));
  }

  /** A conta da sessão aberta, ou null. Sessão vencida, conta desativada, provisória ou sem o aceite dos termos não contam. */
  function contaAtual() {
    for (const espaco of sessaoGuardada()) {
      let sessao = null;
      try { sessao = JSON.parse(espaco.getItem(CHAVE_SESSAO)); } catch (e) { /* tratada como sessão inexistente */ }
      if (!sessao) continue;
      const conta = contas().find((c) => c.codigo === sessao.contaCodigo);
      if (conta && conta.ativo && !conta.provisoria && aceitouOsTermos(conta) && sessao.expiraEm > Date.now()) return publica(conta);
      espaco.removeItem(CHAVE_SESSAO);
    }
    return null;
  }

  function pode(acao) {
    const conta = contaAtual();
    return Boolean(conta && PERFIS[conta.perfil]?.pode.includes(acao));
  }

  /** A pessoa da sessão pode abrir esta página? Página que não existe: não. */
  function podeVerPagina(pagina) {
    const p = Object.prototype.hasOwnProperty.call(PAGINAS, pagina) ? PAGINAS[pagina] : null;
    if (!p || !contaAtual()) return false;
    return !p.precisa.length || p.precisa.some(pode);
  }

  // Endereços da versão de página única, para atalhos salvos continuarem abrindo.
  const ENDERECOS_ANTIGOS = { resumo: 'inicio', despensa: 'estoque', usuarios: 'acessos', conteudo: 'inicio' };
  const tem = (objeto, chave) => Object.prototype.hasOwnProperty.call(objeto, chave);

  /**
   * Qual página abrir para um endereço como "#/estoque". Devolve { pagina } e, quando a pessoa
   * não pode ver a página pedida, { pagina: 'sem-permissao', pedida }.
   */
  function paginaDoEndereco(hash) {
    let nome = String(hash ?? '').replace(/^#\/?/, '');
    try { nome = decodeURIComponent(nome); } catch (e) { return { pagina: 'nao-encontrada' }; } // como #/%E0
    nome = nome || 'inicio';
    if (tem(ENDERECOS_ANTIGOS, nome)) nome = ENDERECOS_ANTIGOS[nome];
    if (!tem(PAGINAS, nome)) return { pagina: 'nao-encontrada' };
    return podeVerPagina(nome) ? { pagina: nome } : { pagina: 'sem-permissao', pedida: nome };
  }

  function sair(registrar = true) {
    if (registrar && contaAtual()) registrarAuditoria('Saiu do sistema');
    sessaoGuardada().forEach((espaco) => espaco.removeItem(CHAVE_SESSAO));
  }

  /** Primeira abertura neste aparelho: quem chega primeiro cria o administrador. */
  async function criarAdministrador({ nome, email, senha, aceitouTermos = false }) {
    if (contas().length) return falha('Este aparelho já tem um administrador.');
    const erro = erroDosDados({ nome, email, perfil: 'administrador' }) ?? erroDaSenha(senha) ?? (aceitouTermos === true ? null : ERRO_TERMOS);
    if (erro) return falha(erro);
    const codigoRecuperacao = gerarCodigoRecuperacao();
    const conta = {
      codigo: gerarCodigo(), nome: nome.trim().slice(0, 80), email: normalizar(email), perfil: 'administrador', ativo: true,
      provisoria: false, tentativas: 0, bloqueadoAte: 0, criadoEm: new Date().toISOString(), senha: await novaSenhaGuardada(senha),
      ...aceiteDeAgora(),
    };
    const salvo = gravar([conta], { recuperacao: await novaSenhaGuardada(codigoRecuperacao) });
    if (!salvo.ok) return salvo;
    abrirSessao(conta, false);
    registrarAuditoria('Criou a conta de administrador');
    registrarAuditoria('Aceitou os termos', `versão de ${TERMOS_VERSAO}`);
    return { ok: true, codigoRecuperacao };
  }

  const gerarCodigoRecuperacao = () => aoAcaso(16).match(/.{4}/g).join('-');

  // Conta os erros na conta e bloqueia ao chegar no limite.
  function contarErro(conta) {
    const lista = contas();
    const c = lista.find((x) => x.codigo === conta.codigo);
    c.tentativas = (c.tentativas ?? 0) + 1;
    const bloqueou = c.tentativas >= MAX_ERROS;
    if (bloqueou) { c.bloqueadoAte = Date.now() + BLOQUEIO_MS; c.tentativas = 0; }
    gravar(lista);
    registrarAuditoria(bloqueou ? 'Conta bloqueada por erros de senha' : 'Senha incorreta', c.nome);
    return bloqueou;
  }

  const minutosRestantes = (ate) => Math.max(1, Math.ceil((ate - Date.now()) / 60000));
  const erroDeBloqueio = (ate) => `Conta bloqueada por muitas tentativas. Tente de novo em ${minutosRestantes(ate)} min ou peça ajuda ao administrador.`;

  // Confere a senha na ordem do FigJam. Quem chama decide o que fazer depois.
  async function validar(email, senha) {
    const conta = contas().find((c) => c.email === normalizar(email));
    if (!conta) {
      // Gasta o mesmo tempo de uma conta real, para não revelar quais e-mails existem.
      await derivar(String(senha ?? ''), '00'.repeat(16), ITERACOES);
      registrarAuditoria('Tentativa de entrada recusada');
      return falha(ERRO_LOGIN);
    }
    if ((conta.bloqueadoAte ?? 0) > Date.now()) return falha(erroDeBloqueio(conta.bloqueadoAte));
    if (!(await confere(String(senha ?? ''), conta.senha))) {
      return contarErro(conta) ? falha(erroDeBloqueio(Date.now() + BLOQUEIO_MS)) : falha(ERRO_LOGIN);
    }
    if (!conta.ativo) return falha('Esta conta foi desativada. Fale com o administrador.');
    return { ok: true, conta };
  }

  function limparTentativas(conta, mudancas = {}) {
    const lista = contas();
    Object.assign(lista.find((c) => c.codigo === conta.codigo), { tentativas: 0, bloqueadoAte: 0 }, mudancas);
    return gravar(lista);
  }

  /** { ok: true, conta } | { ok: true, trocarSenha: true } | { ok: true, aceitarTermos: true } | { ok: false, erro } */
  async function entrar(email, senha, manter = false) {
    const r = await validar(email, senha);
    if (!r.ok) return r;
    const salvo = limparTentativas(r.conta);
    if (!salvo.ok) return salvo;
    if (r.conta.provisoria) return { ok: true, trocarSenha: true };
    if (!aceitouOsTermos(r.conta)) return { ok: true, aceitarTermos: true };
    abrirSessao(r.conta, manter);
    registrarAuditoria('Entrou no sistema');
    return { ok: true, conta: publica(r.conta) };
  }

  /**
   * Vale para a senha provisória e para quem quer trocar a própria senha. Exige a senha atual.
   * No primeiro acesso (senha provisória), a pessoa também precisa aceitar os termos.
   */
  async function trocarSenha(email, atual, nova, manter = false, aceitouTermos = false) {
    const erro = erroDaSenha(nova);
    if (erro) return falha(erro);
    if (nova === atual) return falha('A senha nova precisa ser diferente da atual.');
    const r = await validar(email, atual);
    if (!r.ok) return r;
    const aceitaAgora = !aceitouOsTermos(r.conta) && aceitouTermos === true;
    if (r.conta.provisoria && !aceitouOsTermos(r.conta) && !aceitaAgora) return falha(ERRO_TERMOS);
    const salvo = limparTentativas(r.conta, { senha: await novaSenhaGuardada(nova), provisoria: false, ...(aceitaAgora ? aceiteDeAgora() : {}) });
    if (!salvo.ok) return salvo;
    if (!contaAtual()) abrirSessao(r.conta, manter);
    registrarAuditoria('Trocou a senha');
    if (aceitaAgora) registrarAuditoria('Aceitou os termos', `versão de ${TERMOS_VERSAO}`);
    return { ok: true };
  }

  /** Quem já tem conta e ainda não aceitou esta versão dos termos. Confere a senha de novo. */
  async function aceitarTermos(email, senha, manter = false, aceitou = false) {
    if (aceitou !== true) return falha(ERRO_TERMOS);
    const r = await validar(email, senha);
    if (!r.ok) return r;
    if (r.conta.provisoria) return falha('Crie a sua senha antes de continuar.');
    const salvo = limparTentativas(r.conta, aceiteDeAgora());
    if (!salvo.ok) return salvo;
    abrirSessao(r.conta, manter);
    registrarAuditoria('Aceitou os termos', `versão de ${TERMOS_VERSAO}`);
    registrarAuditoria('Entrou no sistema');
    return { ok: true };
  }

  /** Só para administrador, com o código guardado na criação. O código usado é trocado por outro. */
  async function recuperarSenha(email, codigoInformado, nova) {
    const erro = erroDaSenha(nova);
    if (erro) return falha(erro);
    const conta = contas().find((c) => c.email === normalizar(email) && c.perfil === 'administrador' && c.ativo);
    const guardado = lerConfig().recuperacao;
    const codigo = String(codigoInformado ?? '').trim().toUpperCase();
    if (conta && (conta.bloqueadoAte ?? 0) > Date.now()) return falha(erroDeBloqueio(conta.bloqueadoAte));
    const certo = guardado && await confere(codigo, guardado);
    const ERRO = 'E-mail ou código de recuperação incorretos.';
    if (!conta || !certo) return conta && contarErro(conta) ? falha(erroDeBloqueio(Date.now() + BLOQUEIO_MS)) : falha(ERRO);

    const codigoRecuperacao = gerarCodigoRecuperacao();
    const lista = contas();
    Object.assign(lista.find((c) => c.codigo === conta.codigo), { senha: await novaSenhaGuardada(nova), provisoria: false, tentativas: 0, bloqueadoAte: 0 });
    const salvo = gravar(lista, { recuperacao: await novaSenhaGuardada(codigoRecuperacao) });
    if (!salvo.ok) return salvo;
    abrirSessao(conta, false);
    registrarAuditoria('Recuperou a senha com o código');
    return { ok: true, codigoRecuperacao };
  }

  /**
   * Troca o código de recuperação por um novo, mostrado uma vez. Para quem perdeu o papel ou
   * fechou a tela antes de anotar. Exige a senha atual, mesmo com a sessão aberta.
   */
  async function novoCodigoDeRecuperacao(senhaAtual) {
    const atual = contaAtual();
    if (!atual || !pode('administrar')) return semPermissao();
    const r = await validar(atual.email, senhaAtual);
    if (!r.ok) return r;
    limparTentativas(r.conta);
    const codigoRecuperacao = gerarCodigoRecuperacao();
    const salvo = salvarConfig({ recuperacao: await novaSenhaGuardada(codigoRecuperacao) });
    if (!salvo.ok) return falha(salvo.erros[0]);
    registrarAuditoria('Gerou novo código de recuperação');
    return { ok: true, codigoRecuperacao };
  }

  // ---------- administração ----------

  const semPermissao = () => falha('Só o administrador pode fazer isso.');
  const admins = (lista) => lista.filter((c) => c.perfil === 'administrador' && c.ativo);

  function listarContas() {
    return pode('administrar') ? contas().map(publica) : [];
  }

  /** Cadastra a pessoa com uma senha provisória, mostrada uma vez só. */
  async function criarConta({ nome, email, perfil }) {
    if (!pode('administrar')) return semPermissao();
    const erro = erroDosDados({ nome, email, perfil });
    if (erro) return falha(erro);
    const senhaProvisoria = aoAcaso(12);
    const conta = {
      codigo: gerarCodigo(), nome: nome.trim().slice(0, 80), email: normalizar(email), perfil, ativo: true,
      provisoria: true, tentativas: 0, bloqueadoAte: 0, criadoEm: new Date().toISOString(), senha: await novaSenhaGuardada(senhaProvisoria),
    };
    // Confere de novo: durante o cálculo da senha, um segundo toque pode ter cadastrado o mesmo e-mail.
    const erroDepois = erroDosDados({ nome, email, perfil });
    if (erroDepois) return falha(erroDepois);
    const salvo = gravar([...contas(), conta]);
    if (!salvo.ok) return salvo;
    registrarAuditoria('Cadastrou uma pessoa', `${conta.nome} (${PERFIS[perfil].rotulo})`);
    return { ok: true, senhaProvisoria };
  }

  /** Gera nova senha provisória e tira o bloqueio: é a saída para quem esqueceu a senha. */
  async function redefinirSenhaDe(codigo) {
    if (!pode('administrar')) return semPermissao();
    const conta = contas().find((c) => c.codigo === codigo);
    if (!conta) return falha('Essa conta não existe mais.');
    if (conta.codigo === contaAtual().codigo) return falha('Para mudar a sua senha, use Trocar senha.');
    const senhaProvisoria = aoAcaso(12);
    const salvo = limparTentativas(conta, { senha: await novaSenhaGuardada(senhaProvisoria), provisoria: true });
    if (!salvo.ok) return salvo;
    registrarAuditoria('Gerou senha provisória', conta.nome);
    return { ok: true, senhaProvisoria };
  }

  /** Muda perfil ou ativa e desativa. Nunca deixa o aparelho sem administrador ativo. */
  function alterarConta(codigo, mudancas) {
    if (!pode('administrar')) return semPermissao();
    const lista = contas();
    const conta = lista.find((c) => c.codigo === codigo);
    if (!conta) return falha('Essa conta não existe mais.');
    if (mudancas.perfil !== undefined && !PERFIS[mudancas.perfil]) return falha('Escolha um perfil.');
    const novaLista = lista.map((c) => (c === conta ? { ...c, ...mudancas } : c));
    if (!admins(novaLista).length) return falha('É preciso manter ao menos um administrador ativo.');
    const salvo = gravar(novaLista);
    if (salvo.ok) registrarAuditoria('Alterou uma conta', conta.nome);
    return salvo;
  }

  function lerAuditoria() {
    return pode('administrar') ? [...(lerConfig().auditoria ?? [])] : [];
  }

  /*
   * Recados da tela de entrada. Ela aparece antes do login, então só usa doações de itens e o
   * número de itens em falta: nunca dinheiro, nem quem doou ou observações.
   */
  function recadosDaCasa() {
    const itens = new Map(lerTudo('itens').map((i) => [i.codigo, i]));
    const quando = (data) => {
      const dias = -diasAte(data);
      return dias === 0 ? 'Hoje' : dias === 1 ? 'Ontem' : dataCurta(data);
    };
    const nomeNaFrase = (nome) => nome.charAt(0).toLocaleLowerCase('pt-BR') + nome.slice(1);
    const recados = lerTudo('doacoes')
      .filter((m) => m.tipo === 'doacao_item' && itens.has(m.itemId))
      .reverse() // no mesmo instante, a gravada por último vem primeiro
      .sort((a, b) => b.data.localeCompare(a.data) || String(b.criadoEm).localeCompare(String(a.criadoEm)))
      .slice(0, 2)
      .map((m) => {
        const item = itens.get(m.itemId);
        return { titulo: quando(m.data), texto: `Recebemos ${textoDaQuantidade(m.quantidade, item.unidade)} de ${nomeNaFrase(item.nome)}.` };
      });
    if (recados.length < 2) {
      const emFalta = [...itens.values()].filter((i) => i.quantidade <= i.minimo).length;
      if (emFalta) recados.push({ titulo: 'Estoque', texto: `${emFalta} ${emFalta === 1 ? 'item precisa' : 'itens precisam'} de reposição.` });
    }
    return recados.length ? recados : [{ titulo: 'Recados da casa', texto: 'As doações recebidas aparecem aqui.' }];
  }

  Object.assign(globalThis, {
    TERMOS_VERSAO, aceitarTermos,
    recadosDaCasa, PERFIS, PAGINAS, podeVerPagina, paginaDoEndereco, SENHA_MINIMA, temContas: () => contas().length > 0, contaAtual, pode, entrar, sair, trocarSenha, recuperarSenha,
    criarAdministrador, novoCodigoDeRecuperacao, listarContas, criarConta, redefinirSenhaDe, alterarConta, lerAuditoria, registrarAuditoria,
  });
})();
