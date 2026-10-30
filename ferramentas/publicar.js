/*
 * Gera a pasta publicar/ com a versão do site para hospedar como Artifact do Claude.
 * Rodar na pasta do projeto: node ferramentas/publicar.js
 *
 * Por que existe: a hospedagem já coloca o cabeçalho da página (doctype, <head>,
 * charset, viewport) e a própria regra de segurança (CSP). Então a versão
 * publicada é o index.html sem essas partes; CSS e JS vão iguais.
 */
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const saida = path.join(raiz, 'publicar');

let html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const remover = [
  /<!doctype html>\s*/i,
  /<html[^>]*>\s*/,
  /<head>\s*/,
  /\s*<meta charset[^>]*>/,
  /\s*<meta name="viewport"[^>]*>/,
  /\s*<!-- CSP:[^>]*-->/,
  /\s*<meta http-equiv="Content-Security-Policy"[^>]*>/,
  /\s*<\/head>/,
  /\s*<body>/,
  /\s*<\/body>/,
  /\s*<\/html>\s*$/,
];
for (const trecho of remover) {
  // Falha alto se o index.html mudou de forma que o script não reconhece.
  if (!trecho.test(html)) throw new Error(`Não achei ${trecho} no index.html. Ajuste este script.`);
  html = html.replace(trecho, '');
}
// Na galeria do Claude o título é o nome da página, sem explicação depois.
html = html.replace(/<title>[^<]*<\/title>/, '<title>Casa Via Matris</title>');

fs.rmSync(saida, { recursive: true, force: true });
fs.mkdirSync(saida);
fs.writeFileSync(path.join(saida, 'index.html'), html.trim() + '\n');
// Cópia arquivo a arquivo: fs.cpSync derruba o Node no Windows quando o caminho tem acento ("Ação").
for (const pasta of ['css', 'js']) {
  fs.mkdirSync(path.join(saida, pasta));
  for (const arquivo of fs.readdirSync(path.join(raiz, pasta))) {
    fs.copyFileSync(path.join(raiz, pasta, arquivo), path.join(saida, pasta, arquivo));
  }
}

console.log(`Pronto: ${path.relative(process.cwd(), saida) || '.'} (index.html, css/, js/)`);
