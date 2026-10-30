# Casa Via Matris: protótipo do painel principal

Primeira etapa do projeto de extensão (ODS 10): front-end funcional da página
principal do sistema de controle de **estoque, doações e finanças** da Casa Via Matris.

## Versão no ar

https://claude.ai/artifact/F35rATqA4U4auPk9hcAL25 (privada até ser compartilhada pelo menu "Compartilhar").
Cada pessoa que abre vê os próprios dados de exemplo; o que uma registra não aparece para as outras.

Para atualizar o site depois de mudar o código, gere a versão de publicação:

```bash
node ferramentas/publicar.js
```

Isso recria a pasta `publicar/` (não edite nada lá dentro; ela é gerada). Depois peça ao
Claude para publicar `publicar/index.html` no link acima.

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
node --test tests/store.test.js
```

## O que já funciona

- **Resumo do dia**: saldo em caixa, itens abaixo do mínimo, itens que vencem em até 15 dias e doações do mês.
- **Despensa**: cada item tem uma barra de quantidade com um tracinho no estoque mínimo.
  Verde = suficiente, laranja = abaixo do mínimo, vermelho = acabou. Os itens mais
  "apertados" aparecem primeiro. Dá para buscar pelo nome e filtrar por categoria.
- **Registrar movimentação**: 4 tipos (doação de itens, saída de itens, entrada de dinheiro,
  despesa). O formulário mostra só os campos daquele tipo. Doações podem cadastrar item novo.
- **Desfazer**: depois de registrar, o aviso tem um botão "Desfazer" por 20 segundos.
  O tempo pausa enquanto o mouse ou o foco do teclado estão em cima do aviso.
- **Histórico**: as 50 últimas movimentações, com filtro por estoque ou dinheiro. Quando
  há mais de 50, a tela avisa quantas existem no total.
- Os dados ficam salvos no navegador (localStorage) e sobrevivem a recarregar a página.

## Estrutura

```
index.html        a página (estrutura e textos)
css/styles.css    o visual (cores, fontes, layout, celular)
js/store.js       as regras de negócio e os dados (o "back-end de mentira")
js/app.js         a tela: desenha a página e responde aos cliques
tests/            testes automáticos das regras do store.js
```

A separação entre `store.js` e `app.js` é a decisão mais importante do protótipo.
A tela nunca mexe nos dados diretamente: ela pede ao store (`registrar`, `estornar`,
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

### Para o protótipo (uso hoje)

- **Privacidade (LGPD)**: os dados ficam em texto aberto no navegador. Qualquer pessoa
  que use o mesmo computador consegue ler. **Use só dados fictícios** até existir o back-end.
  Não publique no GitHub Pages com dados reais: lá o armazenamento é compartilhado entre
  todos os repositórios do mesmo usuário.
- As fontes vêm do Google Fonts, que recebe o IP de cada visitante. Para produção,
  baixe as fontes e sirva junto com o site.

### Para o back-end (próximas etapas)

- **Desfazer não pode apagar**: hoje o estorno remove o lançamento. Em finanças de uma ONG,
  o certo é um lançamento contrário (tipo `estorno`), mantendo o histórico para prestar contas.
- **Quem fez cada lançamento**: falta login e o autor em cada movimento. Sem isso não há auditoria.
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
