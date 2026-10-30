// Testes das regras de negócio. Rodar com: node --test tests/store.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarStore, centavosDeTexto, quantidadeDeTexto, dataValida, dataISO } = require('../js/store.js');

// Storage em memória, no lugar do localStorage do navegador.
function memoria() {
  const dados = {};
  return { getItem: (k) => dados[k] ?? null, setItem: (k, v) => { dados[k] = String(v); } };
}

test('converte reais em centavos sem erro de ponto flutuante', () => {
  assert.equal(centavosDeTexto('1.234,56'), 123456);
  assert.equal(centavosDeTexto('0,10'), 10);
  assert.equal(centavosDeTexto('R$ 50'), 5000);
  assert.equal(centavosDeTexto('19.90'), 1990);
  assert.equal(centavosDeTexto('1.000'), 100000); // mil reais escrito com ponto
  assert.ok(Number.isNaN(centavosDeTexto('1,999'))); // centavo tem só duas casas
  assert.ok(Number.isNaN(centavosDeTexto('abc')));
  assert.ok(Number.isNaN(centavosDeTexto('-5')));
});

test('doação soma e saída baixa o estoque', () => {
  const s = criarStore(memoria());
  const antes = s.item('arroz').quantidade;
  assert.ok(s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: '2,5' }).ok);
  assert.equal(s.item('arroz').quantidade, antes + 2.5);
  assert.ok(s.registrar({ tipo: 'saida_item', itemId: 'arroz', quantidade: 2.5 }).ok);
  assert.equal(s.item('arroz').quantidade, antes);
});

test('não deixa sair mais do que existe', () => {
  const s = criarStore(memoria());
  const r = s.registrar({ tipo: 'saida_item', itemId: 'cafe', quantidade: 999 });
  assert.equal(r.ok, false);
  assert.equal(s.item('cafe').quantidade, 2);
});

test('não deixa gastar mais do que o saldo e não aceita data futura', () => {
  const s = criarStore(memoria());
  const saldo = s.resumo().saldoCentavos;
  assert.equal(s.registrar({ tipo: 'saida_dinheiro', valor: String(saldo / 100 + 1), descricao: 'x' }).ok, false);
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  assert.equal(s.registrar({ tipo: 'entrada_dinheiro', valor: '10', descricao: 'x', data: dataISO(amanha) }).ok, false);
  assert.equal(s.resumo().saldoCentavos, saldo);
});

test('item novo com erro não é criado pela metade', () => {
  const s = criarStore(memoria());
  const total = s.itens().length;
  const r = s.registrar({ tipo: 'doacao_item', quantidade: 0, novoItem: { nome: 'Farinha', unidade: 'kg', categoria: 'Alimentos', minimo: 2 } });
  assert.equal(r.ok, false);
  assert.equal(s.itens().length, total);
  assert.ok(s.registrar({ tipo: 'doacao_item', quantidade: 5, novoItem: { nome: 'Farinha', unidade: 'kg', categoria: 'Alimentos', minimo: 2 } }).ok);
  assert.equal(s.itens().length, total + 1);
  assert.equal(s.registrar({ tipo: 'doacao_item', quantidade: 1, novoItem: { nome: 'farinha', unidade: 'kg', categoria: 'Alimentos', minimo: 2 } }).ok, false);
});

test('desfazer devolve o estoque e o saldo', () => {
  const s = criarStore(memoria());
  const saldo = s.resumo().saldoCentavos;
  const r = s.registrar({ tipo: 'saida_dinheiro', valor: '100,00', descricao: 'Mercado' });
  assert.equal(s.resumo().saldoCentavos, saldo - 10000);
  assert.ok(s.estornar(r.movimento.id).ok);
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

test('datas impossíveis são recusadas', () => {
  assert.equal(dataValida('2026-02-28'), true);
  assert.equal(dataValida('2026-02-31'), false);
  assert.equal(dataValida('2099-19-99'), false);
  const s = criarStore(memoria());
  assert.equal(s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: 1, validade: '2099-19-99' }).ok, false);
});

test('desfazer devolve também a validade do item', () => {
  const s = criarStore(memoria());
  const validade = s.item('cafe').validade;
  const saida = s.registrar({ tipo: 'saida_item', itemId: 'cafe', quantidade: 2 });
  assert.equal(s.item('cafe').validade, null);
  s.estornar(saida.movimento.id);
  assert.equal(s.item('cafe').validade, validade);

  const antes = s.item('arroz').validade;
  const doacao = s.registrar({ tipo: 'doacao_item', itemId: 'arroz', quantidade: 1, validade: dataISO(new Date()) });
  s.estornar(doacao.movimento.id);
  assert.equal(s.item('arroz').validade, antes);
});

test('desfazer uma saída antiga não esconde um lote novo que vence antes', () => {
  const s = criarStore(memoria());
  const emDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dataISO(d); };
  const saida = s.registrar({ tipo: 'saida_item', itemId: 'cafe', quantidade: 2 }); // café tinha validade em 12 dias
  s.registrar({ tipo: 'doacao_item', itemId: 'cafe', quantidade: 1, validade: emDias(3) });
  assert.ok(s.estornar(saida.movimento.id).ok);
  assert.equal(s.item('cafe').validade, emDias(3));
  assert.ok(s.resumo().vencendo.some((i) => i.id === 'cafe'));
});

test('não deixa desfazer entrada de dinheiro que já foi gasta', () => {
  const s = criarStore(memoria());
  const saldo = s.resumo().saldoCentavos;
  const entrada = s.registrar({ tipo: 'entrada_dinheiro', valor: '500,00', descricao: 'Rifa' });
  assert.ok(s.registrar({ tipo: 'saida_dinheiro', valor: String((saldo + 50000) / 100).replace('.', ','), descricao: 'Mercado' }).ok);
  const r = s.estornar(entrada.movimento.id);
  assert.equal(r.ok, false);
  assert.equal(s.resumo().saldoCentavos, 0);
});

test('lançamento salvo sem valor é descartado e não libera despesas', () => {
  const storage = memoria();
  const s = criarStore(storage);
  s.registrar({ tipo: 'entrada_dinheiro', valor: '10', descricao: 'x' });
  const dados = JSON.parse(storage.getItem(s.chave));
  dados.movimentos.push({ tipo: 'entrada_dinheiro', data: '2026-10-01' });
  storage.setItem(s.chave, JSON.stringify(dados));
  const recarregado = criarStore(storage);
  assert.ok(Number.isFinite(recarregado.resumo().saldoCentavos));
  assert.equal(recarregado.registrar({ tipo: 'saida_dinheiro', valor: '999999', descricao: 'x' }).ok, false);
});

test('desfazer a doação que criou um item remove o item', () => {
  const s = criarStore(memoria());
  const total = s.itens().length;
  const r = s.registrar({ tipo: 'doacao_item', quantidade: 3, novoItem: { nome: 'Farinha', unidade: 'kg', categoria: 'Alimentos', minimo: 1 } });
  s.estornar(r.movimento.id);
  assert.equal(s.itens().length, total);
});

test('dados de exemplo nunca deixam o caixa negativo em nenhum dia', () => {
  const s = criarStore(memoria());
  let saldo = 0;
  for (const m of s.movimentos().sort((a, b) => a.data.localeCompare(b.data))) {
    if (m.tipo === 'entrada_dinheiro') saldo += m.valorCentavos;
    if (m.tipo === 'saida_dinheiro') saldo -= m.valorCentavos;
    assert.ok(saldo >= 0, `saldo negativo em ${m.data}`);
  }
});

test('dados salvos corrompidos não derrubam o sistema', () => {
  const storage = memoria();
  const s = criarStore(storage);
  s.registrar({ tipo: 'doacao_item', itemId: 'feijao', quantidade: 1 });
  const dados = JSON.parse(storage.getItem(s.chave));
  dados.movimentos.push({ tipo: 'invasor', data: '2026-01-01' });
  storage.setItem(s.chave, JSON.stringify(dados));
  assert.doesNotThrow(() => criarStore(storage).resumo());
});

test('sem armazenamento, o registro funciona mas avisa que não foi salvo', () => {
  const r = criarStore(null).registrar({ tipo: 'entrada_dinheiro', valor: '10', descricao: 'Teste' });
  assert.equal(r.ok, true);
  assert.equal(r.salvo, false);
});

test('dados salvos sobrevivem a recarregar a página', () => {
  const storage = memoria();
  criarStore(storage).registrar({ tipo: 'doacao_item', itemId: 'feijao', quantidade: 10 });
  assert.equal(criarStore(storage).item('feijao').quantidade, 19);
});
