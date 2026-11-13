// Testes de contas, perfis e sessão. Rodar com: node --test tests/acesso.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const novoEspaco = () => {
  const g = new Map();
  return { g, getItem: (k) => (g.has(k) ? g.get(k) : null), setItem: (k, v) => { g.set(k, String(v)); }, removeItem: (k) => { g.delete(k); } };
};
globalThis.localStorage = novoEspaco();
globalThis.sessionStorage = novoEspaco();

require('../js/utilitarios.js');
require('../js/dados.js');
const { criarStore } = require('../js/store.js');
require('../js/backup.js');
require('../js/acesso.js');

const ADMIN = { nome: 'Ana', email: 'Ana@Casa.org', senha: 'senha-forte-1', aceitouTermos: true };
const agoraReal = Date.now;

test.beforeEach(() => {
  localStorage.g.clear();
  sessionStorage.g.clear();
  Date.now = agoraReal;
});

async function comPessoa(perfil) {
  await criarAdministrador(ADMIN);
  const { senhaProvisoria } = await criarConta({ nome: 'Bia', email: 'bia@casa.org', perfil });
  sair();
  return senhaProvisoria;
}

async function entrarComo(perfil) {
  const provisoria = await comPessoa(perfil);
  assert.equal((await trocarSenha('bia@casa.org', provisoria, 'senha-da-bia', false, true)).ok, true);
}

test('primeiro acesso cria administrador uma vez só e abre a sessão', async () => {
  assert.equal(temContas(), false);
  const r = await criarAdministrador(ADMIN);
  assert.equal(r.ok, true);
  assert.match(r.codigoRecuperacao, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal(contaAtual().perfil, 'administrador');
  assert.equal((await criarAdministrador({ ...ADMIN, email: 'outro@casa.org' })).ok, false);
});

test('primeiro acesso recusa dados ruins', async () => {
  assert.equal((await criarAdministrador({ ...ADMIN, nome: ' ' })).ok, false);
  assert.equal((await criarAdministrador({ ...ADMIN, email: 'ana' })).ok, false);
  assert.equal((await criarAdministrador({ ...ADMIN, senha: 'curta' })).ok, false);
  assert.equal(temContas(), false);
});

test('senha nunca fica guardada em texto aberto', async () => {
  await criarAdministrador(ADMIN);
  assert.ok(![...localStorage.g.values()].join('').includes(ADMIN.senha));
});

test('entra com e-mail em qualquer caixa e sai', async () => {
  await criarAdministrador(ADMIN);
  sair();
  assert.equal(contaAtual(), null);
  assert.equal((await entrar(' ANA@casa.ORG ', ADMIN.senha)).ok, true);
  assert.equal(contaAtual().nome, 'Ana');
});

test('senha errada e e-mail inexistente dão a mesma mensagem', async () => {
  await criarAdministrador(ADMIN);
  sair();
  const a = await entrar(ADMIN.email, 'errada-123');
  const b = await entrar('ninguem@casa.org', 'errada-123');
  assert.equal(a.ok, false);
  assert.equal(a.erro, b.erro);
});

test('5 erros bloqueiam por 15 minutos, mesmo com a senha certa', async () => {
  await criarAdministrador(ADMIN);
  sair();
  for (let i = 0; i < 4; i++) assert.match((await entrar(ADMIN.email, 'errada-123')).erro, /incorretos/);
  assert.match((await entrar(ADMIN.email, 'errada-123')).erro, /bloqueada/);
  assert.match((await entrar(ADMIN.email, ADMIN.senha)).erro, /bloqueada/);
  const t = agoraReal();
  Date.now = () => t + 16 * 60 * 1000;
  assert.equal((await entrar(ADMIN.email, ADMIN.senha)).ok, true);
});

test('acerto zera os erros anteriores', async () => {
  await criarAdministrador(ADMIN);
  sair();
  for (let i = 0; i < 4; i++) await entrar(ADMIN.email, 'errada-123');
  await entrar(ADMIN.email, ADMIN.senha);
  sair();
  for (let i = 0; i < 4; i++) assert.match((await entrar(ADMIN.email, 'errada-123')).erro, /incorretos/);
});

test('senha provisória não abre sessão até ser trocada', async () => {
  const provisoria = await comPessoa('voluntario');
  assert.deepEqual(await entrar('bia@casa.org', provisoria), { ok: true, trocarSenha: true });
  assert.equal(contaAtual(), null);
  assert.equal((await trocarSenha('bia@casa.org', provisoria, provisoria)).ok, false);
  assert.equal((await trocarSenha('bia@casa.org', 'errada-123', 'senha-da-bia')).ok, false);
  assert.equal((await trocarSenha('bia@casa.org', provisoria, 'senha-da-bia', false, true)).ok, true);
  assert.equal(contaAtual().nome, 'Bia');
  sair();
  assert.equal((await entrar('bia@casa.org', provisoria)).ok, false);
  assert.equal((await entrar('bia@casa.org', 'senha-da-bia')).ok, true);
});

test('sem "manter conectado" a sessão fica na aba; com ele, sobrevive e vence em 30 dias', async () => {
  await criarAdministrador(ADMIN);
  sair();
  await entrar(ADMIN.email, ADMIN.senha, false);
  assert.ok(sessionStorage.g.has('via-matris:sessao'));
  sair();
  await entrar(ADMIN.email, ADMIN.senha, true);
  assert.ok(localStorage.g.has('via-matris:sessao'));
  assert.ok(contaAtual());
  const t = agoraReal();
  Date.now = () => t + 31 * 24 * 60 * 60 * 1000;
  assert.equal(contaAtual(), null);
});

test('conta desativada perde a sessão e não entra mais', async () => {
  await entrarComo('voluntario');
  const bia = contaAtual();
  sair();
  await entrar(ADMIN.email, ADMIN.senha);
  assert.equal(alterarConta(bia.codigo, { ativo: false }).ok, true);
  sair();
  assert.match((await entrar('bia@casa.org', 'senha-da-bia')).erro, /desativada/);
});

test('sessão guardada com defeito é ignorada', () => {
  sessionStorage.setItem('via-matris:sessao', '{quebrado');
  assert.equal(contaAtual(), null);
});

test('código de recuperação troca a senha do administrador uma única vez', async () => {
  const { codigoRecuperacao } = await criarAdministrador(ADMIN);
  sair();
  assert.equal((await recuperarSenha(ADMIN.email, 'AAAA-AAAA-AAAA-AAAA', 'senha-nova-1')).ok, false);
  const r = await recuperarSenha(ADMIN.email, codigoRecuperacao.toLowerCase(), 'senha-nova-1');
  assert.equal(r.ok, true);
  assert.notEqual(r.codigoRecuperacao, codigoRecuperacao);
  sair();
  assert.equal((await recuperarSenha(ADMIN.email, codigoRecuperacao, 'senha-nova-2')).ok, false);
  assert.equal((await entrar(ADMIN.email, 'senha-nova-1')).ok, true);
});

test('código de recuperação não serve para quem não é administrador', async () => {
  const { codigoRecuperacao } = await criarAdministrador(ADMIN);
  await criarConta({ nome: 'Bia', email: 'bia@casa.org', perfil: 'financeiro' });
  sair();
  assert.equal((await recuperarSenha('bia@casa.org', codigoRecuperacao, 'senha-nova-1')).ok, false);
});

test('errar o código também conta para o bloqueio', async () => {
  await criarAdministrador(ADMIN);
  sair();
  let r;
  for (let i = 0; i < 5; i++) r = await recuperarSenha(ADMIN.email, 'ERRADO', 'senha-nova-1');
  assert.match(r.erro, /bloqueada/);
});

test('administrador redefine senha e tira o bloqueio de outra pessoa', async () => {
  await entrarComo('voluntario');
  const bia = contaAtual();
  sair();
  for (let i = 0; i < 5; i++) await entrar('bia@casa.org', 'errada-123');
  await entrar(ADMIN.email, ADMIN.senha);
  assert.equal(listarContas().find((c) => c.codigo === bia.codigo).bloqueada, true);
  const { senhaProvisoria } = await redefinirSenhaDe(bia.codigo);
  sair();
  assert.deepEqual(await entrar('bia@casa.org', senhaProvisoria), { ok: true, trocarSenha: true });
});

test('aparelho nunca fica sem administrador ativo', async () => {
  await criarAdministrador(ADMIN);
  const eu = contaAtual();
  assert.equal(alterarConta(eu.codigo, { ativo: false }).ok, false);
  assert.equal(alterarConta(eu.codigo, { perfil: 'voluntario' }).ok, false);
});

test('e-mail repetido não cria conta', async () => {
  await criarAdministrador(ADMIN);
  assert.equal((await criarConta({ nome: 'Outra', email: 'ANA@casa.org', perfil: 'financeiro' })).ok, false);
});

test('quem não é administrador não administra', async () => {
  await entrarComo('financeiro');
  assert.equal((await criarConta({ nome: 'X', email: 'x@casa.org', perfil: 'administrador' })).ok, false);
  assert.equal(alterarConta(contaAtual().codigo, { perfil: 'administrador' }).ok, false);
  assert.equal((await redefinirSenhaDe(contaAtual().codigo)).ok, false);
  assert.deepEqual(listarContas(), []);
  assert.deepEqual(lerAuditoria(), []);
});

const ENTRADAS = {
  doacao_item: { tipo: 'doacao_item', novoItem: { nome: 'Item de teste', categoria: 'Alimentos', unidade: 'kg', minimo: '1' }, quantidade: '5' },
  saida_item: { tipo: 'saida_item', itemId: 'nada', quantidade: '1' },
  entrada_dinheiro: { tipo: 'entrada_dinheiro', valor: '10,00', descricao: 'Bazar' },
};
const NEGADO = /perfil/;

for (const [perfil, negados, liberados] of [
  ['voluntario', ['entrada_dinheiro'], ['doacao_item']],
  ['almoxarifado', ['entrada_dinheiro'], ['doacao_item']],
  ['financeiro', ['doacao_item', 'saida_item'], ['entrada_dinheiro']],
]) {
  test(`perfil ${perfil}: as regras barram o que está fora do perfil`, async () => {
    await entrarComo(perfil);
    const s = criarStore({ permitir: pode });
    for (const t of negados) assert.match(s.registrar(ENTRADAS[t]).erro, NEGADO);
    for (const t of liberados) assert.equal(s.registrar(ENTRADAS[t]).ok, true);
    assert.match(s.apagarTudo(), NEGADO);
    assert.match(s.restaurarExemplo(), NEGADO);
  });
}

test('voluntário não desfaz; financeiro não desfaz estoque', async () => {
  await criarAdministrador(ADMIN);
  const adm = criarStore({ permitir: pode });
  adm.apagarTudo();
  const doacao = adm.registrar(ENTRADAS.doacao_item).movimento;
  await criarConta({ nome: 'Bia', email: 'bia@casa.org', perfil: 'voluntario' }).then(async ({ senhaProvisoria }) => {
    sair();
    await trocarSenha('bia@casa.org', senhaProvisoria, 'senha-da-bia', false, true);
  });
  assert.match(criarStore({ permitir: pode }).estornar(doacao.codigo).erro, NEGADO);
  const codigoBia = contaAtual().codigo;
  sair();
  await entrar(ADMIN.email, ADMIN.senha);
  alterarConta(codigoBia, { perfil: 'financeiro' });
  sair();
  await entrar('bia@casa.org', 'senha-da-bia');
  assert.match(criarStore({ permitir: pode }).estornar(doacao.codigo).erro, NEGADO);
});

test('sem sessão, nada é permitido', () => {
  const s = criarStore({ permitir: pode });
  assert.match(s.registrar(ENTRADAS.entrada_dinheiro).erro, NEGADO);
});

test('auditoria registra sem guardar senhas e tem limite', async () => {
  await criarAdministrador(ADMIN);
  sair();
  await entrar(ADMIN.email, 'minha-senha-errada');
  await entrar(ADMIN.email, ADMIN.senha);
  const log = lerAuditoria();
  assert.ok(log.some((l) => l.acao === 'Entrou no sistema' && l.quem === 'Ana'));
  assert.ok(log.some((l) => l.acao === 'Senha incorreta'));
  assert.ok(!JSON.stringify(log).includes('minha-senha-errada'));
  for (let i = 0; i < 210; i++) registrarAuditoria('x');
  assert.equal(lerAuditoria().length, 200);
});

test('contas não entram nas planilhas de backup', async () => {
  await criarAdministrador(ADMIN);
  const planilhas = ['itens', 'doacoes', 'dinheiro'].map(gerarPlanilha).join('');
  assert.ok(!planilhas.includes('ana@casa.org'));
});

test('falta de espaço ao criar conta devolve erro e não cria nada', async () => {
  const real = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('cheio'); };
  const r = await criarAdministrador(ADMIN);
  localStorage.setItem = real;
  assert.equal(r.ok, false);
  assert.equal(temContas(), false);
});

test('recados mostram as doações mais recentes, sem dinheiro nem doador', async () => {
  await criarAdministrador(ADMIN);
  const s = criarStore({ permitir: pode });
  s.apagarTudo();
  const hoje = dataDeHoje();
  s.registrar({ tipo: 'entrada_dinheiro', valor: '777,00', descricao: 'Bazar secreto', pessoa: 'Doador Rico' });
  s.registrar({ tipo: 'doacao_item', novoItem: { nome: 'Feijão', categoria: 'Alimentos', unidade: 'kg', minimo: '0' }, quantidade: '2', pessoa: 'Maria Doadora', descricao: 'Observação privada', data: hoje });
  s.registrar({ tipo: 'doacao_item', novoItem: { nome: 'Arroz', categoria: 'Alimentos', unidade: 'kg', minimo: '0' }, quantidade: '1', pessoa: 'Maria Doadora', data: hoje });
  const recados = recadosDaCasa();
  assert.deepEqual(recados[0], { titulo: 'Hoje', texto: 'Recebemos 1 kg de arroz.' });
  assert.equal(recados.length, 2);
  const tudo = JSON.stringify(recados);
  for (const proibido of ['777', 'R$', 'Bazar', 'Rico', 'Maria', 'privada']) assert.ok(!tudo.includes(proibido), proibido);
});

test('recados têm alternativa quando não há doações', async () => {
  await criarAdministrador(ADMIN);
  criarStore({ permitir: pode }).apagarTudo();
  assert.deepEqual(recadosDaCasa(), [{ titulo: 'Recados da casa', texto: 'As doações recebidas aparecem aqui.' }]);
});

test('o modo offline é registrado antes do login', () => {
  const fs = require('node:fs');
  const ler = (f) => fs.readFileSync(require('node:path').join(__dirname, '..', 'js', f), 'utf8');
  assert.ok(ler('login.js').includes('serviceWorker.register'));
  assert.ok(!ler('app.js').includes('serviceWorker.register'));
});

// A tabela de acessos combinada: o administrador vê tudo; cada um dos outros vê só a própria área.
const MATRIZ = {
  administrador: { inicio: true, estoque: true, registrar: true, historico: true, acessos: true, ver_estoque: true, ver_financeiro: true, desfazer: true },
  financeiro: { inicio: true, estoque: false, registrar: true, historico: true, acessos: false, ver_estoque: false, ver_financeiro: true, desfazer: true },
  almoxarifado: { inicio: true, estoque: true, registrar: true, historico: true, acessos: false, ver_estoque: true, ver_financeiro: false, desfazer: true },
  voluntario: { inicio: true, estoque: true, registrar: true, historico: false, acessos: false, ver_estoque: true, ver_financeiro: false, desfazer: false },
};

for (const [perfil, esperado] of Object.entries(MATRIZ)) {
  test(`matriz de acessos: ${perfil}`, async () => {
    if (perfil === 'administrador') await criarAdministrador(ADMIN);
    else await entrarComo(perfil);
    for (const [chave, valor] of Object.entries(esperado)) {
      const obtido = chave in PAGINAS ? podeVerPagina(chave) : pode(chave);
      assert.equal(obtido, valor, `${perfil} → ${chave}`);
    }
  });
}

test('página que não existe ou sem sessão não abre', async () => {
  assert.equal(podeVerPagina('inicio'), false); // ninguém entrou ainda
  await criarAdministrador(ADMIN);
  assert.equal(podeVerPagina('nao-existe'), false);
  assert.equal(podeVerPagina('constructor'), false); // nome que existe em todo objeto do JavaScript
});

test('endereço da página: vazio, antigo, malformado, inexistente e sem permissão', async () => {
  await entrarComo('voluntario');
  assert.deepEqual(paginaDoEndereco(''), { pagina: 'inicio' });
  assert.deepEqual(paginaDoEndereco('#/estoque'), { pagina: 'estoque' });
  assert.deepEqual(paginaDoEndereco('#despensa'), { pagina: 'estoque' }); // atalho da versão antiga
  assert.deepEqual(paginaDoEndereco('#/%E0'), { pagina: 'nao-encontrada' });
  assert.deepEqual(paginaDoEndereco('#/xyz'), { pagina: 'nao-encontrada' });
  assert.deepEqual(paginaDoEndereco('#/constructor'), { pagina: 'nao-encontrada' });
  assert.deepEqual(paginaDoEndereco('#/acessos'), { pagina: 'sem-permissao', pedida: 'acessos' });
  assert.deepEqual(paginaDoEndereco('#/historico'), { pagina: 'sem-permissao', pedida: 'historico' });
});

test('sessão vencida: nenhuma página abre', async () => {
  await criarAdministrador(ADMIN);
  assert.deepEqual(paginaDoEndereco('#/acessos'), { pagina: 'acessos' });
  const t = agoraReal();
  Date.now = () => t + 9 * 60 * 60 * 1000; // passou das 8 horas
  assert.equal(paginaDoEndereco('#/inicio').pagina, 'sem-permissao');
  assert.equal(pode('administrar'), false);
});

test('toque duplo em Cadastrar não cria duas contas com o mesmo e-mail', async () => {
  await criarAdministrador(ADMIN);
  const dados = { nome: 'Bia', email: 'bia@casa.org', perfil: 'voluntario' };
  const [a, b] = await Promise.all([criarConta(dados), criarConta(dados)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(listarContas().filter((c) => c.email === 'bia@casa.org').length, 1);
});

test('administrador gera um código de recuperação novo, e o antigo deixa de valer', async () => {
  const { codigoRecuperacao: antigo } = await criarAdministrador(ADMIN);
  assert.equal((await novoCodigoDeRecuperacao('senha-errada')).ok, false);
  const r = await novoCodigoDeRecuperacao(ADMIN.senha);
  assert.equal(r.ok, true);
  assert.notEqual(r.codigoRecuperacao, antigo);
  assert.ok(!JSON.stringify([...localStorage.g]).includes(r.codigoRecuperacao), 'o código não fica guardado em texto aberto');
  sair();
  assert.equal((await recuperarSenha(ADMIN.email, antigo, 'outra-senha-1')).ok, false);
  assert.equal((await recuperarSenha(ADMIN.email, r.codigoRecuperacao, 'outra-senha-1')).ok, true);
});

test('só o administrador gera código de recuperação', async () => {
  await entrarComo('financeiro');
  assert.equal((await novoCodigoDeRecuperacao('senha-da-bia')).ok, false);
});

test('armazenamento bloqueado pelo navegador não derruba a tela de entrada', () => {
  const guardados = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
  for (const nome of Object.keys(guardados)) {
    Object.defineProperty(globalThis, nome, { configurable: true, get() { throw new Error('SecurityError'); } });
  }
  try {
    assert.equal(contaAtual(), null);
    assert.equal(temContas(), false);
    assert.match(problemasDoArmazenamento()[0], /não deixa guardar/);
  } finally {
    for (const [nome, valor] of Object.entries(guardados)) Object.defineProperty(globalThis, nome, { configurable: true, writable: true, value: valor });
  }
});

test('a versão nova do app só assume quando o app é reaberto', () => {
  const sw = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sw.js'), 'utf8');
  // Com skipWaiting, o app.js novo chegava a uma página antiga depois do login, e o painel ficava em branco.
  assert.ok(!sw.includes('self.skipWaiting('));
});

// ---------- termos de uso ----------

const mexerNaConta = (email, mudar) => {
  const config = lerConfig();
  const lista = config.contas.map((c) => (c.email === email ? mudar({ ...c }) : c));
  salvarConfig({ contas: lista });
};

test('administrador só é criado com o aceite dos termos, que fica guardado com data', async () => {
  const sem = await criarAdministrador({ ...ADMIN, aceitouTermos: false });
  assert.equal(sem.ok, false);
  assert.match(sem.erro, /Termos de uso/);
  assert.equal(temContas(), false);
  assert.equal((await criarAdministrador({ ...ADMIN, aceitouTermos: 'sim' })).ok, false); // só true vale
  assert.equal((await criarAdministrador(ADMIN)).ok, true);
  assert.ok(contaAtual().termosAceitosEm);
  assert.ok(lerAuditoria().some((l) => l.acao === 'Aceitou os termos'));
});

test('no primeiro acesso, a senha provisória só vira senha nova com o aceite', async () => {
  const provisoria = await comPessoa('voluntario');
  const sem = await trocarSenha('bia@casa.org', provisoria, 'senha-da-bia');
  assert.equal(sem.ok, false);
  assert.match(sem.erro, /Termos de uso/);
  assert.equal(contaAtual(), null);
  assert.equal((await trocarSenha('bia@casa.org', provisoria, 'senha-da-bia', false, true)).ok, true);
  assert.equal(contaAtual().email, 'bia@casa.org');
  assert.ok(contaAtual().termosAceitosEm);
});

test('conta sem o aceite (de antes dos termos) sai da sessão e aceita na próxima entrada', async () => {
  await criarAdministrador(ADMIN);
  mexerNaConta('ana@casa.org', (c) => { delete c.termos; return c; });
  assert.equal(contaAtual(), null); // a sessão aberta deixa de valer
  const r = await entrar(ADMIN.email, ADMIN.senha);
  assert.equal(r.aceitarTermos, true);
  assert.equal(contaAtual(), null);
  assert.equal((await aceitarTermos(ADMIN.email, ADMIN.senha, false, false)).ok, false);
  assert.equal((await aceitarTermos(ADMIN.email, 'senha-errada-1', false, true)).ok, false);
  assert.equal((await aceitarTermos(ADMIN.email, ADMIN.senha, false, true)).ok, true);
  assert.equal(contaAtual().perfil, 'administrador');
});

test('termos com versão nova pedem um novo aceite', async () => {
  await criarAdministrador(ADMIN);
  mexerNaConta('ana@casa.org', (c) => ({ ...c, termos: { versao: '2000-01-01', em: '2000-01-01T00:00:00.000Z' } }));
  assert.equal(contaAtual(), null);
  assert.equal((await entrar(ADMIN.email, ADMIN.senha)).aceitarTermos, true);
  await aceitarTermos(ADMIN.email, ADMIN.senha, false, true);
  assert.equal(listarContas()[0].termosAceitosEm !== null, true);
  assert.equal(TERMOS_VERSAO, lerConfig().contas[0].termos.versao);
});

test('nenhum caminho abre a sessão sem o aceite, e as ações ficam com o nome de quem fez', async () => {
  const { codigoRecuperacao } = await criarAdministrador(ADMIN);
  await criarConta({ nome: 'Bia', email: 'bia@casa.org', perfil: 'financeiro' }).then(async ({ senhaProvisoria }) => {
    // Conta provisória não aceita termos sem antes criar a senha.
    assert.equal((await aceitarTermos('bia@casa.org', senhaProvisoria, false, true)).ok, false);
  });
  mexerNaConta('ana@casa.org', (c) => { delete c.termos; return c; });

  // (a) recuperar a senha com o código não abre o painel sem o aceite
  assert.equal((await recuperarSenha(ADMIN.email, codigoRecuperacao, 'senha-nova-1')).ok, true);
  assert.equal(contaAtual(), null);
  // (b) trocar a senha de conta comum sem aceitar também não
  assert.equal((await trocarSenha(ADMIN.email, 'senha-nova-1', 'senha-nova-2')).ok, true);
  assert.equal(contaAtual(), null);

  await aceitarTermos(ADMIN.email, 'senha-nova-2', false, true);
  const acoes = lerAuditoria();
  for (const acao of ['Recuperou a senha com o código', 'Trocou a senha']) {
    assert.equal(acoes.find((l) => l.acao === acao).quem, 'Ana', acao);
  }
});

// ---------- correções da auditoria de 13/11 ----------

test('administrador bloqueado se libera com o código de recuperação', async () => {
  const { codigoRecuperacao } = await criarAdministrador(ADMIN);
  sair();
  for (let i = 0; i < 5; i++) await entrar(ADMIN.email, 'errada-0000');
  const bloqueio = await entrar(ADMIN.email, ADMIN.senha);
  assert.match(bloqueio.erro, /código de recuperação/);
  // código errado com a conta bloqueada não piora nada; o certo libera
  assert.match((await recuperarSenha(ADMIN.email, 'ERRADO', 'senha-nova-1')).erro, /bloqueada/);
  const r = await recuperarSenha(ADMIN.email, `  ${codigoRecuperacao.toLowerCase().replace(/-/g, ' ')} `, 'senha-nova-1');
  assert.equal(r.ok, true);
  sair();
  assert.equal((await entrar(ADMIN.email, 'senha-nova-1')).ok, true);
});

test('sair encerra também a sessão de outra aba', async () => {
  await criarAdministrador(ADMIN);
  const outraAba = sessionStorage.getItem('via-matris:sessao');
  assert.ok(contaAtual());
  sair();
  sessionStorage.setItem('via-matris:sessao', outraAba); // a cópia que a outra aba guardava
  assert.equal(contaAtual(), null);
  assert.equal((await entrar(ADMIN.email, ADMIN.senha)).ok, true); // entrar de novo continua funcionando
  assert.ok(contaAtual());
});

test('só o administrador baixa ou restaura planilhas', async () => {
  await entrarComo('voluntario');
  const texto = 'Data;Movimento;Valor (R$);Descrição\n01/11/2026;Entrada;999999,00;x';
  const r = await restaurarArquivos([{ name: 'a.csv', size: texto.length, text: async () => texto, arrayBuffer: async () => new TextEncoder().encode(texto).buffer }]);
  assert.equal(r.ok, false);
  assert.match(r.erros[0], /administrador/);
  assert.equal(importarPlanilha('dinheiro', texto).ok, false);
  assert.equal((await baixarPlanilha('dinheiro')).ok, false);
});

test('recados da entrada ignoram registro incompleto em vez de travar', async () => {
  localStorage.setItem('via-matris:itens', JSON.stringify([{ codigo: 'x' }]));
  localStorage.setItem('via-matris:doacoes', JSON.stringify([{ codigo: 'd', tipo: 'doacao_item', itemId: 'x', quantidade: 1 }]));
  assert.doesNotThrow(() => recadosDaCasa());
});
