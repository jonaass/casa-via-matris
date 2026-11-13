/*
 * sw.js — Miguel
 *
 * Service worker: guarda os arquivos do app no celular para ele abrir sem internet.
 * Fica na raiz do projeto (ao lado do index.html), senão não controla o app inteiro.
 *
 * Como atualizar o app depois de publicado:
 *   1. Mude a VERSAO no js/dados.js (ex.: "1.0.0" → "1.0.1").
 *   2. Publique (git push). Na próxima vez que o celular abrir o app com internet,
 *      ele baixa tudo de novo; depois de fechar e abrir o app, já é a versão nova.
 * Sem mudar a VERSAO, o celular continua usando os arquivos antigos guardados.
 *
 * A lista ARQUIVOS tem que bater com os arquivos que existem no site: se faltar um,
 * a versão nova não instala (e o celular continua na anterior, que funciona).
 */
'use strict';

importScripts('js/dados.js'); // só para ler a VERSAO; um lugar só para mudar

const CACHE = 'via-matris-' + VERSAO;

const ARQUIVOS = [
  './',
  'index.html',
  'termos.html',
  'css/styles.css',
  'js/utilitarios.js',
  'js/dados.js',
  'js/store.js',
  'js/backup.js',
  'js/acesso.js',
  'js/login.js',
  'js/app.js',
  'manifest.json',
  'icones/icone-192.png',
  'icones/icone-512.png',
  'icones/icone-maskable-512.png',
  'icones/icone-apple-180.png',
  // As fontes ficam no próprio site: nenhum pedido sai para o Google Fonts.
  'fontes/atkinson-hyperlegible-latin-400-normal.woff2',
  'fontes/atkinson-hyperlegible-latin-700-normal.woff2',
  'fontes/hanken-grotesk-latin-300-normal.woff2',
  'fontes/hanken-grotesk-latin-400-normal.woff2',
  'fontes/hanken-grotesk-latin-600-normal.woff2',
];

// Instalação: baixa todos os arquivos da versão nova. Se faltar um, a instalação falha
// e o celular continua com a versão anterior, que funciona.
// Sem skipWaiting de propósito: a versão nova só assume quando o app é fechado e aberto de novo.
// Assumir com a página aberta entregava o app.js novo (carregado depois do login) para uma
// página ainda antiga, e o painel ficava em branco.
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ARQUIVOS.map((a) => new Request(a, { cache: 'reload' })))),
  );
});

// Ativação: apaga os arquivos das versões antigas. Os DADOS não são apagados:
// eles ficam no localStorage, não aqui.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        // Também apaga o antigo "via-matris-fontes", do tempo em que as fontes vinham do Google.
        nomes.filter((n) => n.startsWith('via-matris-') && n !== CACHE)
          .map((n) => caches.delete(n)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);

  if (url.origin !== self.location.origin) return;

  // Arquivos do app: responde com o guardado; se não tiver, busca na internet.
  evento.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardado = await cache.match(pedido, { ignoreSearch: true });
      if (guardado) return guardado;
      try {
        return await fetch(pedido);
      } catch (e) {
        // Sem internet e abrindo uma página: mostra o app mesmo assim.
        if (pedido.mode === 'navigate') return cache.match('index.html');
        throw e;
      }
    }),
  );
});
