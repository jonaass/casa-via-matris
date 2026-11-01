# Parte do Miguel: dados, backup, utilitários e publicação

Feita em cima do primeiro front do Jonas: mesmas pastas (`js/`, `css/`), mesmos nomes de campo e de tipo, mesmas cores no ícone. Já integrada ao projeto; veja a seção "Integração com o front".

| Arquivo | O que faz |
|---|---|
| `js/dados.js` | Única parte que lê e grava no celular (localStorage). Guarda a `VERSAO`. Traz uma vez os dados do protótipo. |
| `js/backup.js` | Planilhas CSV de backup (estoque, doações e dinheiro): baixar e importar. |
| `js/utilitarios.js` | Datas, meses e quantidades no formato brasileiro. |
| `manifest.json`, `sw.js`, `icones/` | Fazem o app instalar no celular e abrir sem internet. |
| `tests/testar-miguel.js` | 34 testes automáticos (`node tests/testar-miguel.js`). |
| `ferramentas/*.py` | Opcional, fora do app: gera os ícones e planilhas de teste. |

Cada arquivo deixa visíveis só as funções do contrato abaixo. O resto fica escondido dentro dele, para não dar conflito de nome com o `store.js` e o `app.js`.

## O que mudou em relação ao plano, por causa do front

| Plano | Front do Jonas | Como ficou |
|---|---|---|
| 2 coleções: `dinheiro` e `doacoes` | Tem **estoque** (itens com mínimo e validade) e saída de itens | **3 coleções:** `dinheiro`, `doacoes` (doações que chegam e itens que saem) e `itens` (o estoque). Portanto, **3 planilhas**. |
| Tipos `entrada`/`despesa` | `entrada_dinheiro`, `saida_dinheiro`, `doacao_item`, `saida_item` | Os tipos do front. Na planilha aparecem como Entrada, Despesa, Doação e Saída. |
| Campo `codigo` | Campo `id` | Continua `codigo`, como combinado no contrato. A migração troca `id` por `codigo`. |
| Arquivos na raiz | `js/` e `css/styles.css` | `js/dados.js`, `js/backup.js`, `js/utilitarios.js`. O `sw.js` e o `manifest.json` ficam na raiz. |

**Para confirmar na call:** as 3 coleções/planilhas e os nomes de campo abaixo. Se o Antônio mudar algum campo, é só ajustar a constante `COLUNAS` no começo do `js/backup.js`.

---

## Contrato

### `js/dados.js` (quem chama: Antônio e `backup.js`)

| Função | Devolve |
|---|---|
| `lerTudo(colecao)` | Lista de registros (cópias). `colecao` é `"dinheiro"`, `"doacoes"` ou `"itens"`. |
| `salvarRegistro(colecao, registro)` | `{ ok: true, registro }` ou `{ ok: false, erros: [...] }`. Se o `codigo` já existir, substitui (é assim que a edição funciona). |
| `substituirColecao(colecao, lista)` | `{ ok: true }` ou `{ ok: false, erros: [...] }`. Grava a lista inteira de uma vez, para mudanças em lote. |
| `removerRegistro(colecao, codigo)` | `{ ok: true }` ou `{ ok: false, erros: [...] }`. |
| `lerConfig()` / `salvarConfig(mudancas)` | Configurações. `salvarConfig` junta as mudanças com o que já existe. |
| `aoMudarEmOutraAba(funcao)` | Chama `funcao(colecao)` quando outra aba grava. Substitui o `window.addEventListener('storage', ...)` do `app.js`. |
| `pedirArmazenamentoPersistente()` | Promise com `true` ou `false`. Chamar uma vez ao abrir o app. |
| `VERSAO` | Texto, ex.: `"1.0.0"`. O Jonas mostra na tela. |

Campos de cada coleção (os mesmos que o `store.js` do protótipo usa):

```
dinheiro: { codigo, tipo: "entrada_dinheiro" | "saida_dinheiro", data: "AAAA-MM-DD", valorCentavos, descricao, pessoa, criadoEm }
doacoes:  { codigo, tipo: "doacao_item" | "saida_item", data, itemId, quantidade, descricao, pessoa, criadoEm }
itens:    { codigo, nome, categoria: "Alimentos" | "Higiene" | "Limpeza", unidade, quantidade, minimo, validade }
```

O `dados.js` não confere esses campos: validar é trabalho das Regras. Ele só exige um `codigo` (texto).

**Migração do protótipo.** Na primeira leitura, se existirem dados do protótipo (chave `via-matris:dados:v1`) e as coleções novas estiverem vazias, eles são copiados para as três coleções, uma vez só. Ou entram as três, ou nenhuma: se faltar espaço, tenta de novo na próxima abertura. A chave antiga continua intacta.

**Proteções.** Se os dados guardados estragarem, o app abre vazio em vez de travar, e o texto estragado fica em `via-matris:<colecao>:corrompido`. Com o armazenamento cheio ou bloqueado, a gravação devolve um erro em português, em vez de perder o dado sem avisar.

### `js/backup.js` (quem chama: Jonas)

| Função | Devolve |
|---|---|
| `baixarTodasAsPlanilhas()` | Promise: `{ ok, arquivos: [...], erros: [...] }`. Baixa as três, na ordem estoque, doações, dinheiro. É para um botão "Fazer backup" só. |
| `baixarPlanilha(colecao)` | Promise: `{ ok: true, nomeDoArquivo }` ou `{ ok: false, erros }`. Anota a data do backup só se o download der certo. |
| `importarPlanilha(colecao, texto)` | `{ ok, importados, ignorados, erros }`. |
| `restaurarArquivos(arquivos, antesDeGravar?)` | Promise com o mesmo resultado. Reconhece cada planilha pelo cabeçalho e importa na ordem certa. |
| `diasDesdeUltimoBackup(colecao?)` | Número de dias, ou `null` se nunca fez. Sem `colecao`, devolve a planilha mais atrasada das três. |
| `gerarPlanilha(colecao)` | Texto CSV (usado pelas outras funções e pelos testes). |

As planilhas (separadas por `;`, com acentos certos no Excel):

| Arquivo | Colunas |
|---|---|
| `via-matris-estoque-AAAA-MM-DD.csv` | Código, Item, Categoria, Unidade, Quantidade em estoque, Estoque mínimo, Validade mais próxima |
| `via-matris-doacoes-AAAA-MM-DD.csv` | Código, Data, Movimento (Doação/Saída), Código do item, Item, Quantidade, Unidade, Quem doou / para onde foi, Observação |
| `via-matris-dinheiro-AAAA-MM-DD.csv` | Código, Data, Movimento (Entrada/Despesa), Valor (R$), Descrição, Quem |

Como funciona a importação:
- **Para restaurar tudo, importe o estoque primeiro.** Cada doação aponta para um item do estoque. Se o item não existir, a linha é recusada com essa explicação.
- `ok: false` quando o arquivo inteiro não serve (vazio ou de outra coleção) ou quando não há espaço. Nesses casos nada é gravado: a planilha entra inteira ou não entra.
- Linhas com texto maior que o limite do formulário, data de movimento no futuro ou valor absurdo são recusadas.
- Item sem Código com nome que já existe conta como `ignorados`, para não duplicar.
- A importação não mexe no estoque nem confere saldo: ela restaura registros. Uma doação escrita à mão na planilha entra no histórico, mas não soma na quantidade do item.
- Registro com `codigo` existente não é atualizado: corrigir uma linha no Excel e reimportar não muda nada.
- Uma linha com problema é pulada, e o motivo aparece com o número dela, ex.: `Linha 5: Data inválida ("31/02/2026"), use DD/MM/AAAA.` As outras linhas entram.
- Registro com `codigo` que já existe conta como `ignorados`. Importar o mesmo arquivo duas vezes não duplica nada.
- Aceita planilha feita à mão: sem a coluna Código, com `,` no lugar de `;`, e com "doacao" ou "DOAÇÃO" na coluna Movimento. Sem o Código do item, a doação é ligada ao item pelo nome.
- Um texto que começa com `=`, `+`, `-` ou `@` vai para a planilha com um apóstrofo na frente, para o Excel não executar uma fórmula escondida num nome de doador.

**Downloads dentro do claude.ai.** Publicado como Artifact, o navegador bloqueia downloads diretos. Nesse caso o `backup.js` usa o recurso de downloads do claude.ai, que pergunta à pessoa se quer salvar o arquivo. Para isso funcionar, quem publicar o Artifact precisa declarar a capacidade `downloads`. No GitHub Pages esse recurso não existe, e o download é o normal do navegador.

### `js/utilitarios.js` (quem chama: Jonas e Antônio)

| Função | Exemplo | Substitui no `app.js` |
|---|---|---|
| `dataDeHoje()` | `"2026-10-29"` (horário do celular) | `dataISO(new Date())` |
| `dataPorExtenso(data?)` | `"quinta-feira, 29 de outubro de 2026"` | `dataLonga.format(hoje)` |
| `dataCurta(data)` | `"29 de out."` | `dataCurta.format(daISO(m.data))` |
| `diasAte(data)` | dias até a validade (negativo se venceu) | `diasAte(item.validade)` |
| `textoDaQuantidade(qtd, unidade)` | `"2,5 kg"` | `quantidadeTexto(q, unidade)` |
| `nomeDoMes(mes, ano?)` | `"outubro de 2026"` | `rotuloMes(aaaamm)` |
| `textoParaData(texto)` | `"29/10/2026"` → `"2026-10-29"`; data que não existe → `null` | |
| `dataParaTexto(data)` | `"2026-10-29"` → `"29/10/2026"` | |
| `mesAtual()` | `{ ano: 2026, mes: 10 }` | |
| `mesAnterior(ano, mes)` / `proximoMes(ano, mes)` | `mesAnterior(2026, 1)` → `{ ano: 2025, mes: 12 }` | |

O mês vai sempre de **1 a 12** (nunca 0 a 11, como no `Date` do JavaScript).

---

## Integração com o front (já feita)

- `index.html` carrega, nesta ordem: `utilitarios.js`, `dados.js`, `store.js`, `backup.js`, `app.js`.
- O registro do `sw.js` fica no `app.js`, e não num `<script>` no HTML: a CSP do projeto bloqueia script inline.
- O `store.js` não tem mais armazenamento próprio: lê e grava pelo `dados.js`. É ele que fornece `textoParaCentavos`, `centavosParaTexto` e `gerarCodigo`.
- O backup fica em **Backup e sistema**, na barra lateral.

## Publicação no GitHub Pages

O repositório é [jonaass/casa-via-matris](https://github.com/jonaass/casa-via-matris), e o Pages já publica a branch `main` em https://jonaass.github.io/casa-via-matris/. Para os outros integrantes enviarem código: *Settings → Collaborators*.

**A cada nova versão:**
1. Mude `VERSAO` no `js/dados.js`. Sem isso, os celulares continuam com os arquivos antigos.
2. Se criou um arquivo novo, inclua-o na lista `ARQUIVOS` do `sw.js`.
3. Rode `node tests/testar-miguel.js` e `node --test tests/store.test.js`. Os testes falham se faltar arquivo na lista.
4. Rode `git add .`, `git commit -m "Versão 1.0.1: ..."` e `git push`.
5. No celular: abra o app uma vez com internet, feche e abra de novo. A versão nova aparece.

**Os dados não vão para o GitHub.** Eles ficam só no celular do responsável. O GitHub guarda apenas o código. Por isso as planilhas de backup são a única cópia de segurança.

## Teste no celular do responsável (checklist)

Android (Chrome):
- [ ] Abrir o endereço do GitHub Pages e tocar em **⋮ → Instalar app**.
- [ ] O ícone da casinha dourada aparece, e o app abre sem a barra do navegador.
- [ ] Lançar uma doação, uma saída, uma entrada e uma despesa. Fechar e abrir de novo: os dados continuam lá.
- [ ] Ligar o **modo avião** e abrir o app: abre com as mesmas fontes e cores, e dá para lançar dados.
- [ ] Baixar as 3 planilhas e abrir no app Arquivos: acentos certos, valores com vírgula.
- [ ] Apagar um lançamento de teste e importar a planilha: ele volta, e os outros aparecem como "já existiam".
- [ ] Publicar uma versão nova e conferir que o número muda no celular depois de abrir duas vezes.

iPhone (Safari): **Compartilhar → Adicionar à Tela de Início** e repetir o checklist. No iPhone, o app instalado e o Safari guardam dados separados: lançar sempre pelo ícone instalado.

Combinar com o responsável: **fazer backup toda semana** e guardar as planilhas fora do celular (e-mail, Google Drive).

## Testar no computador

```bash
node tests/testar-miguel.js
```

Para ver o app funcionando:

```bash
python -m http.server 8000
```

Depois, abra `localhost:8000`. Para ver o service worker: F12 → *Application → Service workers / Cache storage*. Se uma mudança não aparecer, é o cache: marque *Update on reload* ali, ou mude a `VERSAO`.

Planilhas de teste com nomes fictícios: `python3 ferramentas/gerar_planilha_teste.py`.
