# Back-end do Casa Via Matris (Fase 2)

API em **FastAPI** com banco **SQLite**. O servidor entrega o site e a API no mesmo endereço,
e o site puxa os dados do banco depois do login (`js/servidor.js`).

## Por que FastAPI (e não Flask)

- **Confere os dados que chegam sozinho** (pelos tipos do Python). A regra de ouro do projeto é
  repetir no servidor as validações do `store.js`, e isso já corta metade do trabalho.
- **Documentação das rotas gerada sozinha** em `/docs`, onde dá para testar cada rota no navegador.
  Jonas e Miguel veem o que a API recebe e devolve sem ler Python: é o "contrato" do back-end,
  como o `MIGUEL.md` é o dos dados.
- **Testes fáceis** com o `TestClient` e o pytest.
- O Flask também serviria. Ele é mais simples no começo, mas essas três coisas teriam que ser
  montadas à mão ou com extensões.

## Como rodar

Da pasta do projeto (não de dentro de `backend/`):

```bash
python -m venv .venv
.venv\Scripts\activate          # no Linux/Mac: source .venv/bin/activate
pip install -r backend/requirements.txt

# 1. Criar uma conta (a senha é pedida sem aparecer na tela)
python -m backend.usuarios criar "Nome da Pessoa" email@exemplo.com administrador

# 2. (Opcional) Levar as planilhas de backup do app para o banco
python -m backend.importar via-matris-estoque-2026-11-13.csv via-matris-doacoes-2026-11-13.csv via-matris-dinheiro-2026-11-13.csv
#    Para treinar, use as planilhas fictícias: python -m backend.importar tests/planilhas/via-matris-*-teste.csv

# 3. Ligar o servidor
python -m uvicorn backend.principal:app --reload
```

Abra http://localhost:8000 e entre com o e-mail e a senha da conta criada no passo 1. Quem confere é o servidor;
depois do login, os dados vêm do banco.
Para ver as rotas em http://localhost:8000/docs, ligue a página com `VM_DOCS=1` no `backend/.env`
(ela fica desligada por padrão porque carrega scripts de uma CDN).

### Contas: só no servidor (1.5.0)

Com o servidor, **um login só**: quem decide quem entra é o servidor. A conta do aparelho é só uma cópia da conta
do servidor (nome, perfil e aceite dos termos), criada no primeiro login, sem senha guardada.

- **Pessoa nova:** `python -m backend.usuarios criar "Nome" email@exemplo.com almoxarifado`. A senha que você
  digitar é **provisória**: entregue pessoalmente. No primeiro acesso, o app pede para a pessoa criar a senha dela
  e aceitar os Termos de uso (`POST /api/definir-senha`); até lá, o servidor não abre sessão para ela.
- **Trocar senha** (menu Conta do app): troca só no servidor.
- **Esqueci a senha:** `python -m backend.usuarios senha email@exemplo.com`. A senha nova também é provisória.
  (O código de recuperação do app é só das contas do aparelho e não aparece no modo servidor.)
- **Termos de uso:** o servidor só deixa entrar quem aceitou a versão atual (`TERMOS_VERSAO` em `seguranca.py`,
  igual à do `js/acesso.js`; um teste confere). Contas de antes da 1.5.0 aceitam na próxima entrada
  (`POST /api/aceitar-termos`). Mudou o texto dos termos: mude a data nos dois arquivos.
- **Desativar** quem saiu da equipe: `python -m backend.usuarios desativar email@exemplo.com` (e `ativar` para voltar).
- **Perfil:** vale o do servidor; trocou lá, vale no aparelho na próxima abertura.
- A página Acessos do app, no modo servidor, não cadastra nem muda contas: ela aponta para estes comandos.
- Sem internet, um login novo não entra (é o servidor que confere a senha). Quem marcou "Manter conectado"
  continua abrindo, com a última cópia dos dados dele.

O banco fica em `backend/dados/casa-via-matris.db` (fora do Git). Para mudar, veja `.env.example`.

## Testes

```bash
python -m pytest backend/tests
```

O teste `test_perfis_iguais_ao_acesso_js` lê o `js/acesso.js` (precisa do Node.js) e falha se os perfis
de lá e daqui ficarem diferentes.

Para rodar os mesmos testes num Postgres (o GitHub Actions faz isso a cada envio), aponte
`VM_TESTE_POSTGRES` para um banco **vazio e só de teste**: cada teste apaga e recria as tabelas dele.

```bash
VM_TESTE_POSTGRES=postgresql://usuario:senha@localhost:5432/teste python -m pytest backend/tests
```

## Publicar na Vercel com Postgres (1.6.0)

Na Vercel não existe disco que dure: o arquivo do SQLite seria apagado a cada publicação. Por isso, lá o
banco é um **Postgres** (Neon). O código é o mesmo: com a variável `DATABASE_URL`, o `banco.py` usa o
Postgres; sem ela, o SQLite de sempre. As diferenças ficam todas no `banco.py`:

- o SQL é escrito com `?` (SQLite) e vira `%s` no Postgres;
- `BEGIN IMMEDIATE` (uma gravação por vez) vira a trava `pg_advisory_xact_lock`;
- nas migrações, `INTEGER` vira `BIGINT`, `REAL` vira `DOUBLE PRECISION`, e `doacoes` e `dinheiro` ganham a
  coluna `rowid` (a ordem de gravação que o SQLite já tem sozinho);
- a versão do banco fica na tabela `versao_do_banco` (no SQLite, no `user_version`).

Arquivos da Vercel na raiz: `pyproject.toml` (dependências e `entrypoint = "backend.principal:app"`),
`vercel.json` (região `gru1`, São Paulo), `.python-version` e `.vercelignore` (testes e ferramentas não sobem).

Variáveis no projeto da Vercel:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | criada pela integração do Neon (Storage → Neon, região São Paulo) |
| `VM_ORIGENS` | o endereço do site, ex.: `https://casa-via-matris.vercel.app` |
| `VM_COOKIE_SEGURO` | `1` |

As contas e as planilhas entram pelo seu computador, apontando para o banco da Vercel:

```bash
DATABASE_URL="<copie do painel da Vercel>" python -m backend.usuarios criar "Nome" email@exemplo.com administrador
DATABASE_URL="<copie do painel da Vercel>" python -m backend.importar via-matris-*.csv
```

O limite de erros de login por IP também fica no banco (migração 004): na Vercel, cada pedido pode cair numa
cópia diferente do servidor, com a memória vazia.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `principal.py` | As rotas da API, os cabeçalhos de segurança e os arquivos do site. |
| `banco.py` | Conexão com o SQLite e migrações. |
| `migracoes/001_inicial.sql` | As tabelas. Mudança no banco = arquivo novo, com o próximo número, nunca editar o antigo. |
| `migracoes/003_estorno_e_termos.sql` | Lançamento contrário (`estorno_de`), `guardou_validade`, senha provisória e aceite dos termos. |
| `movimentos.py` | Registrar e desfazer, com as regras do `store.js`, numa transação. |
| `seguranca.py` | Perfis (iguais ao `acesso.js`), senhas e sessões. |
| `importar.py` | Planilhas de backup do app → banco. |
| `usuarios.py` | Comandos para criar contas e redefinir senhas. |
| `config.py` | Configuração (caminho do banco, cookie, fuso de Brasília). |

## O que já está protegido

- Rotas por perfil, iguais ao `acesso.js`: sem sessão responde 401; perfil sem permissão, 403.
- Senha com PBKDF2-SHA256 de 600 mil iterações (o mesmo do app); 5 erros bloqueiam a conta por 15 min;
  e-mail inexistente e senha errada dão a mesma resposta. Também há limite de erros por IP.
- O banco guarda só o hash do token da sessão. Cookie `HttpOnly` e `SameSite=Strict`, e `Secure` quando o site
  é aberto por https. (Em `http://localhost` não pode ser `Secure`: o Safari não guardaria o login.)
- Senha provisória e aceite dos termos conferidos no servidor (migração 003: `provisoria`, `termos_versao`, `termos_em`).
  Faltando algum, `POST /api/entrar` responde 403 com `campo` `"senhaProvisoria"` ou `"termos"` e não dá cookie, e uma
  sessão que já estava aberta deixa de valer (como o `contaAtual()` do app). Isso só aparece depois da senha certa:
  quem é de fora não descobre se a conta é provisória.
- `POST /api/definir-senha` e `POST /api/aceitar-termos` não usam sessão: conferem e-mail e senha de novo, com o
  mesmo bloqueio por conta, o mesmo limite por IP e a mesma conferência de `Origin` do login.
- Trocar a senha confere a atual e fecha as outras sessões da conta. Sair fecha a sessão e apaga do aparelho a
  cópia dos dados do banco, para a próxima pessoa não ficar com os dados de quem saiu.
- Pedidos que gravam (`entrar`, `sair`, `trocar-senha`, `movimentos`) conferem o cabeçalho `Origin` (contra CSRF).
- Gravar movimentações repete as regras do `store.js` (`movimentos.py`), confere a permissão de cada tipo e faz
  conferência e gravação numa transação só (`BEGIN IMMEDIATE`). Desfazer grava o lançamento contrário; o índice
  único em `estorno_de` impede desfazer duas vezes, mesmo com dois pedidos juntos.
- SQL sempre com parâmetros `?`. SQLite com `foreign_keys`, `WAL` e `busy_timeout`.
- Dinheiro em centavos e quantidades em milésimos, sempre inteiros.
- CSP como cabeçalho, com `frame-ancestors 'none'`. Respostas da API sem cache.
- Só os arquivos do app são entregues: `backend/`, `.git` e o banco nunca saem pelo servidor.

## Gravar: registrar e desfazer (1.5.0)

`POST /api/movimentos` (com sessão e `Origin`). Corpo, com os mesmos nomes do app:

```json
{ "tipo": "doacao_item", "data": "2026-11-14", "itemId": "arroz", "quantidade": 2.5,
  "validade": "2027-01-10", "descricao": "", "pessoa": "Paróquia" }
```

- Item novo (só em doação): troque `itemId` por `"novoItem": {"nome": "...", "categoria": "Alimentos", "unidade": "kg", "minimo": 1}`.
- Dinheiro: `"valorCentavos": 15000` (inteiro; R$ 150,00) e `descricao` obrigatória.
- Resposta 200: `{ "movimento": {...}, "item": {...} }` (os mesmos campos de `GET /api/doacoes`, `/api/dinheiro` e
  `/api/itens`; `item` é `null` para dinheiro). Recusa: `{ "erro": "...", "campo": "quantidade" }` com 422
  (regra), 403 (perfil) ou 401 (sem sessão).

`POST /api/movimentos/{codigo}/estorno` grava o lançamento contrário (tipo oposto, data de hoje, `estornoDe` com o
código do original) e devolve no mesmo formato. Pede `desfazer` e poder ver a área. Recusas: 404 (não existe),
409 (já foi desfeito), 422 (é um lançamento contrário; ou parte dos itens já saiu; ou o dinheiro já foi gasto).
O item cadastrado por uma doação desfeita continua na tabela, com quantidade 0.

`guardou_validade` (migração 003): 1 quando a validade de antes foi anotada ao gravar pela API. Nos movimentos que
vieram das planilhas ela é 0, e desfazê-los não mexe na validade do item (não se sabe qual era).

## Rotas de conta (1.5.0)

| Rota | Sessão | Corpo | O que faz |
| --- | --- | --- | --- |
| `POST /api/entrar` | não | `email`, `senha`, `manter` | Abre a sessão. 401 senha errada; 403 com `campo` `senhaProvisoria` ou `termos`; 429 tentativas demais. |
| `POST /api/definir-senha` | não | `email`, `senhaAtual`, `novaSenha`, `aceitouTermos` | Só conta provisória: senha nova e aceite dos termos. 409 se a conta já tem senha própria. |
| `POST /api/aceitar-termos` | não | `email`, `senha`, `aceito` | Aceita a versão atual dos termos. 409 se a senha ainda é provisória. |
| `POST /api/trocar-senha` | sim | `senhaAtual`, `novaSenha` | Troca a senha de quem está logado. |
| `GET /api/eu` | sim | | Nome, e-mail, perfil, permissões, `termosVersao` e `termosEm`. |

As duas rotas sem sessão não abrem sessão: depois delas, o site chama `/api/entrar` com a senha (nova).

## Próxima etapa

1. (Feito na 1.5.0: gravar pela API.)
2. (Feito na 1.5.0: um login só, o do servidor.)
3. Tabela `lotes` para a validade por lote.
4. (1.6.0: publicado na Vercel com Postgres; veja acima.) Em outro servidor atrás de um proxy (Nginx, Render, Railway...), rode o
   uvicorn com `--proxy-headers`: sem isso o servidor não sabe que o endereço é https (o cookie sai sem `Secure`)
   e enxerga todo mundo com o IP do proxy (o limite de erros de login por IP passaria a valer para todos juntos).
5. Em produção, preencher `VM_ORIGENS` com o endereço do site e usar `VM_COOKIE_SEGURO=1`.
6. (Feito na 1.5.0: senha provisória e aceite dos termos conferidos no servidor.)
7. Decidir com o grupo se o Voluntário deve receber o histórico de doações (hoje `/api/doacoes` pede só `ver_estoque`,
   e no app o Voluntário não tem a página Histórico).

## Como foi testado

- `python -m pytest backend/tests`: testes da API, das senhas, da importação e do comando de contas
  (na 1.4.0 entraram testes de senhas em paralelo, migração simultânea, nome sem acento, origens e caminhos internos;
  na 1.5.0, as regras de gravação com as mesmas mensagens do `store.js`, as permissões de cada perfil, o desfazer,
  a migração 003 num banco com dados e a concorrência: várias conexões tirando juntas as últimas unidades).
- No navegador (Playwright), 178 verificações em Chromium, Firefox e WebKit, no computador e no tamanho de
  celular: os 4 perfis recebem só o que podem ver, menus e mensagens seguem o perfil do servidor, sair apaga a
  cópia e fecha a sessão, senha provisória, troca de senha (inclusive quando o servidor recusa), esqueci a senha,
  abrir sem internet com a última cópia e o modo sem servidor (como no GitHub Pages) sem mudança nenhuma.
- Não testado: iPhone e Android de verdade (o WebKit do teste é o motor do Safari, mas não é o celular).
