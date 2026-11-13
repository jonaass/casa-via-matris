# Alterações da versão 1.3.0: o site puxa os dados do banco

Resumo do que mudou na branch `backend-banco`. Ela ainda **não está na `main`**, então o site no ar
continua igual até o Jonas revisar e juntar.

## Em uma frase

Agora existe um back-end em Python (pasta `backend/`) com um banco de dados. Quando o site é aberto
por esse servidor, depois do login ele **busca os dados do banco** e mostra na tela. No GitHub Pages
nada muda: o app continua usando só os dados do aparelho, como antes.

## Por que FastAPI (e não Flask)

- Ele **confere sozinho os dados que chegam**. A regra do projeto é repetir no servidor as regras do
  `store.js`, e isso já adianta boa parte do trabalho.
- Ele **cria sozinho uma página com todas as rotas** (`/docs`), onde dá para testar cada uma pelo
  navegador. Jonas e Miguel conseguem ver o que a API recebe e devolve sem ler Python.
- Os **testes ficam simples**.

O Flask também serviria, mas essas três coisas teriam que ser feitas à mão.

## O que foi criado

### Pasta `backend/` (nova)

| Arquivo | O que faz |
| --- | --- |
| `principal.py` | O servidor: entrega o site e a API no mesmo endereço, confere login e permissões. |
| `banco.py` e `migracoes/001_inicial.sql` | O banco SQLite, com as mesmas 3 coleções do app (`itens`, `doacoes`, `dinheiro`), mais contas e sessões. |
| `seguranca.py` | Perfis (iguais aos do `acesso.js`), senhas e sessões. |
| `importar.py` | Leva as planilhas de backup do app para dentro do banco. |
| `usuarios.py` | Comandos para criar contas e redefinir senhas no servidor. |
| `config.py` e `.env.example` | Configurações (onde fica o banco, cookie, fuso de Brasília). |
| `tests/test_api.py` | 27 testes automáticos. |
| `README.md` | Como instalar, rodar e usar. |

Rotas da API:

| Rota | Para quê | Quem pode |
| --- | --- | --- |
| `GET /api/saude` | O site pergunta se tem servidor por trás | Todos |
| `POST /api/entrar`, `POST /api/sair`, `GET /api/eu` | Login no servidor | Todos |
| `POST /api/trocar-senha` | Trocar a senha | Quem está logado |
| `GET /api/itens`, `GET /api/doacoes` | Estoque e doações de itens | Administrador, Almoxarifado, Voluntário |
| `GET /api/dinheiro` | Entradas e despesas | Administrador, Financeiro |

### `js/servidor.js` (novo)

É a ponte entre o site e o banco. Depois do login, ele entra no servidor, busca as coleções que o
perfil pode ver e guarda no aparelho. A tela continua lendo do aparelho, então quase nada no
`app.js` precisou mudar, e o app continua abrindo sem internet (com a última cópia buscada).

## O que mudou nos arquivos que já existiam

| Arquivo | Mudança |
| --- | --- |
| `js/login.js` | Depois do login no aparelho, entra também no servidor e busca os dados. Trocar senha (inclusive a provisória) troca nos dois lugares. |
| `js/acesso.js` | Quando os dados vêm do banco, vale o perfil do servidor, e registrar e desfazer ficam desligados. Sair também sai do servidor. |
| `js/app.js` | Corrigido um erro quando nenhuma opção de registro está liberada. O botão "Registrar movimentação" e a faixa de backup somem quando os dados vêm do banco. A mensagem de "Sem permissão" e o perfil no menu Conta seguem o servidor. |
| `sw.js` | Inclui o `js/servidor.js` e nunca guarda as respostas da API em cache. |
| `index.html` | Carrega o `js/servidor.js`. |
| `js/dados.js` | `VERSAO` passou de 1.2.0 para 1.3.0. |
| `README.md` | Nova seção do back-end e registro da versão 1.3.0. |

## Segurança

- Cada rota confere o perfil: sem login responde 401; perfil sem permissão, 403.
  Financeiro não recebe o estoque; Almoxarifado e Voluntário não recebem dinheiro.
- Senhas guardadas com o mesmo cálculo forte do app. 5 erros bloqueiam a conta por 15 minutos.
- O banco guarda só uma versão embaralhada (hash) do código da sessão, e o cookie não pode ser lido por scripts.
- O servidor recusa pedidos de login e de troca de senha vindos de outros sites.
- O servidor só entrega os arquivos do app: a pasta `backend/`, o `.git` e o banco nunca saem por ele.
- Ao sair, a cópia dos dados do banco é apagada do aparelho.
- O banco (`*.db`) e o `.env` ficam fora do Git.

## Como foi testado

- Os 79 + 34 testes em JavaScript que já existiam continuam passando.
- 27 testes novos do back-end passando.
- 178 verificações num navegador de verdade, em Chromium, Firefox e WebKit (o motor do Safari), no
  computador e no tamanho de celular, com os 4 perfis. Entre elas:
  - cada perfil recebe só o que pode ver;
  - sair apaga a cópia do aparelho e fecha a sessão no servidor;
  - funcionam a senha provisória, a troca de senha e o "esqueci a senha";
  - o app abre sem internet;
  - sem servidor, o site funciona como antes.

## O que ainda falta

1. **O banco por enquanto só é lido.** Quando os dados vêm do banco, não dá para registrar nem desfazer.
   A próxima etapa é a API aceitar gravações, com as mesmas regras do `store.js`.
2. **Cada pessoa precisa ter a mesma senha no aparelho e no servidor.** Isso acaba quando o login do
   aparelho for trocado pelo do servidor.
3. **Ainda não foi testado num iPhone ou Android de verdade.**
4. **O servidor ainda não está publicado na internet.** Hoje roda só no computador.

## Para testar no seu computador

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
python -m backend.importar tests/planilhas/via-matris-estoque-teste.csv tests/planilhas/via-matris-doacoes-teste.csv tests/planilhas/via-matris-dinheiro-teste.csv
python -m backend.usuarios criar "Seu Nome" seu@email.com administrador
python -m uvicorn backend.principal:app --reload
```

Abra http://localhost:8000 e crie o administrador do aparelho com o **mesmo e-mail e a mesma senha**.
