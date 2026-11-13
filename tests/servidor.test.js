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
const BANCO = {
  itens: [{ codigo: 'b1', nome: 'Arroz do banco', categoria: 'Alimentos', unidade: 'kg', quantidade: 2.5, minimo: 1, validade: null }],
  doacoes: [],
  dinheiro: [{ codigo: 'd1', tipo: 'entrada_dinheiro', data: '2026-11-01', valorCentavos: 5000, descricao: 'Doação', pessoa: 'Doador anônimo', criadoEm: '2026-11-01T10:00:00Z' }],
};
const PODE = {
  administrador: ['ver_estoque', 'doacao_item', 'saida_item', 'ver_financeiro', 'entrada_dinheiro', 'saida_dinheiro', 'historico', 'desfazer', 'administrar'],
  financeiro: ['ver_financeiro', 'entrada_dinheiro', 'saida_dinheiro', 'historico', 'desfazer'],
  voluntario: ['ver_estoque', 'doacao_item', 'saida_item'],
};
const json = (status, corpo) => ({ status, ok: status < 400, json: async () => corpo });
globalThis.fetch = async (caminho) => {
  pedidos.push(caminho);
  if (!servidorNoAr) throw new TypeError('Failed to fetch');
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

test('no modo servidor, registrar, desfazer, restaurar e apagar ficam desligados', async () => {
  await criarAdministrador(ADMIN);
  await puxarDoServidor({ email: ADMIN.email, senha: ADMIN.senha });
  assert.equal(pode('ver_estoque'), true);
  assert.equal(pode('administrar'), true);
  assert.equal(pode('doacao_item'), false);
  assert.equal(pode('desfazer'), false);
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

test('trocar a senha com o servidor fora do ar falha, para as senhas não ficarem diferentes', async () => {
  await puxarDoServidor({ email: 'ana@casa.org', senha: 'x' });
  servidorNoAr = false;
  assert.equal((await trocarSenhaNoServidor('a', 'b')).ok, false);
});

test('senha provisória que o servidor não conhece: avisa antes e nada é trocado', async () => {
  entrarAceita = false;
  const r = await conferirNoServidor('bia@casa.org', 'provisoria-1');
  assert.equal(r.ok, false);
  assert.match(r.erro, /nada foi trocado/);
  entrarAceita = true;
  assert.equal((await conferirNoServidor('bia@casa.org', 'provisoria-1')).ok, true);
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
