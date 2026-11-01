// Testes das regras de negócio. Rodar com: node --test tests/store.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// localStorage de mentira, igual ao do navegador.
const guardado = new Map();
globalThis.localStorage = {
  getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
  setItem: (k, v) => { guardado.set(k, String(v)); },
  removeItem: (k) => { guardado.delete(k); },
};

require('../js/utilitarios.js');
require('../js/dados.js');
const { criarStore, quantidadeDeTexto } = require('../js/store.js');
require('../js/backup.js');

test.beforeEach(() => guardado.clear());

function emDias(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return textoParaData(`${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`);
}

test('converte reais em centavos sem erro de ponto flutuante', () => {
  assert.equal(textoParaCentavos('1.234,56'), 123456);
  assert.equal(textoParaCentavos('0,10'), 10);
  assert.equal(textoParaCentavos('R$ 50'), 5000);
  assert.equal(textoParaCentavos('19.90'), 1990);
  assert.equal(textoParaCentavos('1.000'), 100000); // mil reais escrito com ponto
  assert.ok(Number.isNaN(textoParaCentavos('1,999'))); // centavo tem só duas casas
  assert.ok(Number.isNaN(textoParaCentavos('abc')));
  assert.ok(Number.isNaN(textoParaCentavos('-5')));
  assert.ok(Number.isNaN(textoParaCentavos('99999999999999999999,00'))); // grande demais para ser exato
  assert.equal(centavosParaTexto(189900), '1.899,00');
});

test('doação soma e saída baixa o estoque', () => {
  const s = criarStore();
  const antes = s.item('arroz').quantidade;
  assert.ok(s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: '2,5' }).ok);
  assert.equal(s.item('arroz').quantidade, antes + 2.5);
  assert.ok(s.registrar({ tipo: 'saida_item', itemId: 'arroz', quantidade: 2.5 }).ok);
  assert.equal(s.item('arroz').quantidade, antes);
});

test('não deixa sair mais do que existe', () => {
  const s = criarStore();
  const r = s.registrar({ tipo: 'saida_item', itemId: 'cafe', quantidade: 999 });
  assert.equal(r.ok, false);
  assert.equal(s.item('cafe').quantidade, 2);
});

test('não deixa gastar mais do que o saldo e não aceita data futura', () => {
  const s = criarStore();
  const saldo = s.resumo().saldoCentavos;
  assert.equal(s.registrar({ tipo: 'saida_dinheiro', valor: String(saldo / 100 + 1), descricao: 'x' }).ok, false);
  assert.equal(s.registrar({ tipo: 'entrada_dinheiro', valor: '10', descricao: 'x', data: emDias(1) }).ok, false);
  assert.equal(s.resumo().saldoCentavos, saldo);
});

test('item novo com erro não é criado pela metade', () => {
  const s = criarStore();
  const total = s.itens().length;
  const r = s.registrar({ tipo: 'doacao_item', quantidade: 0, novoItem: { nome: 'Farinha', unidade: 'kg', categoria: 'Alimentos', minimo: 2 } });
  assert.equal(r.ok, false);
  assert.equal(s.itens().length, total);
  assert.ok(s.registrar({ tipo: 'doacao_item', quantidade: 5, novoItem: { nome: 'Farinha', unidade: 'kg', categoria: 'Alimentos', minimo: 2 } }).ok);
  assert.equal(s.itens().length, total + 1);
  assert.equal(s.registrar({ tipo: 'doacao_item', quantidade: 1, novoItem: { nome: 'farinha', unidade: 'kg', categoria: 'Alimentos', minimo: 2 } }).ok, false);
});

test('desfazer devolve o estoque e o saldo', () => {
  const s = criarStore();
  const saldo = s.resumo().saldoCentavos;
  const r = s.registrar({ tipo: 'saida_dinheiro', valor: '100,00', descricao: 'Mercado' });
  assert.equal(s.resumo().saldoCentavos, saldo - 10000);
  assert.ok(s.estornar(r.movimento.codigo).ok);
  assert.equal(s.resumo().saldoCentavos, saldo);
});

test('quantidade em formato brasileiro', () => {
  assert.equal(quantidadeDeTexto('1.000'), 1000);
  assert.equal(quantidadeDeTexto('2,5'), 2.5);
  assert.equal(quantidadeDeTexto('1.234,5'), 1234.5);
  assert.equal(quantidadeDeTexto('1.5'), 1.5);
  assert.ok(Number.isNaN(quantidadeDeTexto('0x10')));
  assert.ok(Number.isNaN(quantidadeDeTexto('1e3')));
});

test('quantidade absurda é recusada', () => {
  const s = criarStore();
  assert.equal(s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: '99999999999' }).ok, false);
});

test('datas impossíveis são recusadas', () => {
  const s = criarStore();
  assert.equal(s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: 1, validade: '2099-19-99' }).ok, false);
  assert.equal(s.registrar({ tipo: 'entrada_dinheiro', valor: '1', descricao: 'x', data: '2026-02-31' }).ok, false);
});

test('desfazer devolve também a validade do item', () => {
  const s = criarStore();
  const validade = s.item('cafe').validade;
  const saida = s.registrar({ tipo: 'saida_item', itemId: 'cafe', quantidade: 2 });
  assert.equal(s.item('cafe').validade, null);
  s.estornar(saida.movimento.codigo);
  assert.equal(s.item('cafe').validade, validade);

  const antes = s.item('arroz').validade;
  const doacao = s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: 1, validade: dataDeHoje() });
  s.estornar(doacao.movimento.codigo);
  assert.equal(s.item('arroz').validade, antes);
});

test('desfazer uma saída antiga não esconde um lote novo que vence antes', () => {
  const s = criarStore();
  const saida = s.registrar({ tipo: 'saida_item', itemId: 'cafe', quantidade: 2 }); // café tinha validade em 12 dias
  s.registrar({ tipo: 'doacao_item', itemId: 'cafe', quantidade: 1, validade: emDias(3) });
  assert.ok(s.estornar(saida.movimento.codigo).ok);
  assert.equal(s.item('cafe').validade, emDias(3));
  assert.ok(s.resumo().vencendo.some((i) => i.codigo === 'cafe'));
});

test('não deixa desfazer entrada de dinheiro que já foi gasta', () => {
  const s = criarStore();
  const saldo = s.resumo().saldoCentavos;
  const entrada = s.registrar({ tipo: 'entrada_dinheiro', valor: '500,00', descricao: 'Rifa' });
  assert.ok(s.registrar({ tipo: 'saida_dinheiro', valor: String((saldo + 50000) / 100).replace('.', ','), descricao: 'Mercado' }).ok);
  const r = s.estornar(entrada.movimento.codigo);
  assert.equal(r.ok, false);
  assert.equal(s.resumo().saldoCentavos, 0);
});

test('lançamento salvo sem valor é ignorado e não libera despesas', () => {
  const s = criarStore();
  const dinheiro = JSON.parse(localStorage.getItem('via-matris:dinheiro'));
  dinheiro.push({ codigo: 'ruim', tipo: 'entrada_dinheiro', data: '2026-10-01' });
  localStorage.setItem('via-matris:dinheiro', JSON.stringify(dinheiro));
  assert.ok(Number.isFinite(s.resumo().saldoCentavos));
  assert.equal(s.registrar({ tipo: 'saida_dinheiro', valor: '999999', descricao: 'x' }).ok, false);
});

test('desfazer a doação que criou um item remove o item', () => {
  const s = criarStore();
  const total = s.itens().length;
  const r = s.registrar({ tipo: 'doacao_item', quantidade: 3, novoItem: { nome: 'Farinha', unidade: 'kg', categoria: 'Alimentos', minimo: 1 } });
  s.estornar(r.movimento.codigo);
  assert.equal(s.itens().length, total);
});

test('dados de exemplo nunca deixam o caixa negativo em nenhum dia', () => {
  const s = criarStore();
  let saldo = 0;
  for (const m of s.movimentos().sort((a, b) => a.data.localeCompare(b.data))) {
    if (m.tipo === 'entrada_dinheiro') saldo += m.valorCentavos;
    if (m.tipo === 'saida_dinheiro') saldo -= m.valorCentavos;
    assert.ok(saldo >= 0, `saldo negativo em ${m.data}`);
  }
});

test('tipo desconhecido salvo no aparelho não derruba o sistema', () => {
  const s = criarStore();
  const doacoes = JSON.parse(localStorage.getItem('via-matris:doacoes'));
  doacoes.push({ codigo: 'x', tipo: 'invasor', data: '2026-01-01' });
  localStorage.setItem('via-matris:doacoes', JSON.stringify(doacoes));
  assert.doesNotThrow(() => criarStore().resumo());
  assert.ok(!s.movimentos().some((m) => m.codigo === 'x'));
});

test('dados salvos sobrevivem a recarregar a página', () => {
  criarStore().registrar({ tipo: 'doacao_item', itemId: 'feijao', quantidade: 10 });
  assert.equal(criarStore().item('feijao').quantidade, 19);
});

test('duas abas: o que uma grava a outra enxerga e não apaga', () => {
  const aba1 = criarStore();
  const aba2 = criarStore();
  aba1.registrar({ tipo: 'doacao_item', itemId: 'feijao', quantidade: 1 });
  aba2.registrar({ tipo: 'doacao_item', itemId: 'feijao', quantidade: 1 });
  assert.equal(aba1.item('feijao').quantidade, 11);
});

test('armazenamento cheio: o lançamento é recusado e nada fica pela metade', () => {
  const s = criarStore();
  const original = localStorage.setItem;
  const doacoesAntes = lerTudo('doacoes').length;
  localStorage.setItem = (k, v) => { // só a gravação do item falha: o caso mais perigoso
    if (k === 'via-matris:itens') throw new Error('QuotaExceededError');
    original(k, v);
  };
  const r = s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: 1 });
  localStorage.setItem = original;
  assert.equal(r.ok, false);
  assert.match(r.erro, /espaço/);
  assert.equal(lerTudo('doacoes').length, doacoesAntes);
});

test('sem armazenamento, o lançamento é recusado com explicação', () => {
  const s = criarStore();
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: null, configurable: true, writable: true });
  const r = s.registrar({ tipo: 'entrada_dinheiro', valor: '10', descricao: 'Teste' });
  globalThis.localStorage = original;
  assert.equal(r.ok, false);
  assert.match(r.erro, /guardar/);
});

// ---------- integração com o backup do Miguel ----------

test('o que é lançado na tela aparece nas planilhas de backup', () => {
  const s = criarStore();
  s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: 7, pessoa: 'Dona Teste' });
  s.registrar({ tipo: 'entrada_dinheiro', valor: '33,00', descricao: 'Rifa' });
  assert.match(gerarPlanilha('doacoes'), /Doação;arroz;Arroz;7;kg;Dona Teste/);
  assert.match(gerarPlanilha('dinheiro'), /Entrada;33,00;Rifa/);
  assert.match(gerarPlanilha('itens'), /arroz;Arroz;Alimentos;kg;49;/);
});

test('ciclo completo: lançar, baixar, perder tudo, restaurar', () => {
  const s = criarStore();
  s.apagarTudo();
  s.registrar({ tipo: 'doacao_item', quantidade: 10, novoItem: { nome: 'Feijão', unidade: 'kg', categoria: 'Alimentos', minimo: 2 } });
  s.registrar({ tipo: 'entrada_dinheiro', valor: '100,00', descricao: 'Rifa' });
  const planilhas = ['itens', 'doacoes', 'dinheiro'].map((c) => [c, gerarPlanilha(c)]);
  const resumoAntes = s.resumo().saldoCentavos;

  guardado.clear(); // o celular quebrou
  const novo = criarStore(); // aparelho novo abre com exemplos
  assert.ok(novo.soExemplos());
  novo.apagarTudo();
  for (const [colecao, texto] of planilhas) assert.equal(importarPlanilha(colecao, texto).erros.length, 0);

  assert.equal(novo.resumo().saldoCentavos, resumoAntes);
  assert.equal(novo.itens()[0].quantidade, 10);
  assert.equal(novo.temExemplos(), false);
});

test('restaurar por cima dos exemplos não mantém os números de exemplo', async () => {
  const s = criarStore();
  const csv = 'Código;Item;Categoria;Unidade;Quantidade em estoque\narroz;Arroz;Alimentos;kg;3\n';
  const arquivo = { name: 'x.csv', size: csv.length, arrayBuffer: async () => new TextEncoder().encode(csv).buffer };
  await restaurarArquivos([arquivo], () => { if (s.soExemplos()) s.apagarTudo(); });
  assert.equal(s.item('arroz').quantidade, 3);
  assert.equal(s.itens().length, 1);
});

test('exemplos só aparecem na primeira abertura; apagar tudo é definitivo', () => {
  const s = criarStore();
  assert.ok(s.itens().length > 0);
  s.apagarTudo();
  assert.equal(criarStore().itens().length, 0);
});

test('lançar algo por cima dos exemplos protege esses dados de serem apagados na restauração', () => {
  const s = criarStore();
  assert.equal(s.soExemplos(), true);
  s.registrar({ tipo: 'entrada_dinheiro', valor: '1', descricao: 'Real' });
  assert.equal(s.soExemplos(), false);
  assert.equal(s.temExemplos(), true);
});
