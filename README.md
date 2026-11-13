# Casa Via Matris

Projeto de extensão (ODS 10): sistema de controle de **estoque, doações e finanças**
da Casa Via Matris. Funciona no navegador, instala no celular como um app e abre sem internet.

## Versão 1.2

Na 1.2.0 entraram os **Termos de uso e o Aviso de privacidade** (`termos.html`), com aceite
obrigatório e registrado em cada conta. As fontes passaram a ser servidas pelo próprio site, então
o app não envia nada a outros servidores e não usa cookies. Doações de itens sem nome também ficam
como "Doador anônimo", e a página Registrar fica centralizada.

Na 1.1.0 o painel deixou de ser uma página única e longa: cada assunto tem a própria página.
Também entraram o gráfico de entradas e saídas, o filtro de mês no histórico, a tabela de acessos
por perfil e o "Doador anônimo" automático.

A 1.0 foi a primeira versão sem cara de protótipo, com tela de acesso e perfis. Os números 1.0.1 a 1.0.4
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

- **Termos de uso e privacidade**: `termos.html` explica, em linguagem simples, onde ficam os dados,
  o que não pode ser registrado (dados de pessoas acolhidas), as responsabilidades e os direitos da LGPD.
  Criar o administrador e o primeiro acesso de cada pessoa exigem marcar o aceite. O aceite fica guardado
  na conta com a data, e a página Acessos mostra quem aceitou e quando. Ao mudar o texto dos termos, mude
  `TERMOS_VERSAO` em `js/acesso.js`: todo mundo aceita de novo na próxima entrada.
- **Sem cookies e sem terceiros**: o app não grava cookies nem usa rastreamento. Ele usa só o armazenamento
  do navegador, que é necessário para funcionar, por isso não há aviso de cookies. As fontes ficam em `fontes/`
  (licença SIL OFL 1.1).
- **Acesso**: entrada com e-mail e senha. O primeiro acesso no aparelho cria o administrador, que cadastra as outras pessoas com senha provisória. Cinco erros bloqueiam a conta por 15 minutos.
- **Perfis**:

  | Página ou ação | Administrador | Financeiro | Almoxarifado | Voluntário |
  | --- | :-: | :-: | :-: | :-: |
  | Visão geral | ✓ | ✓ (só dinheiro) | ✓ (só estoque) | ✓ (só estoque) |
  | Estoque | ✓ | | ✓ | ✓ |
  | Registrar dinheiro | ✓ | ✓ | | |
  | Registrar itens | ✓ | | ✓ | ✓ |
  | Histórico | ✓ (tudo) | ✓ (só dinheiro) | ✓ (só estoque) | |
  | Desfazer | ✓ | ✓ | ✓ | |
  | Acessos e backup | ✓ | | | |

  A lista de permissões fica em `js/acesso.js` (`PERFIS` e `PAGINAS`); os testes em `tests/acesso.test.js` conferem esta tabela.
- **Páginas**: Visão geral, Estoque, Registrar, Histórico e Acessos, cada uma com endereço próprio
  (`#/estoque`, `#/historico`...). O botão Voltar do celular funciona. Quem abre uma página fora do
  próprio perfil vê "Sem permissão"; endereço que não existe mostra "Página não encontrada".
- **Visão geral**: saldo em caixa, itens abaixo do mínimo, itens que vencem em até 15 dias e doações do mês.
  Cada número leva à página do assunto. Cada perfil vê só os números da própria área.
- **Gráfico de entradas e saídas**: barras por mês, nos últimos 6 meses, só para Financeiro e Administrador.
  Mostra os valores ao passar o dedo, o mouse ou o Tab, e tem a mesma informação em tabela.
  Azul = entrou, laranja = saiu: verde e vermelho se confundem para quem tem daltonismo.
- **Estoque**: cada item tem uma barra de quantidade com um tracinho no estoque mínimo.
  Verde = suficiente, laranja = abaixo do mínimo, vermelho = acabou. Os itens mais
  "apertados" aparecem primeiro. Dá para buscar pelo nome e filtrar por categoria.
- **Registrar movimentação**: 4 tipos (doação de itens, saída de itens, entrada de dinheiro,
  despesa). O formulário mostra só os campos daquele tipo. Doações podem cadastrar item novo.
  Doação de itens ou entrada de dinheiro sem nome fica registrada como **"Doador anônimo"** (regra no `store.js`).
- **Desfazer**: cada linha do histórico tem um botão "Desfazer", com confirmação. Logo depois de registrar, o aviso também oferece o botão por 20 segundos.
  O tempo pausa enquanto o mouse ou o foco do teclado estão em cima do aviso.
- **Histórico**: filtro por **mês** e por estoque ou dinheiro. Com um mês escolhido, mostra o total
  que entrou e saiu nele. Mostra até 50 linhas e avisa quando há mais. No celular, cada
  movimentação vira um cartão, para o valor não ficar escondido à direita.
- **Acessos** (só Administrador): tabela do que cada perfil vê, cadastro de pessoas, troca de perfil,
  senha provisória e registro de atividades. A tabela é montada das mesmas listas que as regras usam.
- **Backup**: baixa 3 planilhas (estoque, doações, dinheiro) e restaura delas, mesmo depois de editadas no Excel. Avisa quando o último backup tem mais de 7 dias.
- **Dados de exemplo**: aparecem na primeira abertura. "Começar do zero" apaga tudo para o uso real.
- **App no celular**: instala na tela inicial e abre sem internet.
- **Dados do banco (1.3.0)**: aberto pelo servidor Python, o app entra também no servidor e traz do banco só o que
  o perfil pode ver (Financeiro não recebe estoque; Almoxarifado e Voluntário não recebem dinheiro). Nesta etapa o
  banco só é lido: registrar e desfazer ficam desligados nesse modo, para nada lançado só no aparelho se perder.
  A conta precisa ter a mesma senha no aparelho e no servidor: trocar a senha (inclusive a provisória do primeiro
  acesso) troca nos dois. Vale o perfil do servidor, e sair apaga do aparelho a cópia dos dados do banco.
- Os dados ficam salvos no aparelho (localStorage) e sobrevivem a recarregar a página.

## Estrutura

```
index.html          a página (estrutura e textos)
termos.html         Termos de uso e Aviso de privacidade
fontes/             as fontes do app e as licenças delas
css/styles.css      o visual (cores, fontes, layout, celular)
js/utilitarios.js   datas e quantidades no formato brasileiro
js/dados.js         a única parte que lê e grava no aparelho
js/store.js         as regras de negócio (o que pode ser gravado)
js/backup.js        planilhas: baixar e restaurar
js/acesso.js        contas, perfis, sessão e registro de atividades
js/login.js         a tela de acesso
js/app.js           a tela: troca de página, desenha e responde aos cliques
sw.js               guarda os arquivos para abrir sem internet
manifest.json       nome e ícones do app instalado
tests/              testes automáticos
ferramentas/        gerar ícones e planilhas de teste
MIGUEL.md           contrato detalhado de dados.js, backup.js e utilitarios.js
CLAUDE.md           regras do projeto para o Claude (commits, VERSAO, segurança)
.claude/agents/     agentes do projeto: publicação, testes, acessos, design, back-end e documentação
```

A separação em camadas é a decisão mais importante do projeto: tela (`app.js`) → regras
(`store.js`) → armazenamento (`dados.js`). A tela nunca mexe nos dados diretamente: ela pede ao store (`registrar`, `estornar`,
`resumo`) e redesenha com o que voltou. Quando o back-end em Python ficar pronto,
cada função do `store.js` passa a fazer um `fetch()` para a API. Como `fetch` é
assíncrono, o `app.js` vai precisar de `await` nessas chamadas e de desativar o botão
enquanto espera a resposta (senão dois cliques viram dois lançamentos).

## Back-end em Python (Fase 2, em andamento)

Fica na pasta `backend/`, com **FastAPI** e **SQLite**. Como rodar, criar contas e importar as
planilhas para o banco: veja [backend/README.md](backend/README.md).

Quando o site é aberto pelo servidor, depois do login ele **puxa os dados do banco** para o aparelho
(`js/servidor.js`) e a tela continua igual. No GitHub Pages nada muda: o app segue com os dados do aparelho.

| Função no store.js     | Rota                                 | Situação |
| ---------------------- | ------------------------------------ | -------- |
| `itens()`              | `GET /api/itens`                     | pronta   |
| `movimentos()`         | `GET /api/doacoes` e `GET /api/dinheiro` | pronta |
| (login)                | `POST /api/entrar`, `POST /api/sair`, `GET /api/eu`, `POST /api/trocar-senha` | pronta |
| `registrar(entrada)`   | `POST /api/movimentos`               | próxima etapa |
| `estornar(id)`         | `POST /api/movimentos/{id}/estorno`  | próxima etapa |
| `resumo()`             | calculado no aparelho com os dados puxados | |

- As validações do `store.js` precisam ser **repetidas no servidor**: o navegador
  pode ser manipulado, então a regra que vale de verdade é a do back-end.
- Falta: tabela `lotes` (validade por lote), gravação pela API e trocar o login do aparelho pelo do servidor.

## Riscos

Encontrados na revisão do protótipo. Os marcados como corrigidos têm teste em `tests/`.

### Corrigidos na 1.3.0

- Com o registrar desligado, a tela tentava marcar uma opção que não existia e dava erro no console. Agora confere antes.
- Testado em Chromium, Firefox e WebKit (motor do Safari), no computador e no tamanho de celular, com os 4 perfis.

### Corrigidos na 1.2.0

- As fontes vinham do Google Fonts, que recebia o IP de cada pessoa que abria o app. Agora ficam no próprio site.
- Doação de itens sem nome aparecia como "—" no histórico. Agora fica "Doador anônimo", como a entrada de dinheiro.

### Corrigidos na 1.1.2

Vieram da auditoria de 10/11/2026.

- Depois de uma publicação, quem fazia login recebia o `app.js` novo numa página ainda antiga, e o painel ficava em branco. Agora a versão nova só assume quando o app é fechado e aberto de novo.
- O código de recuperação aparecia uma vez só e não dava para gerar outro. O menu Conta ganhou "Novo código de recuperação", que pede a senha.
- Com o armazenamento bloqueado pelo navegador, a tela de entrada não aparecia. Agora ela explica o que liberar.
- Num aparelho sempre ligado, a data do formulário ficava no dia anterior depois da meia-noite.
- Depois de Sair, a próxima pessoa podia cair em "Sem permissão", porque o endereço da página anterior continuava.
- Trocar senha com a sessão vencida mostrava um erro sem saída. Agora volta para a entrada.

### Corrigidos na 1.1.1

- O eixo do gráfico ia a 4 vezes o maior valor, e as barras ficavam baixas.
- Os botões "Ir para a Visão geral" das telas "Sem permissão" e "Página não encontrada" saíam sublinhados.
- Um perfil trocado em outra aba não atualizava o menu nesta.
- Com a sessão vencida, as ações de administrador mostravam "Seu perfil não pode fazer isso" em vez de voltar para a entrada.
- No celular, "Histórico" e "Acessos" ficavam escondidos numa rolagem do menu. Agora o menu quebra em duas linhas.
- "Registrar movimentação" fica antes dos indicadores, à vista sem rolar.
- No toque, a dica do gráfico sumia assim que o dedo saía da tela. Agora fica até tocar fora; Esc também fecha.
- Dados ilegíveis ou registros incompletos sumiam da tela sem aviso, e o próximo registro podia apagá-los. Agora uma faixa avisa, e nada é gravado por cima.
- Dois toques rápidos em "Cadastrar" criavam duas contas com o mesmo e-mail.
- Cada registro relia e convertia todo o armazenamento várias vezes. Agora a conversão fica em memória enquanto o texto guardado não muda.

### Corrigidos na 1.1.0

- No celular, a tabela do histórico escondia a coluna do valor à direita. Agora cada linha vira um cartão.
- "Doações neste mês" contava as doações em dinheiro para o Almoxarifado e as de itens para o Financeiro.
- O administrador que mudava o próprio perfil continuava vendo as páginas do perfil antigo até recarregar.
- Um endereço malformado (como `#/%E0`) deixava a tela quebrada.
- Com a sessão vencida e a página aberta, registrar mostrava "Seu perfil não pode fazer isso". Agora volta para a entrada.
- `Object.hasOwn` e `.at()` não existem em iPhones com iOS anterior ao 15.4 e foram trocados. O app pede iOS 14.5 ou mais novo.
- O repositório não tinha `.gitignore`. Agora banco, `.env` e planilhas de backup ficam fora do Git.

### Corrigidos na 1.0

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
- **Termos de uso**: o texto foi escrito para um projeto de extensão e ainda precisa da revisão do professor
  orientador ou do núcleo de prática jurídica da faculdade. O aceite na tela ajuda, mas o que protege a equipe
  de verdade é um acordo por escrito com a Casa Via Matris (termo de parceria) dizendo que a casa decide sobre os
  dados e que o sistema é cedido como está, em teste.

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
