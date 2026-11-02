# Casa Via Matris

Projeto de extensão (ODS 10): sistema de controle de **estoque, doações e finanças**
da Casa Via Matris. Funciona no navegador, instala no celular como um app e abre sem internet.

## Versão 1.0

Esta é a primeira versão que deixa de ser protótipo: tem tela de acesso e perfis. Os números 1.0.1 a 1.0.4
usados antes eram do protótipo. A primeira versão com acesso é a 1.0.0, corrigida na 1.0.5.

## Versão no ar

https://jonaass.github.io/casa-via-matris/ (atualiza sozinho a cada `git push` na branch `main`)

Cada aparelho tem as próprias contas e os próprios dados: o que uma pessoa registra não aparece em outro aparelho.

## Como abrir

Opção 1, mais simples: dê dois cliques em `index.html`. Testado no Edge (Chrome é o
mesmo motor). No Firefox, prefira a opção 2.

Opção 2, com servidor local (igual ao que vai acontecer com o back-end):

```bash
python -m http.server 8000
```

Depois abra http://localhost:8000.

Testes das regras de negócio (precisa do Node.js):

```bash
node --test tests/store.test.js tests/acesso.test.js
```

```bash
node tests/testar-miguel.js
```

Os testes também rodam sozinhos a cada envio, na aba Actions do GitHub. O site é publicado
mesmo se eles falharem: confira a aba depois de enviar.

## O que já funciona

- **Acesso**: entrada com e-mail e senha. O primeiro acesso no aparelho cria o administrador, que cadastra as outras pessoas com senha provisória. Cinco erros bloqueiam a conta por 15 minutos.
- **Perfis**: Administrador (tudo), Financeiro (dinheiro), Almoxarifado (estoque e doações) e Voluntário (consulta o estoque e registra doações e saídas).
- **Resumo do dia**: saldo em caixa, itens abaixo do mínimo, itens que vencem em até 15 dias e doações do mês.
- **Despensa**: cada item tem uma barra de quantidade com um tracinho no estoque mínimo.
  Verde = suficiente, laranja = abaixo do mínimo, vermelho = acabou. Os itens mais
  "apertados" aparecem primeiro. Dá para buscar pelo nome e filtrar por categoria.
- **Registrar movimentação**: 4 tipos (doação de itens, saída de itens, entrada de dinheiro,
  despesa). O formulário mostra só os campos daquele tipo. Doações podem cadastrar item novo.
- **Desfazer**: cada linha do histórico tem um botão "Desfazer", com confirmação. Logo depois de registrar, o aviso também oferece o botão por 20 segundos.
  O tempo pausa enquanto o mouse ou o foco do teclado estão em cima do aviso.
- **Histórico**: as 50 últimas movimentações, com filtro por estoque ou dinheiro. Quando
  há mais de 50, a tela avisa quantas existem no total.
- **Backup**: baixa 3 planilhas (estoque, doações, dinheiro) e restaura delas, mesmo depois de editadas no Excel. Avisa quando o último backup tem mais de 7 dias.
- **Dados de exemplo**: aparecem na primeira abertura. "Começar do zero" apaga tudo para o uso real.
- **App no celular**: instala na tela inicial e abre sem internet.
- Os dados ficam salvos no aparelho (localStorage) e sobrevivem a recarregar a página.

## Estrutura

```
index.html          a página (estrutura e textos)
css/styles.css      o visual (cores, fontes, layout, celular)
js/utilitarios.js   datas e quantidades no formato brasileiro
js/dados.js         a única parte que lê e grava no aparelho
js/store.js         as regras de negócio (o que pode ser gravado)
js/backup.js        planilhas: baixar e restaurar
js/acesso.js        contas, perfis, sessão e registro de atividades
js/login.js         a tela de acesso
js/app.js           a tela: desenha a página e responde aos cliques
sw.js               guarda os arquivos para abrir sem internet
manifest.json       nome e ícones do app instalado
tests/              testes automáticos
ferramentas/        gerar ícones e planilhas de teste
MIGUEL.md           contrato detalhado de dados.js, backup.js e utilitarios.js
```

A separação em camadas é a decisão mais importante do projeto: tela (`app.js`) → regras
(`store.js`) → armazenamento (`dados.js`). A tela nunca mexe nos dados diretamente: ela pede ao store (`registrar`, `estornar`,
`resumo`) e redesenha com o que voltou. Quando o back-end em Python ficar pronto,
cada função do `store.js` passa a fazer um `fetch()` para a API. Como `fetch` é
assíncrono, o `app.js` vai precisar de `await` nessas chamadas e de desativar o botão
enquanto espera a resposta (senão dois cliques viram dois lançamentos).

## Próximo passo: back-end em Python

Sugestão para o Anthony, alinhada ao que o grupo usa na faculdade:

- **Flask** ou **FastAPI** servindo estes mesmos arquivos e uma API JSON.
- **SQLite** no começo (um arquivo só, sem instalar servidor de banco).
- Rotas que espelham o `store.js`:

| Função no store.js     | Rota sugerida                       |
| ---------------------- | ----------------------------------- |
| `itens()`              | `GET /api/itens`                    |
| `movimentos()`         | `GET /api/movimentos`               |
| `registrar(entrada)`   | `POST /api/movimentos`              |
| `estornar(id)`         | `POST /api/movimentos/{id}/estorno` |
| `resumo()`             | `GET /api/resumo`                   |

- Tabelas: `itens`, `movimentos`, `lotes` (validade por lote) e `usuarios`.
- As validações do `store.js` precisam ser **repetidas no servidor**: o navegador
  pode ser manipulado, então a regra que vale de verdade é a do back-end.

## Riscos

Encontrados na revisão do protótipo. Os marcados como corrigidos têm teste em `tests/`.

### Corrigidos nesta versão

- Desfazer uma movimentação apagava a validade do item (o alerta de vencimento sumia).
- "1.000" na quantidade virava 1. Agora segue o formato brasileiro.
- Datas impossíveis (31/02, mês 19) eram aceitas.
- Duas abas abertas sobrescreviam os dados uma da outra.
- Dados salvos corrompidos deixavam a tela em branco.
- Tracinho do mínimo e bordas dos campos com contraste baixo demais (abaixo do WCAG AA).
- No celular, a página estourava a largura e o formulário ficava no fim.
- O aviso com "Desfazer" sumia em 8 s e podia não ser lido pelo leitor de tela.

### Para o uso hoje

- **O login ainda não protege os dados**: sem back-end, ele controla quem usa o aparelho pela tela, mas não é um cofre. Os dados da casa seguem abertos no navegador, e quem souber usar as ferramentas do navegador consegue ler ou burlar as regras. A proteção real só vem com o servidor.
- **Recados na tela de entrada**: mostram as doações de itens mais recentes antes do login, para quem estiver com o aparelho. Nunca mostram dinheiro, doadores nem observações.
- **Contas por aparelho**: as contas não vão para outro aparelho nem para as planilhas. Quem abre primeiro um aparelho sem contas vira administrador.
- **Código de recuperação**: é mostrado uma vez. Se o único administrador perder a senha e o código, o painel fica inacessível; só uma pessoa técnica recupera os dados pelo navegador.
- **Privacidade (LGPD)**: os dados e as planilhas ficam em texto aberto, sem senha. Quem usar
  o aparelho consegue ler. Não registre nomes de pessoas acolhidas nem documentos, e guarde as
  planilhas em local protegido.
- **Mesma origem no GitHub Pages**: todos os sites de `jonaass.github.io` dividem o armazenamento
  do navegador. Uma falha de script em outro repositório dessa conta poderia ler ou apagar os dados.
  Para uso real com dados da casa, publique em um domínio próprio.
- **Backup manual**: se o aparelho quebrar, só existe o que foi baixado. O app não tem como confirmar
  que o arquivo chegou à pasta Downloads, então a pessoa precisa conferir.
- **Importação não aplica as regras**: ela restaura registros, sem mexer no estoque nem conferir saldo.
- **Instalação no Android**: pelo navegador da Samsung, o Play Protect pode bloquear o app. A causa é o pacote gerado por esse navegador, não o site. Instale pelo Chrome; o app mostra uma faixa orientando isso.
- **VERSAO**: publicar sem mudar a `VERSAO` no `js/dados.js` deixa os celulares na versão antiga.
- As fontes vêm do Google Fonts, que recebe o IP de cada visitante. Para produção,
  baixe as fontes e sirva junto com o site.

### Para o back-end (próximas etapas)

- **Desfazer não pode apagar**: hoje o estorno remove o lançamento. Em finanças de uma ONG,
  o certo é um lançamento contrário (tipo `estorno`), mantendo o histórico para prestar contas.
- **Quem fez cada lançamento**: o aparelho guarda um registro de atividades, mas ele pode ser alterado por quem mexer no navegador. A auditoria confiável precisa ficar no servidor.
- **Concorrência**: duas pessoas tirando o último café ao mesmo tempo passam na checagem e o
  estoque fica negativo. Use transação, ou
  `UPDATE itens SET quantidade = quantidade - ? WHERE id = ? AND quantidade >= ?`
  conferindo quantas linhas mudaram.
- **Dinheiro em Python**: guarde em centavos (`int`) ou `Decimal`, nunca `float`.
- **Fuso horário**: o servidor deve usar `ZoneInfo("America/Sao_Paulo")`. Em UTC, às 22h
  de Brasília já seria "amanhã".
- **Validade por lote**: hoje cada item guarda só a validade mais próxima. Crie a tabela `lotes`.
- **Saldo por data**: o saldo é checado só no total de hoje; uma despesa lançada com data
  antiga pode deixar um dia passado negativo no extrato.
- **Erros com campo**: a API deve responder `{ "erro": "...", "campo": "valor" }`, em vez de
  a tela adivinhar o campo pelo texto da mensagem.
- **Cabeçalhos HTTP**: mande a CSP como cabeçalho e inclua `frame-ancestors 'none'`
  (contra clickjacking), que não funciona na tag `<meta>`.
