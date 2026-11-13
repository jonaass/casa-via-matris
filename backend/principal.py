"""API do Casa Via Matris em FastAPI.

Rodar (da pasta do projeto):
    python -m uvicorn backend.principal:app --reload
e abrir http://localhost:8000. A documentação das rotas, que dá para testar no navegador,
fica em http://localhost:8000/docs.

O servidor entrega os arquivos do site E a API no mesmo endereço. Isso é obrigatório: a CSP
do app (connect-src 'self') só deixa o site conversar com o próprio endereço.

Nesta primeira etapa a API só LÊ o banco. Gravar (registrar, estornar) é o próximo passo,
repetindo as regras do js/store.js.
"""
import sqlite3
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import banco, config, seguranca

COOKIE = "vm_sessao"

app = FastAPI(
    title="Casa Via Matris",
    description="API de estoque, doações e finanças. Os nomes dos campos são os mesmos do js/dados.js.",
    version="0.1.0",
)

# ---------- erros no formato { "erro": "...", "campo": "..." } ----------


class ErroDaApi(HTTPException):
    def __init__(self, status: int, erro: str, campo: str | None = None):
        super().__init__(status_code=status, detail=erro)
        self.campo = campo


# StarletteHTTPException também pega o 404 de endereço que não existe e o 405 de método errado.
@app.exception_handler(StarletteHTTPException)
async def _erro_http(_: Request, exc: StarletteHTTPException):
    textos = {404: "Não encontrado.", 405: "Método não permitido."}
    corpo = {"erro": exc.detail if isinstance(exc, ErroDaApi) else textos.get(exc.status_code, "Pedido inválido.")}
    if getattr(exc, "campo", None):
        corpo["campo"] = exc.campo
    return JSONResponse(corpo, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def _erro_de_validacao(_: Request, exc: RequestValidationError):
    primeiro = exc.errors()[0] if exc.errors() else {}
    local = primeiro.get("loc", ())
    campo = str(local[-1]) if local and local[-1] != "body" else None
    corpo = {"erro": "Confira os dados enviados."}
    if campo:
        corpo["campo"] = campo
    return JSONResponse(corpo, status_code=422)


# ---------- cabeçalhos de segurança ----------

# A mesma CSP da tag <meta> do index.html, mais o que só funciona como cabeçalho:
# frame-ancestors 'none' impede outro site de abrir o app escondido dentro dele (clickjacking).
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")


@app.middleware("http")
async def _cabecalhos(request: Request, chamar_proximo):
    resposta = await chamar_proximo(request)
    resposta.headers["X-Content-Type-Options"] = "nosniff"
    resposta.headers["Referrer-Policy"] = "no-referrer"
    # A página /docs carrega scripts de uma CDN; o resto do site segue a CSP do app.
    if not request.url.path.startswith(("/docs", "/openapi.json")):
        resposta.headers["Content-Security-Policy"] = CSP
    if request.url.path.startswith("/api/"):
        resposta.headers["Cache-Control"] = "no-store"  # dado da casa não fica guardado em cache
    return resposta


# ---------- banco, sessão e permissões ----------


def obter_banco():
    con = banco.abrir_banco()
    try:
        yield con
    finally:
        con.close()


def usuario_logado(request: Request, con: sqlite3.Connection = Depends(obter_banco)) -> sqlite3.Row:
    usuario = seguranca.usuario_da_sessao(con, request.cookies.get(COOKIE))
    if usuario is None:
        raise ErroDaApi(401, "Sua sessão acabou. Entre de novo.")
    return usuario


def exigir(acao: str):
    """Rota só para quem tem esta permissão. Sem sessão: 401. Perfil sem a permissão: 403."""
    def conferir(usuario: sqlite3.Row = Depends(usuario_logado)) -> sqlite3.Row:
        if not seguranca.pode(usuario["perfil"], acao):
            raise ErroDaApi(403, "Seu perfil não pode fazer isso.")
        return usuario
    return conferir


def conferir_origem(request: Request) -> None:
    """Contra CSRF: rota que grava só aceita pedido feito pelo próprio site."""
    origem = request.headers.get("origin")
    if not origem or urlparse(origem).netloc != request.headers.get("host"):
        raise ErroDaApi(403, "Pedido vindo de outro site foi recusado.")


# Limite de tentativas de login por IP (além do bloqueio por conta): 20 erros em 15 minutos.
_erros_por_ip: dict[str, deque] = defaultdict(deque)
LIMITE_POR_IP = 20


def _muitos_erros(ip: str) -> bool:
    fila = _erros_por_ip[ip]
    while fila and fila[0] < time.time() - seguranca.BLOQUEIO_S:
        fila.popleft()
    return len(fila) >= LIMITE_POR_IP


# ---------- rotas da API ----------


@app.get("/api/saude", tags=["sistema"])
def saude():
    """Responde se o servidor está no ar. O site usa isto para saber se tem banco por trás."""
    return {"ok": True, "servico": "casa-via-matris"}


class Login(BaseModel):
    email: str
    senha: str


def _conta_publica(u: sqlite3.Row) -> dict:
    return {"nome": u["nome"], "email": u["email"], "perfil": u["perfil"], "pode": seguranca.PERFIS[u["perfil"]]}


@app.post("/api/entrar", tags=["conta"], dependencies=[Depends(conferir_origem)])
def entrar(dados: Login, request: Request, response: Response, con: sqlite3.Connection = Depends(obter_banco)):
    ip = request.client.host if request.client else "?"
    if _muitos_erros(ip):
        raise ErroDaApi(429, "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.")
    usuario, erro = seguranca.validar_login(con, dados.email, dados.senha)
    if erro:
        _erros_por_ip[ip].append(time.time())
        raise ErroDaApi(401, erro)
    token = seguranca.abrir_sessao(con, usuario["codigo"])
    response.set_cookie(COOKIE, token, max_age=seguranca.SESSAO_S, httponly=True,
                        secure=config.cookie_seguro(request.url.scheme == "https"), samesite="strict", path="/")
    return _conta_publica(usuario)


@app.post("/api/sair", tags=["conta"], dependencies=[Depends(conferir_origem)])
def sair(request: Request, response: Response, con: sqlite3.Connection = Depends(obter_banco)):
    seguranca.fechar_sessao(con, request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


class TrocaDeSenha(BaseModel):
    senhaAtual: str
    novaSenha: str


@app.post("/api/trocar-senha", tags=["conta"], dependencies=[Depends(conferir_origem)])
def trocar_senha(dados: TrocaDeSenha, request: Request, usuario: sqlite3.Row = Depends(usuario_logado),
                 con: sqlite3.Connection = Depends(obter_banco)):
    """Troca a senha de quem está logado. O site chama junto com a troca de senha do aparelho."""
    erro = seguranca.trocar_senha(con, usuario["email"], dados.senhaAtual, dados.novaSenha,
                                  manter_sessao=request.cookies.get(COOKIE))
    if erro:
        raise ErroDaApi(400, erro, "senhaAtual" if "incorret" in erro or "bloqueada" in erro else "novaSenha")
    return {"ok": True}


@app.get("/api/eu", tags=["conta"])
def eu(usuario: sqlite3.Row = Depends(usuario_logado)):
    """Quem está logado e o que o perfil pode fazer."""
    return _conta_publica(usuario)


# As respostas têm os mesmos campos que o js/dados.js guarda, para o site usar sem converter.

def _quantidade(milesimos: int) -> float | int:
    return milesimos // 1000 if milesimos % 1000 == 0 else milesimos / 1000


@app.get("/api/itens", tags=["estoque"])
def listar_itens(_: sqlite3.Row = Depends(exigir("ver_estoque")), con: sqlite3.Connection = Depends(obter_banco)):
    linhas = con.execute("SELECT * FROM itens ORDER BY nome COLLATE NOCASE").fetchall()
    return [{
        "codigo": i["codigo"], "nome": i["nome"], "categoria": i["categoria"], "unidade": i["unidade"],
        "quantidade": _quantidade(i["quantidade_milesimos"]), "minimo": _quantidade(i["minimo_milesimos"]),
        "validade": i["validade"],
    } for i in linhas]


@app.get("/api/doacoes", tags=["estoque"])
def listar_doacoes(_: sqlite3.Row = Depends(exigir("ver_estoque")), con: sqlite3.Connection = Depends(obter_banco)):
    linhas = con.execute("SELECT * FROM doacoes ORDER BY data, criado_em").fetchall()
    lista = []
    for m in linhas:
        mov = {
            "codigo": m["codigo"], "tipo": m["tipo"], "data": m["data"], "itemId": m["item_codigo"],
            "quantidade": _quantidade(m["quantidade_milesimos"]), "descricao": m["descricao"],
            "pessoa": m["pessoa"], "criadoEm": m["criado_em"], "validadeAnterior": m["validade_anterior"],
        }
        if m["criou_item"]:
            mov["criouItem"] = True
        lista.append(mov)
    return lista


@app.get("/api/dinheiro", tags=["financeiro"])
def listar_dinheiro(_: sqlite3.Row = Depends(exigir("ver_financeiro")), con: sqlite3.Connection = Depends(obter_banco)):
    linhas = con.execute("SELECT * FROM dinheiro ORDER BY data, criado_em").fetchall()
    return [{
        "codigo": m["codigo"], "tipo": m["tipo"], "data": m["data"], "valorCentavos": m["valor_centavos"],
        "descricao": m["descricao"], "pessoa": m["pessoa"], "criadoEm": m["criado_em"],
    } for m in linhas]


@app.api_route("/api/{resto:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def rota_inexistente(resto: str):
    raise ErroDaApi(404, "Essa rota da API não existe.")


# ---------- arquivos do site ----------
# Só o que o app usa. Nada de backend/, .git, tests/ nem o banco: lista fechada, não a pasta inteira.

RAIZ = config.RAIZ_DO_SITE
for pasta in ("css", "js", "fontes", "icones"):
    app.mount(f"/{pasta}", StaticFiles(directory=RAIZ / pasta), name=pasta)


def _arquivo(nome: str, tipo: str | None = None):
    def entregar():
        # O sw.js e as páginas sempre conferem a versão nova; o service worker cuida do modo sem internet.
        return FileResponse(RAIZ / nome, media_type=tipo, headers={"Cache-Control": "no-cache"})
    return entregar


# HEAD também: é o pedido que os serviços de monitoramento usam para ver se o site está no ar.
for endereco, nome, tipo in (("/", "index.html", None), ("/index.html", "index.html", None),
                             ("/termos.html", "termos.html", None), ("/sw.js", "sw.js", "text/javascript"),
                             ("/manifest.json", "manifest.json", "application/manifest+json")):
    app.api_route(endereco, methods=["GET", "HEAD"], include_in_schema=False)(_arquivo(nome, tipo))
