// Testes do modo servidor (js/servidor.js), sem rede: o fetch é de mentira.
// Rodar com: node --test tests/servidor.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const novoEspaco = () => {
  const g = new Map();
  return { g, getItem: (k) => (g.has(k) ? g.get(k) : null), setItem: (k, v) => { g.set(k, String(v)); }, removeItem: (k) => { g.delete(k); } };
};
globalThis.localStorage = novoEspaco();
globalThis.sessionStorage = novoEspaco();
globalThis.location = { protocol: 'http:', hostname: 'localhost' };

// Servidor de mentira: respostas por rota, e uma lista dos pedidos feitos.
let servidorNoAr = true;
let contaDoServidor = null;
let pedidos = [];
let entrarAceita = true;
const BANCO_INICIAL = JSON.stringify({
  itens: [{ codigo: 'b1', nome: 'Arroz do banco', categoria: 'Alimentos', unidade: 'kg', quantidade: 2.5, minimo: 1, validade: null }],
  doacoes: [],
  dinheiro: [{ codigo: 'd1', tipo: 'entrada_dinheiro', data: '2026-11-01', valorCentavos: 5000, descricao: 'Doação', pessoa: 'Doador anônimo', criadoEm: '2026-11-01T10:00:00Z' }],
});
let BANCO = JSON.parse(BANCO_INICIAL);
const PODE = {
  administrador: ['ver_estoque', 'doacao_item', 'saida_item', 'ver_financeiro', 'entrada_dinheiro', 'saida_dinheiro', 'historico', 'desfazer', 'administrar'],
  financeiro: ['ver_financeiro', 'entrada_dinheiro', 'saida_dinheiro', 'historico', 'desfazer'],
  voluntario: ['ver_estoque', 'doacao_item', 'saida_item'],
};
const json = (status, corpo) => ({ status, ok: status < 400, json: async () => corpo });
// Gravações: o último corpo enviado a cada rota, e a resposta que a próxima gravação recebe (null = aceita).
let corpos = {};
let recusaDaGravacao = null;
let quedaNaGravacao = false;
let n = 0;
function aceitarGravacao(caminho, corpo) {
  if (caminho === 'api/movimentos') {
    const mov = { codigo: `s${++n}`, tipo: corpo.tipo, data: corpo.data || '2026-11-14', descricao: corpo.descricao, pessoa: corpo.pessoa, criadoEm: '2026-11-14T12:00:00.000Z' };
    if (corpo.tipo.endsWith('_dinheiro')) {
      mov.valorCentavos = corpo.valorCentavos;
      BANCO.dinheiro.push(mov);
      return json(200, { movimento: mov, item: null });
    }
    Object.assign(mov, { itemId: corpo.itemId, quantidade: corpo.quantidade, validadeAnterior: null });
    const item = BANCO.itens.find((i) => i.codigo === corpo.itemId);
    item.quantidade += corpo.tipo === 'doacao_item' ? corpo.quantidade : -corpo.quantidade;
    BANCO.doacoes.push(mov);
    return json(200, { movimento: mov, item: { ...item } });
  }
  // Desfazer: o contrário, ligado ao original por estornoDe.
  const codigo = decodeURIComponent(caminho.split('/')[2]);
  const original = BANCO.dinheiro.find((m) => m.codigo === codigo);
  if (!original) return json(404, { erro: 'Essa movimentação não existe mais.' });
  if (BANCO.dinheiro.some((m) => m.estornoDe === codigo)) return json(409, { erro: 'Essa movimentação já foi desfeita.' });
  const contrario = { ...original, codigo: `s${++n}`, tipo: original.tipo === 'entrada_dinheiro' ? 'saida_dinheiro' : 'entrada_dinheiro', descricao: `Desfeito: ${original.descricao}`, estornoDe: codigo };
  BANCO.dinheiro.push(contrario);
  return json(200, { movimento: contrario, item: null });
}
globalThis.fetch = async (caminho, opcoes = {}) => {
  pedidos.push(caminho);
  if (opcoes.body) corpos[caminho] = JSON.parse(opcoes.body);
  if (!servidorNoAr) throw new TypeError('Failed to fetch');
  if (caminho.startsWith('api/movimentos')) {
    if (quedaNaGravacao) throw new TypeError('Failed to fetch');
    if (recusaDaGravacao) return json(recusaDaGravacao.status, recusaDaGravacao.corpo);
    return aceitarGravacao(caminho, corpos[caminho] || {});
  }
  if (caminho === 'api/saude') return json(200, { ok: true, servico: 'casa-via-matris' });
  if (caminho === 'api/entrar') return entrarAceita ? json(200, { ok: true }) : json(401, { erro: 'E-mail ou senha incorretos.' });
  if (caminho === 'api/sair') return json(200, { ok: true });
  if (caminho === 'api/eu') return contaDoServidor ? json(200, contaDoServidor) : json(401, { erro: 'Sua sessão acabou.' });
  const colecao = caminho.replace('api/', '');
  return json(200, BANCO[colecao]);
};
const conta = (email, perfil) => ({ nome: 'X', email, perfil, pode: PODE[perfil] });

require('../js/utilitarios.js');
require('../js/dados.js');
const { criarStore } = require('../js/store.js');
require('../js/backup.js');
require('../js/servidor.js');
require('../js/acesso.js');

const ADMIN = { nome: 'Ana', email: 'ana@casa.org', senha: 'senha-forte-1', aceitouTermos: true };

test.beforeEach(() => {
  localStorage.g.clear();
  sessionStorage.g.clear();
  servidorNoAr = true;
  contaDoServidor = conta('ana@casa.org', 'administrador');
  pedidos = [];
  entrarAceita = true;
  BANCO = JSON.parse(BANCO_INICIAL);
  corpos = {};
  recusaDaGravacao = null;
  quedaNaGravacao = false;
});

test('sem servidor no ar e sem cópia, nada muda (como no GitHub Pages)', async () => {
  servidorNoAr = false;
  assert.deepEqual(await puxarDoServidor(null, 'ana@casa.org'), { ok: true, servidor: false });
  assert.equal(modoServidor(), false);
});

test('puxa do banco só o que o perfil do servidor pode ver', async () => {
  contaDoServidor = conta('ana@casa.org', 'financeiro');
  const r = await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  assert.equal(r.ok, true);
  assert.equal(modoServidor(), true);
  assert.deepEqual(lerTudo('itens'), []);
  assert.equal(lerTudo('dinheiro').length, 1);
  assert.ok(!pedidos.includes('api/itens'), 'o Financeiro nem pede o estoque');
});

test('no modo servidor, registrar e desfazer seguem o perfil do servidor; restaurar e apagar continuam desligados', async () => {
  await criarAdministrador(ADMIN);
  await puxarDoServidor({ email: ADMIN.email, senha: ADMIN.senha });
  assert.equal(pode('ver_estoque'), true);
  assert.equal(pode('administrar'), true);
  assert.equal(pode('doacao_item'), true);
  assert.equal(pode('desfazer'), true);
  const store = criarStore({ permitir: pode });
  assert.match(store.apagarTudo(), /perfil/);
  assert.match(store.restaurarExemplo(), /perfil/);
  assert.equal(lerTudo('itens').length, 1, 'a cópia do banco continua lá');
  const r = await restaurarArquivos([], () => {});
  assert.match(r.erros[0], /banco da casa/);
});

test('vale o perfil do servidor: Administrador no aparelho, Voluntário no servidor, não vê dinheiro', async () => {
  await criarAdministrador(ADMIN);
  contaDoServidor = conta('ana@casa.org', 'voluntario');
  await puxarDoServidor({ email: ADMIN.email, senha: ADMIN.senha });
  assert.equal(pode('ver_financeiro'), false);
  assert.equal(pode('administrar'), false);
  assert.deepEqual(lerTudo('dinheiro'), []);
});

test('sessão do servidor de outra conta (outra aba) não grava os dados dela aqui', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  contaDoServidor = conta('bia@casa.org', 'administrador');
  const r = await puxarDoServidor(null, 'ana@casa.org');
  assert.equal(r.ok, false);
  assert.deepEqual(lerTudo('itens'), [], 'a cópia antiga também sai');
  assert.equal(copiaDeOutraPessoa('ana@casa.org'), true);
});

test('servidor fora do ar: abre com a cópia só se ela for da mesma pessoa', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  servidorNoAr = false;
  assert.equal((await puxarDoServidor(null, 'ANA@casa.org')).ok, true);
  assert.equal(lerTudo('itens').length, 1);
  const outra = await puxarDoServidor({ email: 'bia@casa.org', senha: 'y' });
  assert.equal(outra.ok, false);
  assert.match(outra.erro, /servidor da casa/);
  assert.deepEqual(lerTudo('dinheiro'), [], 'a Bia não vê os dados da Ana');
});

test('sair apaga a cópia do banco e fecha a sessão no servidor', async () => {
  await criarAdministrador(ADMIN);
  await puxarDoServidor({ email: ADMIN.email, senha: ADMIN.senha });
  sair();
  assert.deepEqual(lerTudo('itens'), []);
  assert.deepEqual(lerTudo('dinheiro'), []);
  assert.ok(pedidos.includes('api/sair'));
});

test('recados da tela de entrada não mostram nada da cópia do banco', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  assert.ok(!JSON.stringify(recadosDaCasa()).includes('Arroz do banco'));
});

test('trocar a senha com o servidor fora do ar falha (a senha existe só no servidor)', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  servidorNoAr = false;
  assert.equal((await trocarSenhaNoServidor('a', 'b')).ok, false);
});

test('sair sem internet fecha a sessão do servidor na próxima abertura', async () => {
  await criarAdministrador(ADMIN);
  await puxarDoServidor({ email: ADMIN.email, senha: ADMIN.senha });
  servidorNoAr = false;
  sair();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(lerConfig().sairPendente, true);
  servidorNoAr = true;
  pedidos = [];
  terminarSaidaPendente();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(pedidos.includes('api/sair'));
  assert.equal(lerConfig().sairPendente, false);
});

// ---------- gravar pelo servidor (1.5.0) ----------

test('Voluntário no servidor registra itens, mas não desfaz nem lança dinheiro', async () => {
  await criarAdministrador(ADMIN);
  contaDoServidor = conta('ana@casa.org', 'voluntario');
  await puxarDoServidor({ email: ADMIN.email, senha: ADMIN.senha });
  assert.equal(pode('saida_item'), true);
  assert.equal(pode('desfazer'), false);
  assert.equal(pode('entrada_dinheiro'), false);
});

test('gravar no servidor manda dinheiro em centavos e a cópia recebe o que foi gravado', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  pedidos = [];
  const r = await gravarNoServidor({ tipo: 'entrada_dinheiro', valor: '1.234,56', descricao: 'Bazar', pessoa: '', data: '2026-11-14' });
  assert.equal(r.ok, true);
  assert.equal(corpos['api/movimentos'].valorCentavos, 123456);
  assert.equal(Number.isInteger(corpos['api/movimentos'].valorCentavos), true);
  assert.ok(lerTudo('dinheiro').some((m) => m.codigo === r.movimento.codigo && m.valorCentavos === 123456));
  assert.ok(pedidos.includes('api/dinheiro'), 'puxa as coleções de novo depois de gravar');
});

test('quantidade "2,5" vai como número; texto que não é número vai como texto, para o servidor explicar', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  const r = await gravarNoServidor({ tipo: 'doacao_item', itemId: 'b1', quantidade: '2,5', valor: '' });
  assert.equal(r.ok, true);
  assert.equal(corpos['api/movimentos'].quantidade, 2.5);
  assert.equal(corpos['api/movimentos'].valorCentavos, null);
  assert.equal(lerTudo('itens').find((i) => i.codigo === 'b1').quantidade, 5);
  recusaDaGravacao = { status: 422, corpo: { erro: 'Informe uma quantidade maior que zero.', campo: 'quantidade' } };
  await gravarNoServidor({ tipo: 'doacao_item', itemId: 'b1', quantidade: 'abc', novoItem: null });
  assert.equal(corpos['api/movimentos'].quantidade, 'abc');
  await gravarNoServidor({ tipo: 'doacao_item', quantidade: '1', novoItem: { nome: 'Feijão', categoria: 'Alimentos', unidade: 'kg', minimo: '' } });
  assert.equal(corpos['api/movimentos'].novoItem.minimo, 0, 'mínimo vazio vale 0, como no store.js');
});

test('servidor recusou: volta o erro e o campo, e a cópia do aparelho não muda', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  const antes = JSON.stringify(lerTudo('itens'));
  recusaDaGravacao = { status: 422, corpo: { erro: 'Só há 2,5 kg de Arroz do banco em estoque.', campo: 'quantidade' } };
  const r = await gravarNoServidor({ tipo: 'saida_item', itemId: 'b1', quantidade: '3' });
  assert.deepEqual(r, { ok: false, servidor: true, erro: 'Só há 2,5 kg de Arroz do banco em estoque.', campo: 'quantidade' });
  assert.equal(JSON.stringify(lerTudo('itens')), antes);
  recusaDaGravacao = { status: 401, corpo: { erro: 'Sua sessão acabou. Entre de novo.' } };
  assert.match((await gravarNoServidor({ tipo: 'saida_item', itemId: 'b1', quantidade: '1' })).erro, /sessão/);
});

test('a conexão caiu ao gravar: pede para conferir o Histórico antes de lançar de novo', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  quedaNaGravacao = true;
  const r = await gravarNoServidor({ tipo: 'entrada_dinheiro', valor: '10', descricao: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Histórico/);
});

test('desfazer no servidor traz o lançamento contrário; desfazer de novo é recusado', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  const r = await estornarNoServidor('d1');
  assert.equal(r.ok, true);
  assert.equal(r.movimento.estornoDe, 'd1');
  const dinheiro = lerTudo('dinheiro');
  assert.ok(dinheiro.some((m) => m.codigo === 'd1'), 'nada é apagado: o original continua');
  assert.ok(dinheiro.some((m) => m.estornoDe === 'd1' && m.tipo === 'saida_dinheiro'));
  const store = criarStore({ permitir: pode });
  assert.equal(store.resumo().saldoCentavos, 0);
  const outra = await estornarNoServidor('d1');
  assert.deepEqual(outra, { ok: false, servidor: true, erro: 'Essa movimentação já foi desfeita.', campo: null });
});

test('código com caracteres especiais vai codificado no endereço do desfazer', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  await estornarNoServidor('a/b?c');
  assert.ok(pedidos.includes('api/movimentos/a%2Fb%3Fc/estorno'));
});

// ---------- um login só: o servidor decide (1.5.0) ----------

const sessaoDaAba = () => globalThis.sessionStorage;
function trocarDeAba(aba) { globalThis.sessionStorage = aba; }

test('login pelo servidor: a conta do aparelho vira cópia da do servidor, sem senha guardada', async () => {
  contaDoServidor = { nome: 'Bia Souza', email: 'bia@casa.org', perfil: 'financeiro', pode: PODE.financeiro };
  const r = await entrarPeloServidor('Bia@Casa.org', 'senha-da-bia', false);
  assert.equal(r.ok, true);
  const atual = contaAtual();
  assert.equal(atual.email, 'bia@casa.org');
  assert.equal(atual.perfil, 'financeiro');
  assert.equal(atual.provisoria, false);
  assert.ok(atual.termosAceitosEm, 'o servidor só deixa entrar quem aceitou os termos');
  const guardada = lerConfig().contas.find((c) => c.email === 'bia@casa.org');
  assert.equal(guardada.senha, null, 'a senha não fica no aparelho');
  assert.ok(!JSON.stringify(lerConfig()).includes('senha-da-bia'));
  // Abrir a sessão do aparelho não pode derrubar a sessão do servidor nem apagar a cópia recém-puxada.
  assert.ok(!pedidos.includes('api/sair'));
  assert.equal(lerTudo('dinheiro').length, 1);
});

test('o perfil trocado no servidor vale no aparelho na próxima abertura', async () => {
  contaDoServidor = conta('bia@casa.org', 'administrador');
  await entrarPeloServidor('bia@casa.org', 'x');
  assert.equal(pode('administrar'), true);
  contaDoServidor = conta('bia@casa.org', 'voluntario');
  assert.equal((await puxarDoServidor(null, 'bia@casa.org')).ok, true);
  assert.equal(contaAtual().perfil, 'voluntario');
  assert.equal(pode('administrar'), false);
});

test('servidor recusou a senha: nada de cópia da conta nem sessão', async () => {
  entrarAceita = false;
  const r = await entrarPeloServidor('bia@casa.org', 'errada-123');
  assert.deepEqual(r, { ok: false, servidor: true, erro: 'E-mail ou senha incorretos.', campo: null });
  assert.equal(contaAtual(), null);
  assert.equal(temContas(), false);
});

test('com o servidor, a senha do aparelho não vale mais (nem para entrar, nem para trocar)', async () => {
  await criarAdministrador(ADMIN); // conta antiga do aparelho, com senha
  sair();
  await entrarPeloServidor(ADMIN.email, ADMIN.senha);
  sair();
  assert.match((await entrar(ADMIN.email, ADMIN.senha)).erro, /só no servidor/);
  assert.match((await trocarSenha(ADMIN.email, ADMIN.senha, 'outra-senha-9')).erro, /só no servidor/);
  assert.equal(contaAtual(), null);
});

test('com o servidor, contas não são criadas nem mudadas no aparelho', async () => {
  await entrarPeloServidor('ana@casa.org', 'x');
  assert.equal(pode('administrar'), true);
  for (const r of [await criarConta({ nome: 'Caio', email: 'caio@casa.org', perfil: 'voluntario' }),
    await redefinirSenhaDe(contaAtual().codigo), alterarConta(contaAtual().codigo, { perfil: 'voluntario' }),
    await novoCodigoDeRecuperacao('x'), await criarAdministrador(ADMIN), await recuperarSenha('ana@casa.org', 'X', 'nova-senha-1')]) {
    assert.equal(r.ok, false);
    assert.match(r.erro, /python -m backend\.usuarios/);
  }
  assert.equal(lerConfig().contas.length, 1);
});

test('login novo com o servidor fora do ar: mensagem clara, ninguém entra', async () => {
  await entrarPeloServidor('ana@casa.org', 'x'); // o aparelho já usa o servidor
  sair();
  servidorNoAr = false;
  const r = await entrarPeloServidor('ana@casa.org', 'x');
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'Não foi possível falar com o servidor da casa, e é ele que confere a senha. Confira a internet e tente de novo em instantes.');
  assert.equal(contaAtual(), null);
  assert.equal(await globalThis.servidorNoAr(), false, 'a tela de entrada também sabe que ele está fora');
});

test('a conexão cai no meio do login: mensagem clara, ninguém entra', async () => {
  const fetchDeVerdade = globalThis.fetch;
  globalThis.fetch = async (caminho, opcoes) => {
    if (caminho === 'api/entrar') throw new TypeError('Failed to fetch');
    return fetchDeVerdade(caminho, opcoes);
  };
  try {
    const r = await entrarPeloServidor('ana@casa.org', 'x');
    assert.equal(r.erro, 'A conexão com o servidor caiu. Tente de novo.');
    assert.equal(contaAtual(), null);
  } finally {
    globalThis.fetch = fetchDeVerdade;
  }
});

test('sem servidor e sem nunca ter usado um (GitHub Pages): a conta do aparelho continua valendo', async () => {
  servidorNoAr = false;
  assert.deepEqual(await entrarPeloServidor('ana@casa.org', 'x'), { ok: false, semServidor: true });
  await criarAdministrador(ADMIN);
  sair();
  assert.equal((await entrar(ADMIN.email, ADMIN.senha)).ok, true);
});

test('duas abas com contas diferentes: uma nunca fica com os dados da outra', async () => {
  const abaDaAna = sessaoDaAba();
  const abaDaBia = { ...abaDaAna, g: new Map() };
  abaDaBia.getItem = (k) => (abaDaBia.g.has(k) ? abaDaBia.g.get(k) : null);
  abaDaBia.setItem = (k, v) => { abaDaBia.g.set(k, String(v)); };
  abaDaBia.removeItem = (k) => { abaDaBia.g.delete(k); };
  try {
    // Aba 1: Ana (Administrador) entra e recebe o dinheiro.
    contaDoServidor = conta('ana@casa.org', 'administrador');
    assert.equal((await entrarPeloServidor('ana@casa.org', 'x')).ok, true);
    assert.equal(lerTudo('dinheiro').length, 1);

    // Aba 2: Bia (Voluntário) entra no mesmo navegador. O cookie do servidor agora é da Bia.
    trocarDeAba(abaDaBia);
    contaDoServidor = conta('bia@casa.org', 'voluntario');
    assert.equal((await entrarPeloServidor('bia@casa.org', 'y')).ok, true);
    assert.equal(contaAtual().email, 'bia@casa.org');
    assert.deepEqual(lerTudo('dinheiro'), [], 'o Voluntário não recebe dinheiro');

    // Volta à aba 1: a cópia é de outra pessoa, então a tela recarrega (app.js: conferirSessao) e puxa de novo.
    trocarDeAba(abaDaAna);
    assert.equal(contaAtual().email, 'ana@casa.org');
    assert.equal(copiaDeOutraPessoa('ana@casa.org'), true);
    const r = await puxarDoServidor(null, 'ana@casa.org');
    assert.equal(r.ok, false);
    assert.match(r.erro, /sessão de outra conta/);
    assert.equal(r.outraConta, true);
    assert.deepEqual(lerTudo('itens'), [], 'a Ana não vê a cópia da Bia');
    // A aba da Ana volta à entrada (login.js) sem fechar a sessão do servidor: ela é da Bia.
    pedidos = [];
    sair(false, { fecharServidor: !r.outraConta });
    await new Promise((fim) => setTimeout(fim, 0));
    assert.ok(!pedidos.includes('api/sair'), 'a Bia não é derrubada pela aba da Ana');
    assert.equal(contaAtual(), null);
    // A conta da Ana no aparelho continua com o perfil dela, e não com o da Bia.
    assert.equal(lerConfig().contas.find((c) => c.email === 'ana@casa.org').perfil, 'administrador');

    // Aba 2: a cópia foi limpa; ao recarregar, a Bia recebe os dados dela de novo.
    trocarDeAba(abaDaBia);
    assert.equal(copiaDeOutraPessoa('bia@casa.org'), true);
    assert.equal((await puxarDoServidor(null, 'bia@casa.org')).ok, true);
    assert.equal(lerTudo('itens').length, 1);
    assert.deepEqual(lerTudo('dinheiro'), []);
  } finally {
    trocarDeAba(abaDaAna);
  }
});
