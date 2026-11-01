/*
 * Testes da parte do Miguel (js/dados.js, js/utilitarios.js, js/backup.js), sem tela.
 *
 *   node tests/testar-miguel.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const js = path.join(__dirname, '..', 'js');

// localStorage de mentira, igual ao do navegador.
const guardado = new Map();
globalThis.localStorage = {
  getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
  setItem: (k, v) => guardado.set(k, String(v)),
  removeItem: (k) => guardado.delete(k),
};

require(path.join(js, 'utilitarios.js'));
require(path.join(js, 'dados.js'));
require(path.join(js, 'store.js')); // textoParaCentavos, centavosParaTexto e gerarCodigo
require(path.join(js, 'backup.js'));

// Para baixarPlanilha no Node: um "claude.use('downloads')" de mentira que guarda o arquivo.
let ultimoArquivo = null;
globalThis.claude = { use: async () => ({ save: async (a) => { ultimoArquivo = a; return { status: 'saved' }; } }) };

let passou = 0;
const fila = [];
function teste(nome, fn) { fila.push([nome, fn]); }

function hojeMais(dias) {
  const [a, m, d] = dataDeHoje().split('-').map(Number);
  const x = new Date(a, m - 1, d + dias);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// ---------- utilitarios.js ----------

teste('textoParaData aceita formatos comuns e recusa datas que não existem', () => {
  assert.strictEqual(textoParaData('29/10/2026'), '2026-10-29');
  assert.strictEqual(textoParaData('1/2/26'), '2026-02-01');
  assert.strictEqual(textoParaData('2026-10-29'), '2026-10-29');
  assert.strictEqual(textoParaData('29/02/2024'), '2024-02-29');
  assert.strictEqual(textoParaData('29/02/2026'), null);
  assert.strictEqual(textoParaData('31/04/2026'), null);
  assert.strictEqual(textoParaData('ontem'), null);
});
teste('dataParaTexto, dataPorExtenso e dataCurta (o que o topo e o histórico do front mostram)', () => {
  assert.strictEqual(dataParaTexto('2026-10-29'), '29/10/2026');
  assert.strictEqual(dataParaTexto(''), '');
  assert.strictEqual(dataPorExtenso('2026-10-29'), 'quinta-feira, 29 de outubro de 2026');
  assert.strictEqual(dataCurta('2026-10-29'), '29 de out.');
  assert.strictEqual(dataCurta('lixo'), '');
});
teste('diasAte para a validade', () => {
  assert.strictEqual(diasAte(dataDeHoje()), 0);
  assert.strictEqual(diasAte(hojeMais(15)), 15);
  assert.strictEqual(diasAte(hojeMais(-3)), -3);
  assert.strictEqual(diasAte('2026-02-31'), null);
});
teste('dataDeHoje e mesAtual usam o horário local', () => {
  const d = new Date();
  assert.strictEqual(Number(dataDeHoje().slice(8)), d.getDate());
  assert.deepStrictEqual(mesAtual(), { ano: d.getFullYear(), mes: d.getMonth() + 1 });
});
teste('mesAnterior, proximoMes, nomeDoMes e textoDaQuantidade', () => {
  assert.deepStrictEqual(mesAnterior(2026, 1), { ano: 2025, mes: 12 });
  assert.deepStrictEqual(proximoMes(2026, 12), { ano: 2027, mes: 1 });
  assert.strictEqual(nomeDoMes(10, 2026), 'outubro de 2026');
  assert.strictEqual(textoDaQuantidade(2.5, 'kg'), '2,5 kg');
  assert.strictEqual(textoDaQuantidade(1000, 'un'), '1.000 un');
});

// ---------- dados.js ----------

teste('salvar, ler, editar e remover; coleções separadas', () => {
  assert.deepStrictEqual(lerTudo('dinheiro'), []);
  const r = salvarRegistro('dinheiro', { codigo: 'a1', tipo: 'entrada_dinheiro', valorCentavos: 5099 });
  assert.strictEqual(r.ok, true);
  salvarRegistro('dinheiro', { codigo: 'a1', tipo: 'entrada_dinheiro', valorCentavos: 6000 });
  assert.deepStrictEqual(lerTudo('dinheiro').map((x) => x.valorCentavos), [6000]);
  assert.deepStrictEqual(lerTudo('doacoes'), []);
  assert.deepStrictEqual(lerTudo('itens'), []);
  assert.deepStrictEqual(removerRegistro('dinheiro', 'a1'), { ok: true });
  assert.strictEqual(removerRegistro('dinheiro', 'a1').ok, false);
});
teste('lerTudo devolve cópias; recusa sem código e coleção errada', () => {
  salvarRegistro('itens', { codigo: 'arroz', nome: 'Arroz' });
  lerTudo('itens')[0].nome = 'mudado';
  assert.strictEqual(lerTudo('itens')[0].nome, 'Arroz');
  assert.strictEqual(salvarRegistro('dinheiro', { valorCentavos: 1 }).ok, false);
  assert.throws(() => lerTudo('estoque'), /Coleção desconhecida/);
});
teste('dados estragados não derrubam o app e ficam guardados à parte', () => {
  localStorage.setItem('via-matris:dinheiro', '{isso não é json');
  assert.deepStrictEqual(lerTudo('dinheiro'), []);
  assert.strictEqual(localStorage.getItem('via-matris:dinheiro:corrompido'), '{isso não é json');
});
teste('armazenamento cheio devolve erro em português', () => {
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const r = salvarRegistro('dinheiro', { codigo: 'x' });
  localStorage.setItem = original;
  assert.strictEqual(r.ok, false);
  assert.match(r.erros[0], /espaço/);
});
teste('config junta mudanças; VERSAO existe', () => {
  salvarConfig({ tutorialVisto: true });
  salvarConfig({ tema: 'claro' });
  assert.strictEqual(lerConfig().tutorialVisto, true);
  assert.strictEqual(lerConfig().tema, 'claro');
  assert.match(VERSAO, /^\d+\.\d+\.\d+$/);
});
teste('migra uma vez os dados do protótipo (store.js) e não apaga o original', () => {
  const prototipo = JSON.stringify({
    versao: 1,
    itens: [{ id: 'arroz', nome: 'Arroz', categoria: 'Alimentos', unidade: 'kg', quantidade: 42, minimo: 20, validade: '2027-01-01' }],
    movimentos: [
      { id: 'm1', tipo: 'doacao_item', data: '2026-10-01', itemId: 'arroz', quantidade: 25, pessoa: 'Paróquia', descricao: '', criadoEm: 'x' },
      { id: 'm2', tipo: 'entrada_dinheiro', data: '2026-10-02', valorCentavos: 50000, descricao: 'Pix', pessoa: '', criadoEm: 'y' },
      { id: 'm3', tipo: 'saida_dinheiro', data: '2026-10-03', valorCentavos: 18990, descricao: 'Gás', pessoa: '', criadoEm: 'z' },
    ],
  });
  localStorage.setItem('via-matris:dados:v1', prototipo);
  assert.deepStrictEqual(lerTudo('itens').map((i) => [i.codigo, i.nome, i.quantidade]), [['arroz', 'Arroz', 42]]);
  assert.deepStrictEqual(lerTudo('doacoes').map((m) => [m.codigo, m.itemId, m.quantidade]), [['m1', 'arroz', 25]]);
  assert.deepStrictEqual(lerTudo('dinheiro').map((m) => m.codigo), ['m2', 'm3']);
  assert.strictEqual(lerTudo('dinheiro')[0].id, undefined, '"id" virou "codigo"');
  assert.strictEqual(localStorage.getItem('via-matris:dados:v1'), prototipo, 'original intacto');
  // Uma vez só: apagar tudo depois não faz os dados antigos voltarem.
  removerRegistro('dinheiro', 'm2');
  removerRegistro('dinheiro', 'm3');
  assert.deepStrictEqual(lerTudo('dinheiro'), []);
});
teste('não migra por cima de dados que já existem', () => {
  salvarRegistro('dinheiro', { codigo: 'novo', valorCentavos: 1 });
  guardado.delete('via-matris:config');
  localStorage.setItem('via-matris:dados:v1', JSON.stringify({ versao: 1, itens: [], movimentos: [
    { id: 'velho', tipo: 'entrada_dinheiro', data: '2026-10-02', valorCentavos: 5 }] }));
  assert.deepStrictEqual(lerTudo('dinheiro').map((m) => m.codigo), ['novo']);
});

// ---------- backup.js ----------

function exemplo() {
  salvarRegistro('itens', { codigo: 'arroz', nome: 'Arroz', categoria: 'Alimentos', unidade: 'kg', quantidade: 42.5, minimo: 20, validade: '2027-01-10' });
  salvarRegistro('itens', { codigo: 'sabonete', nome: 'Sabonete', categoria: 'Higiene', unidade: 'un', quantidade: 0, minimo: 20, validade: null });
  salvarRegistro('doacoes', { codigo: 'd2', tipo: 'saida_item', data: '2026-10-05', itemId: 'arroz', quantidade: 3, pessoa: 'Cozinha', descricao: 'Almoço', criadoEm: '2' });
  salvarRegistro('doacoes', { codigo: 'd1', tipo: 'doacao_item', data: '2026-10-01', itemId: 'arroz', quantidade: 25, pessoa: 'Paróquia; São José', descricao: '', criadoEm: '1' });
  salvarRegistro('dinheiro', { codigo: 'm1', tipo: 'entrada_dinheiro', data: '2026-10-02', valorCentavos: 120000, descricao: 'Bazar', pessoa: 'Bazar "da casa"', criadoEm: '1' });
  salvarRegistro('dinheiro', { codigo: 'm2', tipo: 'saida_dinheiro', data: '2026-10-01', valorCentavos: 18990, descricao: '=HIPERLINK("x")', pessoa: '', criadoEm: '2' });
}
const tirarVazios = (x) => Object.fromEntries(Object.entries(x).filter(([k, v]) => v !== '' && v != null && k !== 'criadoEm'));
const ordenar = (l) => l.map(tirarVazios).sort((a, b) => a.codigo.localeCompare(b.codigo));

teste('planilhas legíveis: rótulos, datas, valores, nome do item e proteção contra fórmula', () => {
  exemplo();
  const dinheiro = gerarPlanilha('dinheiro').trimEnd().split('\r\n');
  assert.deepStrictEqual(dinheiro, [
    'Código;Data;Movimento;Valor (R$);Descrição;Quem',
    'm2;01/10/2026;Despesa;189,90;"\'=HIPERLINK(""x"")";',
    'm1;02/10/2026;Entrada;1.200,00;Bazar;"Bazar ""da casa"""',
  ]);
  const doacoes = gerarPlanilha('doacoes').trimEnd().split('\r\n');
  assert.deepStrictEqual(doacoes, [
    'Código;Data;Movimento;Código do item;Item;Quantidade;Unidade;Quem doou / para onde foi;Observação',
    'd1;01/10/2026;Doação;arroz;Arroz;25;kg;"Paróquia; São José";',
    'd2;05/10/2026;Saída;arroz;Arroz;3;kg;Cozinha;Almoço',
  ]);
  const itens = gerarPlanilha('itens').trimEnd().split('\r\n');
  assert.deepStrictEqual(itens, [
    'Código;Item;Categoria;Unidade;Quantidade em estoque;Estoque mínimo;Validade mais próxima',
    'arroz;Arroz;Alimentos;kg;42,5;20;10/01/2027',
    'sabonete;Sabonete;Higiene;un;0;20;',
  ]);
});
teste('restaurar o backup completo devolve exatamente os mesmos dados', () => {
  exemplo();
  const planilhas = Object.fromEntries(['itens', 'doacoes', 'dinheiro'].map((c) => [c, gerarPlanilha(c)]));
  const antes = Object.fromEntries(['itens', 'doacoes', 'dinheiro'].map((c) => [c, lerTudo(c)]));
  guardado.clear();
  for (const c of ['itens', 'doacoes', 'dinheiro']) {
    const r = importarPlanilha(c, '﻿' + planilhas[c]);
    assert.deepStrictEqual([r.ok, r.ignorados, r.erros], [true, 0, []], c);
    assert.deepStrictEqual(ordenar(lerTudo(c)), ordenar(antes[c]), c);
  }
});
teste('importar duas vezes não duplica', () => {
  exemplo();
  const r = importarPlanilha('dinheiro', gerarPlanilha('dinheiro'));
  assert.deepStrictEqual(r, { ok: true, importados: 0, ignorados: 2, erros: [] });
});
teste('doações sem o estoque importado são recusadas com explicação', () => {
  exemplo();
  const planilha = gerarPlanilha('doacoes');
  guardado.clear();
  const r = importarPlanilha('doacoes', planilha);
  assert.strictEqual(r.importados, 0);
  assert.match(r.erros[0], /^Linha 2: o item de código "arroz" não está no estoque\. Importe antes a planilha de estoque\.$/);
});
teste('planilha feita à mão: acha o item pelo nome, aceita rótulo sem acento e vírgula', () => {
  exemplo();
  const csv = 'Data,Movimento,Item,Quantidade\n05/10/2026,doacao,arroz,"2,5"\n06/10/2026,Saida,Feijão,1\n';
  const r = importarPlanilha('doacoes', csv);
  assert.strictEqual(r.importados, 1);
  assert.match(r.erros[0], /^Linha 3: o item "Feijão" não está no estoque/);
  const nova = lerTudo('doacoes').find((d) => !['d1', 'd2'].includes(d.codigo));
  assert.deepStrictEqual([nova.tipo, nova.itemId, nova.quantidade], ['doacao_item', 'arroz', 2.5]);
  assert.ok(nova.codigo && nova.criadoEm);
});
teste('linhas com erro são recusadas uma a uma, com mensagem', () => {
  const csv = [
    'Data;Movimento;Valor (R$);Descrição',
    '05/10/2026;Entrada;50,99;Pix',
    '31/02/2026;Despesa;10;Gás',
    '06/10/2026;doação;abc;',
  ].join('\n');
  const r = importarPlanilha('dinheiro', csv);
  assert.strictEqual(r.importados, 1);
  assert.match(r.erros[0], /^Linha 3: Data inválida/);
  assert.match(r.erros[1], /^Linha 4: Movimento "doação" não existe \(use: Entrada, Despesa\); Valor \(R\$\) inválido.*Falta preencher Descrição/);
  assert.strictEqual(lerTudo('dinheiro')[0].tipo, 'entrada_dinheiro');
});
teste('estoque aceita quantidade zero, mas não negativa', () => {
  const csv = 'Item;Categoria;Unidade;Quantidade em estoque\nDetergente;limpeza;un;0\nÁgua;Limpeza;L;-1\n';
  const r = importarPlanilha('itens', csv);
  assert.strictEqual(r.importados, 1);
  assert.match(r.erros[0], /^Linha 3: Quantidade em estoque inválido/);
  assert.deepStrictEqual(tirarVazios({ ...lerTudo('itens')[0], codigo: 'x' }),
    { codigo: 'x', nome: 'Detergente', categoria: 'Limpeza', unidade: 'un', quantidade: 0, minimo: 0 });
});
teste('planilha da coleção errada é recusada inteira', () => {
  exemplo();
  const r = importarPlanilha('itens', gerarPlanilha('dinheiro'));
  assert.strictEqual(r.ok, false);
  assert.match(r.erros[0], /não é a planilha de estoque/);
  assert.strictEqual(importarPlanilha('doacoes', '').ok, false);
});
teste('baixarPlanilha entrega o arquivo com BOM e anota a data; baixarTodas faz as três', async () => {
  exemplo();
  const r = await baixarPlanilha('itens');
  assert.deepStrictEqual(r, { ok: true, nomeDoArquivo: `via-matris-estoque-${dataDeHoje()}.csv` });
  assert.strictEqual(ultimoArquivo.data.charCodeAt(0), 0xFEFF);
  assert.strictEqual(diasDesdeUltimoBackup('itens'), 0);
  assert.strictEqual(diasDesdeUltimoBackup(), null, 'as outras duas ainda não');
  const todas = await baixarTodasAsPlanilhas();
  assert.deepStrictEqual(todas.arquivos.map((a) => a.split('-')[2]), ['estoque', 'doacoes', 'dinheiro']);
  assert.strictEqual(diasDesdeUltimoBackup(), 0);
});
teste('download recusado pela pessoa não conta como backup', async () => {
  const salvar = globalThis.claude;
  globalThis.claude = { use: async () => ({ save: async () => { throw { code: 'declined' }; } }) };
  const r = await baixarPlanilha('dinheiro');
  globalThis.claude = salvar;
  assert.deepStrictEqual(r, { ok: false, erros: ['O download foi cancelado.'] });
  assert.strictEqual(diasDesdeUltimoBackup('dinheiro'), null);
});
teste('diasDesdeUltimoBackup pega a planilha mais atrasada', () => {
  salvarConfig({ ultimoBackup: { itens: dataDeHoje(), doacoes: hojeMais(-10), dinheiro: hojeMais(-2) } });
  assert.strictEqual(diasDesdeUltimoBackup(), 10);
  assert.strictEqual(diasDesdeUltimoBackup('dinheiro'), 2);
});

// ---------- reforços feitos na integração ----------

const arquivoFalso = (nome, bytes) => ({ name: nome, size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer });

teste('planilha salva pelo Excel em Windows-1252 é lida com acentos certos', async () => {
  const csv = Buffer.from('C\xF3digo;Data;Movimento;Valor (R$);Descri\xE7\xE3o;Quem\r\nz1;01/10/2026;Entrada;10,00;Doa\xE7\xE3o;\r\n', 'latin1');
  const r = await restaurarArquivos([arquivoFalso('renomeado.csv', csv)]);
  assert.deepStrictEqual([r.ok, r.importados, r.erros], [true, 1, []]);
  assert.strictEqual(lerTudo('dinheiro')[0].descricao, 'Doação');
});
teste('restaurar acha a planilha pelo cabeçalho e importa na ordem certa, mesmo fora de ordem', async () => {
  exemplo();
  const doacoes = Buffer.from(gerarPlanilha('doacoes'));
  const estoque = Buffer.from(gerarPlanilha('itens'));
  guardado.clear();
  const r = await restaurarArquivos([arquivoFalso('a.csv', doacoes), arquivoFalso('b.csv', estoque)]);
  assert.deepStrictEqual([r.importados, r.erros], [4, []]);
});
teste('arquivo que não é planilha não dispara a limpeza dos exemplos', async () => {
  let limpou = false;
  const r = await restaurarArquivos([arquivoFalso('foto.csv', Buffer.from('qualquer coisa'))], () => { limpou = true; });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(limpou, false);
  assert.match(r.erros[0], /não é uma planilha/);
});
teste('item digitado à mão com nome que já existe não vira duplicado', () => {
  exemplo();
  const r = importarPlanilha('itens', 'Item;Categoria;Unidade;Quantidade em estoque\narroz;Alimentos;kg;50\nFeijão;Alimentos;kg;1\nfeijao;Alimentos;kg;2\n');
  assert.deepStrictEqual([r.importados, r.ignorados], [1, 2]);
});
teste('importação recusa texto gigante, valor absurdo e data no futuro', () => {
  const longo = 'x'.repeat(121);
  const csv = ['Data;Movimento;Valor (R$);Descrição',
    `01/10/2026;Entrada;10,00;${longo}`,
    '01/10/2026;Entrada;99999999999999999999,00;Absurdo',
    `${dataParaTexto(hojeMais(1))};Entrada;10,00;Futuro`].join('\n');
  const r = importarPlanilha('dinheiro', csv);
  assert.strictEqual(r.importados, 0);
  assert.strictEqual(r.erros.length, 3);
  assert.match(r.erros[0], /passa de 120 caracteres/);
  assert.match(r.erros[2], /no futuro/);
});
teste('fórmula escondida depois de vírgula vai entre aspas', () => {
  salvarRegistro('dinheiro', { codigo: 'a', tipo: 'entrada_dinheiro', data: '2026-10-01', valorCentavos: 100, descricao: 'x, =1+1', pessoa: '', criadoEm: '1' });
  assert.match(gerarPlanilha('dinheiro'), /;"x, =1\+1";/);
});
teste('importar 5.000 linhas é rápido', () => {
  const linhas = ['Data;Movimento;Valor (R$);Descrição'];
  for (let i = 0; i < 5000; i++) linhas.push(`01/10/2026;Entrada;10,00;Linha ${i}`);
  const inicio = Date.now();
  assert.strictEqual(importarPlanilha('dinheiro', linhas.join('\n')).importados, 5000);
  assert.ok(Date.now() - inicio < 1000, `levou ${Date.now() - inicio} ms`);
});
teste('sem espaço, a planilha não entra pela metade e o resultado diz isso', () => {
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const r = importarPlanilha('dinheiro', 'Data;Movimento;Valor (R$);Descrição\n01/10/2026;Entrada;10,00;A\n');
  localStorage.setItem = original;
  assert.deepStrictEqual([r.ok, r.importados], [false, 0]);
  assert.match(r.erros[0], /Nada foi importado/);
  assert.deepStrictEqual(lerTudo('dinheiro'), []);
});
teste('migração sem espaço não fica pela metade e tenta de novo depois', () => {
  localStorage.setItem('via-matris:dados:v1', JSON.stringify({ versao: 1,
    itens: [{ id: 'arroz', nome: 'Arroz' }],
    movimentos: [{ id: 'm', tipo: 'entrada_dinheiro', data: '2026-10-02', valorCentavos: 5 }] }));
  const original = localStorage.setItem;
  localStorage.setItem = (k, v) => { if (k === 'via-matris:dinheiro') throw new Error('QuotaExceededError'); original(k, v); };
  assert.deepStrictEqual(lerTudo('dinheiro'), []);
  localStorage.setItem = original;
  assert.deepStrictEqual(lerTudo('itens').map((i) => i.codigo), ['arroz']);
  assert.deepStrictEqual(lerTudo('dinheiro').map((m) => m.codigo), ['m']);
});
teste('dado estragado com armazenamento cheio não derruba a leitura', () => {
  localStorage.setItem('via-matris:dinheiro', '{estragado');
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  const lido = lerTudo('dinheiro');
  localStorage.setItem = original;
  assert.deepStrictEqual(lido, []);
  assert.strictEqual(localStorage.getItem('via-matris:dinheiro'), '{estragado', 'nada se perdeu');
});
teste('todo arquivo que o sw.js e o manifest pedem existe de verdade', () => {
  const raiz = path.join(__dirname, '..');
  const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
  const lista = sw.slice(sw.indexOf('const ARQUIVOS'), sw.indexOf('];')).match(/'[^']+'/g).map((a) => a.slice(1, -1));
  const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, 'manifest.json'), 'utf8'));
  for (const a of [...lista.filter((x) => x !== './'), ...manifesto.icons.map((i) => i.src)]) {
    assert.ok(fs.existsSync(path.join(raiz, a)), `falta ${a}`);
  }
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(lista.includes(src), `${src} não está no sw.js`);
  assert.ok(!/<script>/.test(html), 'script inline é bloqueado pela CSP');
});

(async () => {
  for (const [nome, fn] of fila) {
    guardado.clear();
    try {
      await fn();
      passou++;
      console.log('  ok  ', nome);
    } catch (e) {
      console.log('  FALHOU', nome, '\n       ', e.message);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passou} de ${fila.length} testes passaram.`);
})();
