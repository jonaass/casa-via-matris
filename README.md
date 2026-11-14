# Casa Via Matris

Projeto de extensão (ODS 10): sistema de controle de **estoque, doações e finanças**
da Casa Via Matris. Funciona no navegador, instala no celular como um app e abre sem internet.

## Versão 1.4

A 1.4.0 junta o **back-end em Python do Anthony** (pasta `backend/`, FastAPI + SQLite): aberto pelo
servidor, o app puxa os dados do banco depois do login, só o que cada perfil pode ver. No GitHub Pages
nada muda. Nesta etapa o banco só é lido (registrar e desfazer ficam desligados no modo servidor).
A revisão dos agentes achou e corrigiu falhas de segurança no servidor e na junção com a 1.3; os termos
mudaram (todos aceitam de novo) para explicar o servidor da casa e o cookie de sessão.

A 1.3.0 veio de uma auditoria completa de design, contraste e bugs, feita pelos agentes do projeto
(`.claude/agents/`). Entraram o **tema claro automático** (segue o celular), **somar ou dar baixa direto
no Estoque**, o cartão **"Cópia dos dados"** na Visão geral, a recuperação de acesso em dois caminhos e
dezenas de correções de contraste, alinhamento e foco do teclado.

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
- **Somar ou dar baixa no item**: no Estoque, "− Saiu" e "+ Chegou" abrem um campo de quantidade no
  próprio item. Passa pelas mesmas regras do Registrar (não deixa sair mais do que existe). Para informar
  doador, validade ou motivo, o link leva ao Registrar com o item já escolhido.
- **Tema claro e escuro**: o app segue a configuração do celular. Todas as cores dos dois temas passam no
  contraste WCAG AA. A tela de entrada continua noturna nos dois.
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
  No modo servidor, o cadastro fica no servidor (`python -m backend.usuarios`) e a página só explica isso.
- **Backup**: baixa 3 planilhas (estoque, doações, dinheiro) e restaura delas, mesmo depois de editadas no Excel. Avisa quando o último backup tem mais de 7 dias.
- **Dados de exemplo**: aparecem na primeira abertura. "Começar do zero" apaga tudo para o uso real.
- **App no celular**: instala na tela inicial e abre sem internet.
- **Dados do banco (1.4.0)**: aberto pelo servidor Python, o app entra também no servidor e traz do banco só o que
  o perfil pode ver (Financeiro não recebe estoque; Almoxarifado e Voluntário não recebem dinheiro).
- **Gravar no banco (1.5.0)**: nesse modo, registrar e desfazer vão para o servidor, que confere as mesmas regras do
  `store.js` (saída não passa do estoque, despesa não passa do saldo) numa transação: duas pessoas não tiram juntas o
  último item. Desfazer não apaga: grava um **lançamento contrário**, e o Histórico mostra os dois, sem "Desfazer" neles.
  Nos totais do mês, o movimento desfeito e o contrário se anulam. Sem servidor (GitHub Pages), nada mudou.
- **Um login só (1.5.0)**: aberto pelo servidor, é o **servidor** que confere e-mail e senha. A conta do aparelho
  vira uma cópia da conta do servidor (nome, perfil, aceite dos termos), sem senha guardada, e o perfil trocado no
  servidor vale na próxima abertura. Trocar a senha é só no servidor. As contas são criadas, mudadas e desativadas
  no servidor (`python -m backend.usuarios`): a página Acessos explica isso e não mostra o cadastro do aparelho.
  Sem internet, um login novo não entra (a mensagem explica); quem marcou "Manter conectado" continua abrindo com a
  última cópia. Sair apaga do aparelho a cópia dos dados do banco. Sem servidor (GitHub Pages), as contas do
  aparelho funcionam como sempre.
- Os dados ficam salvos no aparelho (localStorage) e sobrevivem a recarregar a página.

## Estrutura

```
index.html          a página (estrutura e textos)
termos.html         Termos de uso e Aviso de privacidade
fontes/             as fontes do app (Atkinson Hyperlegible e Hanken Grotesk) e as licenças delas
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
`resumo`) e redesenha com o que voltou. No modo servidor (1.5.0),
registrar e desfazer vão para a API pelo `servidor.js` (`gravarNoServidor`, `estornarNoServidor`), que
responde no mesmo formato do `store.js`. O `app.js` só escolhe para onde mandar, espera a resposta com
`await` e deixa o botão desativado enquanto isso (senão dois cliques viram dois lançamentos).

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
| `registrar(entrada)`   | `POST /api/movimentos`               | pronta (1.5.0) |
| `estornar(id)`         | `POST /api/movimentos/{id}/estorno`  | pronta (1.5.0): grava o lançamento contrário |
| `resumo()`             | calculado no aparelho com os dados puxados | |

- As validações do `store.js` precisam ser **repetidas no servidor**: o navegador
  pode ser manipulado, então a regra que vale de verdade é a do back-end.
- Falta: tabela `lotes` (validade por lote).

## Riscos

Encontrados na revisão do protótipo. Os marcados como corrigidos têm teste em `tests/`.

### Corrigidos na 1.5.0

**Gravar pela API**
- No modo servidor, registrar e desfazer estavam desligados ("Ainda não disponível"). Agora gravam no banco
  (`POST /api/movimentos` e `POST /api/movimentos/{id}/estorno`), com as regras e as mensagens do `store.js`,
  e o erro do servidor aparece no mesmo campo do erro do aparelho.
- A conferência (tem estoque? tem saldo?) e a gravação acontecem numa transação só: duas pessoas tirando ao
  mesmo tempo o último item, só uma consegue. Testado com conexões de verdade em paralelo.
- Desfazer vira lançamento contrário (migração 003, `estorno_de`); o banco recusa desfazer duas vezes.
- `resumo()` e `fluxoMensal()` não contam o movimento desfeito nem o contrário dele (sem isso, desfazer uma
  despesa aparecia como entrada no mês).
- Num banco novo, abrir várias conexões ao mesmo tempo às vezes dava "database is locked" (falhava 1 vez em 40
  no teste de migração simultânea). Agora a troca para o modo WAL tenta de novo.

**Um login só**
- No modo servidor, cada pessoa precisava da mesma senha no aparelho e no servidor, e trocar a senha mexia nos dois
  (e desfazia no aparelho quando o servidor recusava). Agora a senha existe só no servidor: o aparelho guarda uma
  cópia da conta, sem senha, e o `acesso.js` recusa entrar, trocar senha, cadastrar e mudar contas pelo aparelho.
- Com duas abas abertas com contas diferentes, a aba que percebia a troca fechava a sessão do servidor e derrubava a
  outra pessoa. Agora ela só sai do aparelho, e cada aba fica com os dados de quem está nela.

### Corrigidos na 1.4.0

Revisão da junção do back-end (agentes `espelho-backend`, `revisor-acessos` e `testador-navegador`).

**No servidor (`backend/`)**
- Várias senhas erradas mandadas ao mesmo tempo não bloqueavam a conta. Agora o erro é somado no próprio banco.
- Num banco novo, vários pedidos juntos davam erro 500 (a migração rodava a cada pedido). Agora roda uma vez, ao ligar.
- "Feijão" e "feijao", ou "Óleo" e "óleo", entravam como itens diferentes. Agora o nome é comparado sem acento, como no app (migração 002).
- Conta bloqueada ou desativada respondia diferente de e-mail inexistente, e a desativada confirmava a senha certa. Agora tudo responde igual.
- O limite de erros por IP guardava todo IP para sempre (memória crescendo) e deixava passar pedidos em paralelo.
- A página `/docs` carregava scripts de uma CDN. Agora fica desligada (liga com `VM_DOCS=1` para desenvolver).
- A conferência contra pedidos de outros sites aceitava http no lugar de https. Agora há a lista `VM_ORIGENS`.
- A importação aceitava data em formato de semana, apontava a linha errada quando havia linhas em branco, contava linha
  recusada como "já existia" e não achava o item pelo nome. Agora avisa quando o saldo fica negativo.
- O histórico mandava `validadeAnterior: null`, que apagaria a validade ao desfazer.
- "Manter conectado" durava só 8 horas no servidor. Agora dura 30 dias, como no aparelho.
- Novo comando `python -m backend.usuarios desativar email` (e `ativar`).

**No app, no modo servidor**
- Abrir uma segunda aba fechava a sessão do servidor e derrubava a primeira.
- A cópia dos dados do banco podia abrir para outra pessoa quando o servidor estava fora do ar, e outra aba com outra
  conta trocava os dados de quem estava logado. Agora a cópia tem dono e só abre para ele.
- Os recados da tela de entrada mostravam itens do banco antes do login.
- Restaurar planilhas, "Começar do zero" e "Trocar pelos exemplos" gravavam só no aparelho e sumiam no próximo login. Agora ficam desligados.
- Pessoa nova com senha provisória ficava presa (o aparelho trocava a senha e o servidor recusava). Agora o servidor é conferido antes.
- "Recuperar com o código" agora avisa antes que a senha do servidor também precisa ser trocada.
- Trocar senha com o servidor fora do ar deixava as duas senhas diferentes. Sair sem internet deixava a sessão do servidor aberta.
- Os termos diziam que não havia servidor nem cookies. Foram atualizados (`TERMOS_VERSAO` 2026-11-13).
- O saldo negativo quebrava a linha no celular; com a senha atual errada, "Trocar senha" falava em "e-mail".
- Com o registrar desligado, a tela tentava marcar uma opção que não existia e dava erro no console.
- Testes: `tests/servidor.test.js` (11 testes do modo servidor) e 50 testes do back-end, que agora rodam também no GitHub Actions.

### Corrigidos na 1.3.0

Vieram da auditoria de 13/11/2026 (revisor de design, testador e revisor de acessos).

- O texto de exemplo dos campos tinha contraste 3,7:1 (mínimo 4,5:1). A busca do Estoque não tinha rótulo visível.
- A Visão geral de Almoxarifado e Voluntário ficava desalinhada (as divisórias contavam o saldo escondido).
- No celular, a tabela de perfis escondia os quatro perfis. Agora vira um cartão por perfil.
- Cores com sentido trocado: escolha do tipo em verde até na despesa, pendências em vermelho, reposição em
  vermelho sem nada ter acabado, saldo negativo em verde.
- A busca do Estoque não achava "feijao" sem acento, e dava para cadastrar "Feijao carioca" com "Feijão carioca" já existindo.
- Clique duplo em Registrar mostrava um erro falso. O aviso não fechava depois de sair dele com o teclado.
- O foco do teclado ia para o começo da página depois de desfazer, desativar conta ou trocar perfil.
- O "Confirmar" do Desfazer ficava armado para sempre, e o "Desativar" conta agia no primeiro toque.
- O administrador bloqueado não conseguia usar o código de recuperação.
- Sair numa aba não encerrava a sessão nas outras abas.
- Restaurar e baixar planilhas só era barrado pela tela; agora a regra confere se é administrador.
- Registro incompleto no aparelho deixava a tela de entrada em branco.
- O campo de validade saía do cartão em celulares estreitos (360 px ou menos).
- Item vencido aparecia como "vence em até 15 dias", sem dizer que já venceu.
- O app podia ser aberto dentro de outro site (risco de cliques induzidos).
- A senha provisória de outra pessoa ficava na tela ao trocar de página.

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
