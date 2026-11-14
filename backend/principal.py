"""API do Casa Via Matris em FastAPI.

Rodar (da pasta do projeto):
    python -m uvicorn backend.principal:app --reload
e abrir http://localhost:8000. A documentação das rotas, que dá para testar no navegador,
fica em http://localhost:8000/docs.

O servidor entrega os arquivos do site E a API no mesmo endereço. Isso é obrigatório: a CSP
do app (connect-src 'self') só deixa o site conversar com o próprio endereço.

A API lê o banco e grava movimentações (registrar e desfazer). As regras de gravação ficam em
movimentos.py e repetem as do js/store.js.
"""
import os
import sqlite3
import time
from collections import deque
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import banco, config, movimentos, seguranca

COOKIE = "vm_sessao"

@asynccontextmanager
async def _ao_ligar(_: FastAPI):
    # As migrações rodam uma vez, quando o servidor liga. Rodando a cada pedido, vários pedidos juntos
    # num banco novo tentavam criar as mesmas tabelas e davam erro 500.
    con = banco.abrir_banco()
    con.close()
    yield


# A página /docs (e o /openapi.json) carrega scripts de uma CDN e mostra o mapa da API: fica desligada,
# a não ser para quem está desenvolvendo (VM_DOCS=1 no backend/.env).
_DOCS = os.environ.get("VM_DOCS") == "1"
app = FastAPI(
    title="Casa Via Matris",
    description="API de estoque, doações e finanças. Os nomes dos campos são os mesmos do js/dados.js.",
    version="0.3.0",
    lifespan=_ao_ligar,
    docs_url="/docs" if _DOCS else None,
    redoc_url=None,
    openapi_url="/openapi.json" if _DOCS else None,
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


@app.exception_handler(Exception)
async def _erro_inesperado(_: Request, exc: Exception):
    # Erro que ninguém previu: responde no mesmo formato, sem mostrar detalhes internos a quem pediu.
    print(f"Erro inesperado: {type(exc).__name__}: {exc}")
    return JSONResponse({"erro": "Algo deu errado no servidor. Tente de novo em instantes."}, status_code=500)


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
    con = banco.conectar()
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


def _origens_aceitas(request: Request) -> set[str]:
    """Endereços de onde o site pode mandar pedidos que gravam. Publicado, liste-os em VM_ORIGENS
    (ex.: https://casaviamatris.org.br). Sem a lista, vale o próprio endereço, com http/https certo."""
    lista = os.environ.get("VM_ORIGENS", "")
    if lista.strip():
        return {o.strip().rstrip("/") for o in lista.split(",") if o.strip()}
    return {f"{request.url.scheme}://{request.headers.get('host', '')}"}


def conferir_origem(request: Request) -> None:
    """Contra CSRF: rota que grava só aceita pedido feito pelo próprio site."""
    if request.headers.get("origin") not in _origens_aceitas(request):
        raise ErroDaApi(403, "Pedido vindo de outro site foi recusado.")


# Limite de tentativas de login por IP (além do bloqueio por conta): 20 erros em 15 minutos.
# Só IPs com erro recente ficam guardados, para a memória não crescer sem fim.
# Atrás de um proxy, rode o uvicorn com --proxy-headers --forwarded-allow-ips=<IP do proxy>:
# sem isso, todos aparecem com o IP do proxy (ou qualquer um troca o IP pelo X-Forwarded-For).
_erros_por_ip: dict[str, deque] = {}
LIMITE_POR_IP = 20


def _limpar_fila(ip: str) -> deque | None:
    fila = _erros_por_ip.get(ip)
    if fila is None:
        return None
    while fila and fila[0] < time.time() - seguranca.BLOQUEIO_S:
        fila.popleft()
    if not fila:
        del _erros_por_ip[ip]
        return None
    return fila


def _reservar_tentativa(ip: str) -> bool:
    """Anota a tentativa ANTES de conferir a senha (pedidos em paralelo não passam do limite).
    Devolve False se o IP já chegou ao limite."""
    if len(_erros_por_ip) > 10_000:  # faxina de vez em quando
        for antigo in list(_erros_por_ip):
            _limpar_fila(antigo)
    fila = _limpar_fila(ip)
    if fila is not None and len(fila) >= LIMITE_POR_IP:
        return False
    _erros_por_ip.setdefault(ip, deque()).append(time.time())
    return True


def _devolver_tentativa(ip: str) -> None:
    """Login certo não conta como erro."""
    fila = _erros_por_ip.get(ip)
    if fila:
        fila.pop()
        if not fila:
            del _erros_por_ip[ip]


# ---------- rotas da API ----------


@app.get("/api/saude", tags=["sistema"])
def saude():
    """Responde se o servidor está no ar. O site usa isto para saber se tem banco por trás."""
    return {"ok": True, "servico": "casa-via-matris"}


class Login(BaseModel):
    # Tamanho máximo: cada senha custa 600 mil cálculos, e texto gigante não serve para nada.
    email: str = Field(max_length=120)
    senha: str = Field(max_length=seguranca.SENHA_MAXIMA)
    manter: bool = False  # "Manter conectado": a sessão dura 30 dias, como no aparelho


def _conta_publica(u: sqlite3.Row) -> dict:
    return {"nome": u["nome"], "email": u["email"], "perfil": u["perfil"], "pode": seguranca.PERFIS[u["perfil"]]}


@app.post("/api/entrar", tags=["conta"], dependencies=[Depends(conferir_origem)])
def entrar(dados: Login, request: Request, response: Response, con: sqlite3.Connection = Depends(obter_banco)):
    ip = request.client.host if request.client else "?"
    if not _reservar_tentativa(ip):
        raise ErroDaApi(429, "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.")
    usuario, erro = seguranca.validar_login(con, dados.email, dados.senha)
    if erro:
        raise ErroDaApi(401, erro)
    _devolver_tentativa(ip)
    duracao = seguranca.SESSAO_LONGA_S if dados.manter else seguranca.SESSAO_S
    token = seguranca.abrir_sessao(con, usuario["codigo"], duracao)
    response.set_cookie(COOKIE, token, max_age=duracao, httponly=True,
                        secure=config.cookie_seguro(request.url.scheme == "https"), samesite="strict", path="/")
    return _conta_publica(usuario)


@app.post("/api/sair", tags=["conta"], dependencies=[Depends(conferir_origem)])
def sair(request: Request, response: Response, con: sqlite3.Connection = Depends(obter_banco)):
    seguranca.fechar_sessao(con, request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


class TrocaDeSenha(BaseModel):
    senhaAtual: str = Field(max_length=seguranca.SENHA_MAXIMA)
    novaSenha: str = Field(max_length=1000)  # acima de 128 a regra responde com a explicação


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


# As respostas têm os mesmos campos que o js/dados.js guarda, para o site usar sem converter
# (as funções que montam cada registro ficam em movimentos.py).

@app.get("/api/itens", tags=["estoque"])
def listar_itens(_: sqlite3.Row = Depends(exigir("ver_estoque")), con: sqlite3.Connection = Depends(obter_banco)):
    linhas = con.execute("SELECT * FROM itens ORDER BY nome COLLATE NOCASE").fetchall()
    return [movimentos.item_publico(i) for i in linhas]


@app.get("/api/doacoes", tags=["estoque"])
def listar_doacoes(_: sqlite3.Row = Depends(exigir("ver_estoque")), con: sqlite3.Connection = Depends(obter_banco)):
    # rowid no fim: no mesmo dia e no mesmo instante, a ordem em que foram gravadas.
    linhas = con.execute("SELECT * FROM doacoes ORDER BY data, criado_em, rowid").fetchall()
    return [movimentos.doacao_publica(m) for m in linhas]


@app.get("/api/dinheiro", tags=["financeiro"])
def listar_dinheiro(_: sqlite3.Row = Depends(exigir("ver_financeiro")), con: sqlite3.Connection = Depends(obter_banco)):
    linhas = con.execute("SELECT * FROM dinheiro ORDER BY data, criado_em, rowid").fetchall()
    return [movimentos.dinheiro_publico(m) for m in linhas]


# ---------- gravar: registrar e desfazer ----------

class NovoItem(BaseModel):
    nome: str | None = Field(None, max_length=1000)
    categoria: str | None = Field(None, max_length=100)
    unidade: str | None = Field(None, max_length=1000)
    minimo: Any = None  # número ou texto ("2,5"); a regra em movimentos.py responde com a explicação


class Movimento(BaseModel):
    """Os mesmos campos que o app manda ao store.registrar(), com o dinheiro já em centavos."""
    tipo: str | None = Field(None, max_length=40)
    data: str | None = Field(None, max_length=40)
    itemId: str | None = Field(None, max_length=100)
    novoItem: NovoItem | None = None
    quantidade: Any = None      # número (2.5) ou texto ("2,5")
    validade: str | None = Field(None, max_length=40)
    valorCentavos: Any = None   # inteiro: 15000 = R$ 150,00
    descricao: str | None = Field(None, max_length=1000)  # o servidor corta em 120, como o app
    pessoa: str | None = Field(None, max_length=1000)     # e em 80


@app.post("/api/movimentos", tags=["movimentos"], dependencies=[Depends(conferir_origem)])
def registrar_movimento(dados: Movimento, usuario: sqlite3.Row = Depends(usuario_logado),
                        con: sqlite3.Connection = Depends(obter_banco)):
    """Registra doação, saída de itens, entrada de dinheiro ou despesa, com as regras do store.js.
    Responde a movimentação gravada e o item como ficou (ou null, para dinheiro).
    A permissão depende do tipo, por isso é conferida aqui dentro, e não pela rota."""
    try:
        return movimentos.registrar(con, usuario["perfil"], dados.model_dump())
    except movimentos.Recusa as e:
        raise ErroDaApi(e.status, e.erro, e.campo) from None


@app.post("/api/movimentos/{codigo}/estorno", tags=["movimentos"], dependencies=[Depends(conferir_origem)])
def estornar_movimento(codigo: str, usuario: sqlite3.Row = Depends(usuario_logado),
                       con: sqlite3.Connection = Depends(obter_banco)):
    """Desfaz uma movimentação gravando o lançamento contrário (nada é apagado).
    Pede "desfazer" e poder ver a área (estoque ou financeiro). Desfazer duas vezes responde 409."""
    try:
        return movimentos.estornar(con, usuario["perfil"], codigo)
    except movimentos.Recusa as e:
        raise ErroDaApi(e.status, e.erro, e.campo) from None


@app.api_route("/api/{resto:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def rota_inexistente(resto: str, request: Request):
    # Rota que existe, mas com o método errado (ex.: POST /api/itens): 405, não 404.
    if any(getattr(r, "path", None) == f"/api/{resto}" for r in app.routes if r is not request.scope.get("route")):
        raise ErroDaApi(405, "Método não permitido.")
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
