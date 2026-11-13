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

Abra http://localhost:8000. No primeiro acesso o app pede para criar o administrador **do aparelho**:
use **o mesmo e-mail e a mesma senha** da conta criada no passo 1. Depois do login, os dados vêm do banco.
As rotas ficam em http://localhost:8000/docs.

### Contas: aparelho e servidor com a mesma senha

Enquanto o login do aparelho não for trocado pelo do servidor, cada pessoa tem as duas contas, com a mesma senha.

- **Pessoa nova:** o administrador cadastra a pessoa na página Acessos, e o app mostra uma senha provisória.
  Crie a conta no servidor com essa mesma senha provisória:
  `python -m backend.usuarios criar "Nome" email@exemplo.com almoxarifado`.
  No primeiro acesso, a pessoa cria a senha dela e o app troca nos dois lugares.
- **Trocar senha** (menu Conta): troca nos dois. Se o servidor recusar, o aparelho volta à senha antiga.
- **Esqueci a senha / código de recuperação:** muda só no aparelho. O app avisa que a senha do servidor ficou
  diferente; quem cuida do servidor acerta com `python -m backend.usuarios senha email@exemplo.com`.
- **Perfil:** vale o do servidor. A pessoa só vê e faz o que os dois perfis deixam.

O banco fica em `backend/dados/casa-via-matris.db` (fora do Git). Para mudar, veja `.env.example`.

## Testes

```bash
python -m pytest backend/tests
```

O teste `test_perfis_iguais_ao_acesso_js` lê o `js/acesso.js` (precisa do Node.js) e falha se os perfis
de lá e daqui ficarem diferentes.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `principal.py` | As rotas da API, os cabeçalhos de segurança e os arquivos do site. |
| `banco.py` | Conexão com o SQLite e migrações. |
| `migracoes/001_inicial.sql` | As tabelas. Mudança no banco = arquivo novo `002_...sql`, nunca editar o antigo. |
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
- Trocar a senha confere a atual e fecha as outras sessões da conta. Sair fecha a sessão e apaga do aparelho a
  cópia dos dados do banco, para a próxima pessoa não ficar com os dados de quem saiu.
- Pedidos que gravam (`entrar`, `sair`, `trocar-senha`) conferem o cabeçalho `Origin` (contra CSRF).
- SQL sempre com parâmetros `?`. SQLite com `foreign_keys`, `WAL` e `busy_timeout`.
- Dinheiro em centavos e quantidades em milésimos, sempre inteiros.
- CSP como cabeçalho, com `frame-ancestors 'none'`. Respostas da API sem cache.
- Só os arquivos do app são entregues: `backend/`, `.git` e o banco nunca saem pelo servidor.

## Próxima etapa

1. `POST /api/movimentos` (registrar) e `POST /api/movimentos/{id}/estorno`, repetindo as regras do `store.js`
   (saída não passa do estoque, despesa não passa do saldo, estorno vira lançamento contrário).
   Aí o `js/servidor.js` religa o registrar no modo servidor.
2. Trocar o login do aparelho pelo do servidor (hoje a pessoa precisa da mesma senha nos dois).
3. Tabela `lotes` para a validade por lote.
4. Publicar num servidor com https e domínio próprio. Atrás de um proxy (Nginx, Render, Railway...), rode o
   uvicorn com `--proxy-headers`: sem isso o servidor não sabe que o endereço é https (o cookie sai sem `Secure`)
   e enxerga todo mundo com o IP do proxy (o limite de erros de login por IP passaria a valer para todos juntos).
5. Em produção, avaliar desligar a página `/docs` (ela carrega arquivos de uma CDN).

## Como foi testado

- `python -m pytest backend/tests`: 27 testes da API, das senhas, da importação e do comando de contas.
- No navegador (Playwright), 178 verificações em Chromium, Firefox e WebKit, no computador e no tamanho de
  celular: os 4 perfis recebem só o que podem ver, menus e mensagens seguem o perfil do servidor, sair apaga a
  cópia e fecha a sessão, senha provisória, troca de senha (inclusive quando o servidor recusa), esqueci a senha,
  abrir sem internet com a última cópia e o modo sem servidor (como no GitHub Pages) sem mudança nenhuma.
- Não testado: iPhone e Android de verdade (o WebKit do teste é o motor do Safari, mas não é o celular).
