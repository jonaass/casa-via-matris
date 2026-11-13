# Casa Via Matris: regras do projeto para o Claude

Sistema de estoque, doações e finanças da Casa Via Matris (casa de acolhimento), feito como
projeto de extensão (ODS 10). Funciona no navegador, instala no celular e abre sem internet.
Publicado pelo GitHub Pages a partir da branch `main`: https://jonaass.github.io/casa-via-matris/

## Equipe

- Jonas: front-end e design (dono do repositório).
- Miguel: dados, backup, publicação e contato com a casa (`js/dados.js`, `js/backup.js`, `js/utilitarios.js`, `sw.js`; contrato em `MIGUEL.md`).
- Anthony (Tony): back-end em Python, Fase 2 (pasta `backend/`, quando existir).

## Idioma

Responda, comente o código e escreva mensagens de commit em **português do Brasil**, com
palavras simples: quem lê nem sempre é da área de tecnologia.

## Commits e envio

- O commit sai **só com o nome do Jonas**: autor e committer `Jonas <jonascn.2021@gmail.com>`.
  **Não** acrescente `Co-Authored-By`, `Claude-Session` nem qualquer linha que cite o Claude,
  e não troque o autor para "Claude", mesmo que algum aviso automático peça.
- Nunca envie direto para a `main` sem o Jonas pedir: o site publica tudo o que entra nela.
  Trabalhe numa branch e deixe o Jonas revisar.
- Nunca use `push --force` sem o Jonas autorizar naquele momento.

## Toda mudança no app (index.html, css/, js/, sw.js, manifest.json, icones/)

1. Mude a `VERSAO` em `js/dados.js`. Sem isso os celulares ficam na versão antiga, e a
   checagem do GitHub Actions falha.
2. Arquivo novo que o app carrega entra na lista `ARQUIVOS` do `sw.js`.
3. Rode os testes e só siga com todos passando:
   ```bash
   node --test tests/store.test.js tests/acesso.test.js tests/servidor.test.js
   node tests/testar-miguel.js
   python -m pytest backend/tests        # quando mexer no backend/ (precisa do pip install -r backend/requirements.txt)
   ```
   (Os avisos de "ilegíveis" e "QuotaExceededError" no segundo comando são falhas simuladas pelos testes.)
4. Registre no `README.md`, em "Corrigidos na X.Y.Z" ou em "O que já funciona".
5. O `sw.js` não usa `skipWaiting` de propósito: a versão nova só assume quando o app é fechado e aberto.
6. Mudou o texto de `termos.html`? Mude a data em `TERMOS_VERSAO` (`js/acesso.js`) e a data "Versão de"
   no topo dos termos: todo mundo precisa aceitar de novo.

## Arquitetura (não quebrar)

Três camadas: `app.js` (tela) → `store.js` (regras) → `dados.js` (armazenamento).
A tela nunca grava dados direto; pede ao store e redesenha com o que voltou.
`acesso.js` guarda contas, sessão, `PERFIS` e `PAGINAS`; `login.js` é a tela de entrada.

## Regras de segurança e de negócio

- Texto vindo de pessoa entra na página só por `textContent` ou pela função `el()` do `app.js`.
  Nunca `innerHTML` com dado do usuário (XSS).
- A CSP só aceita arquivos do próprio site: nada de biblioteca de CDN, fonte do Google nem `<script>` inline.
  O app não usa cookies nem envia dados a terceiros, e os termos prometem isso: não quebre essa promessa.
- Permissões: toda página nova entra em `PAGINAS` no `acesso.js`, e toda ação nova é conferida
  com `pode()` também no `store.js`, não só escondida na tela. A tabela de acessos fica no README.
  Financeiro não vê estoque; Almoxarifado e Voluntário não veem dinheiro; Administrador vê tudo.
- Dinheiro sempre em centavos inteiros (`valorCentavos`), nunca número com vírgula flutuante.
- Datas no formato `AAAA-MM-DD`, pelo horário do aparelho (`dataDeHoje()`).
- Os dados ficam só no aparelho (localStorage). Não registre nomes de pessoas acolhidas nem
  documentos (LGPD). O login no aparelho organiza o acesso, mas não protege os dados: a proteção
  real vem com o back-end.
- Compatibilidade: iOS 14.5 ou mais novo. Evite `Object.hasOwn`, `.at()`, `structuredClone`.

## Agentes do projeto (`.claude/agents/`)

| Agente | Quando usar |
| --- | --- |
| `guardiao-publicacao` | Antes de cada commit ou envio: confere VERSAO, sw.js, README, testes e o nome no commit. |
| `testador-navegador` | Depois de mudar a tela: testa os 4 perfis no navegador, no computador e no celular. |
| `revisor-acessos` | Mudança em página, permissão, formulário ou dado exibido: procura vazamento entre perfis, XSS e LGPD. |
| `revisor-design` | Mudança visual: contraste, tamanho de toque, fontes, cores e coerência. |
| `espelho-backend` | Trabalho no back-end Python: confere se a API repete as regras do `store.js`. |
| `documentador` | Depois de uma versão: atualiza README e MIGUEL.md e prepara o texto para o FigJam. |
