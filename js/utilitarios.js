/*
 * utilitarios.js — Miguel
 *
 * Funções pequenas de data e de texto, usadas pela tela (app.js) e pelas regras (store.js).
 * Nenhuma delas lê ou grava dados: só recebem um valor e devolvem outro.
 * Várias substituem o que o app.js do protótipo fazia por conta própria
 * (dataLonga, dataCurta, diasAte, quantidadeTexto, rotuloMes).
 *
 * Formato combinado:
 *   - Data guardada: "AAAA-MM-DD" (ex.: "2026-10-29"). É a que vai para o dados.js.
 *   - Data mostrada: "DD/MM/AAAA" (ex.: "29/10/2026"). É a que aparece na tela e na planilha.
 *   - Mês: número de 1 (janeiro) a 12 (dezembro). Nunca de 0 a 11.
 */
(function () {
'use strict';

const NOMES_DOS_MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

// Confere se dia/mês/ano existem de verdade (31/02 não existe; 29/02 só em ano bissexto).
function diaExiste(ano, mes, dia) {
  const d = new Date(ano, mes - 1, dia);
  return d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
}

/**
 * "29/10/2026" → "2026-10-29".
 * Também aceita "29/10/26", "29-10-2026" e uma data que já esteja em "2026-10-29".
 * Devolve null se a data não existir ou estiver escrita errado.
 */
function textoParaData(texto) {
  const s = String(texto ?? '').trim();
  let dia, mes, ano;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
    if (!m) return null;
    [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[3].length === 2) ano += 2000;
  }

  if (!diaExiste(ano, mes, dia)) return null;
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

/** "2026-10-29" → "29/10/2026". Devolve "" se vier vazio ou inválido. */
function dataParaTexto(data) {
  const m = String(data ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Data de hoje em "AAAA-MM-DD", no horário do celular.
 * (new Date().toISOString() usa o horário de Londres: depois das 21h viraria "amanhã".)
 */
function dataDeHoje() {
  const d = new Date();
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

/**
 * Para o topo da tela inicial: "quinta-feira, 29 de outubro de 2026".
 * Sem argumento, usa hoje. Para começar com maiúscula, use CSS (::first-letter), como o front já faz.
 */
function dataPorExtenso(data = dataDeHoje()) {
  const d = paraDate(data);
  return d ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

/** Para tabelas: "2026-10-29" → "29 de out.". */
function dataCurta(data) {
  const d = paraDate(data);
  return d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
}

/**
 * Quantos dias faltam até a data (negativo se já passou). Usado para a validade:
 * diasAte("2026-11-03") num dia 29/10 → 5. Devolve null se a data for inválida.
 */
function diasAte(data) {
  const alvo = paraDate(data);
  if (!alvo) return null;
  const hoje = paraDate(dataDeHoje());
  // Date.UTC: no dia em que muda o horário de verão, um dia não tem 24 horas.
  const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(alvo) - utc(hoje)) / 86400000);
}

// "2026-10-29" → Date à meia-noite local (new Date("2026-10-29") seria meia-noite de Londres).
function paraDate(data) {
  const m = String(data ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !diaExiste(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Mês de hoje: { ano: 2026, mes: 10 }. */
function mesAtual() {
  const d = new Date();
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
}

/** mesAnterior(2026, 1) → { ano: 2025, mes: 12 }. */
function mesAnterior(ano, mes) {
  return mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
}

/** proximoMes(2026, 12) → { ano: 2027, mes: 1 }. */
function proximoMes(ano, mes) {
  return mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
}

/**
 * nomeDoMes(10) → "outubro".
 * nomeDoMes(10, 2026) → "outubro de 2026".
 * Para começar com letra maiúscula na tela, use CSS (text-transform: capitalize).
 */
function nomeDoMes(mes, ano) {
  const nome = NOMES_DOS_MESES[mes - 1];
  if (!nome) return '';
  return ano ? `${nome} de ${ano}` : nome;
}

/**
 * Quantidade do jeito brasileiro, com a unidade.
 * textoDaQuantidade(2.5, "kg") → "2,5 kg"
 * textoDaQuantidade(1000, "un") → "1.000 un"
 * textoDaQuantidade(3) → "3"
 */
function textoDaQuantidade(quantidade, unidade) {
  const n = Number(quantidade);
  if (!Number.isFinite(n)) return '';
  const numero = n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unidade ? `${numero} ${unidade}` : numero;
}

// Só estes nomes ficam visíveis para os outros arquivos.
Object.assign(globalThis, {
  textoParaData, dataParaTexto, dataDeHoje, dataPorExtenso, dataCurta, diasAte, mesAtual, mesAnterior, proximoMes, nomeDoMes, textoDaQuantidade,
});
})();
