"""Perfis, senhas e sessões do servidor.

Os perfis repetem o PERFIS do js/acesso.js. O teste test_perfis_iguais_ao_acesso_js confere
se os dois continuam iguais: mudou lá, tem que mudar aqui. O mesmo vale para TERMOS_VERSAO
(test_termos_versao_igual_ao_acesso_js).

O servidor também confere a senha provisória e o aceite dos termos, como o acesso.js:
conta provisória ou sem o aceite da versão atual não entra nem continua com sessão aberta.
"""
import hashlib
import hmac
import re
import secrets
import sqlite3
import time
import unicodedata
from datetime import datetime, timezone

ESTOQUE = ["ver_estoque", "doacao_item", "saida_item"]
DINHEIRO = ["ver_financeiro", "entrada_dinheiro", "saida_dinheiro"]

PERFIS: dict[str, list[str]] = {
    "administrador": [*ESTOQUE, *DINHEIRO, "historico", "desfazer", "administrar"],
    "financeiro": [*DINHEIRO, "historico", "desfazer"],
    "almoxarifado": [*ESTOQUE, "historico", "desfazer"],
    "voluntario": [*ESTOQUE],
}

# Os mesmos números do js/acesso.js.
ITERACOES = 600_000  # PBKDF2-SHA256, número recomendado pela OWASP
SENHA_MINIMA = 8
SENHA_MAXIMA = 128
MAX_ERROS = 5
BLOQUEIO_S = 15 * 60
SESSAO_S = 8 * 60 * 60            # sessão comum: 8 horas, como a sessão curta do aparelho
SESSAO_LONGA_S = 30 * 24 * 60 * 60  # "Manter conectado": 30 dias, como no acesso.js

ERRO_LOGIN = "E-mail ou senha incorretos."

# Versão dos Termos de uso (termos.html). Igual à do js/acesso.js: mudou lá, muda aqui,
# e todo mundo precisa aceitar de novo na próxima entrada.
TERMOS_VERSAO = "2026-11-13"
ERRO_PROVISORIA = "A senha que você recebeu vale só para o primeiro acesso. Crie a sua senha para continuar."
ERRO_FALTAM_TERMOS = "Antes de continuar, leia e aceite os Termos de uso e o Aviso de privacidade."
ERRO_TERMOS = "Para continuar, leia e marque que aceita os Termos de uso e o Aviso de privacidade."  # o mesmo do acesso.js
EMAIL_VALIDO = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")  # a mesma regra do acesso.js


def chave_do_nome(nome: str) -> str:
    """Igual ao semAcento do store.js: sem acento, minúsculas e espaços únicos.
    "Feijão  Carioca" e "feijao carioca" são o mesmo item."""
    sem = "".join(c for c in unicodedata.normalize("NFD", str(nome or "")) if not unicodedata.combining(c))
    return " ".join(sem.lower().split())
SAL_FALSO = "00" * 16


def pode(perfil: str, acao: str) -> bool:
    return acao in PERFIS.get(perfil, [])


def normalizar_email(email: str) -> str:
    return str(email or "").strip().lower()


def derivar(senha: str, sal_hex: str, iteracoes: int) -> str:
    """O mesmo cálculo do acesso.js (PBKDF2-SHA256, 32 bytes, senha em NFKC)."""
    senha = unicodedata.normalize("NFKC", senha)
    return hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(sal_hex), iteracoes, 32).hex()


def nova_senha_guardada(senha: str, iteracoes: int = ITERACOES) -> dict:
    sal = secrets.token_hex(16)
    return {"sal": sal, "iteracoes": iteracoes, "hash": derivar(senha, sal, iteracoes)}


def erro_da_senha(senha: str) -> str | None:
    if not isinstance(senha, str) or len(senha) < SENHA_MINIMA:
        return f"A senha precisa ter pelo menos {SENHA_MINIMA} caracteres."
    if len(senha) > SENHA_MAXIMA:
        return f"A senha pode ter no máximo {SENHA_MAXIMA} caracteres."
    return None


def _agora_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def criar_usuario(con: sqlite3.Connection, nome: str, email: str, perfil: str, senha: str,
                  iteracoes: int = ITERACOES, provisoria: bool = True, aceitou_termos: bool = False) -> str:
    """Cadastra uma conta e devolve o código dela. Dá ValueError com a explicação se algo não servir.

    Por padrão a senha é provisória e os termos ainda não foram aceitos: no primeiro acesso, a pessoa
    cria a senha dela e aceita os termos (POST /api/definir-senha), como no app.
    """
    nome = " ".join(str(nome or "").split())[:80]
    email = normalizar_email(email)
    if not nome:
        raise ValueError("Informe o nome da pessoa.")
    if not EMAIL_VALIDO.match(email) or len(email) > 120:
        raise ValueError("Informe um e-mail válido, como nome@exemplo.com.")
    if perfil not in PERFIS:
        raise ValueError(f"Escolha um perfil: {', '.join(PERFIS)}.")
    erro = erro_da_senha(senha)
    if erro:
        raise ValueError(erro)
    if con.execute("SELECT 1 FROM usuarios WHERE email = ?", (email,)).fetchone():
        raise ValueError("Esse e-mail já tem uma conta.")
    g = nova_senha_guardada(senha, iteracoes)
    codigo = secrets.token_hex(8)
    with con:
        con.execute(
            "INSERT INTO usuarios (codigo, nome, email, perfil, senha_sal, senha_iteracoes, senha_hash, criado_em,"
            " provisoria, termos_versao, termos_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (codigo, nome, email, perfil, g["sal"], g["iteracoes"], g["hash"], _agora_utc(), int(bool(provisoria)),
             TERMOS_VERSAO if aceitou_termos else None, _agora_utc() if aceitou_termos else None),
        )
    return codigo


def _erro_de_bloqueio(ate: float) -> str:
    minutos = max(1, int((ate - time.time() + 59) // 60))
    return (f"Conta bloqueada por muitas tentativas. Tente de novo em {minutos} min "
            "ou peça ajuda ao administrador.")


def validar_login(con: sqlite3.Connection, email: str, senha: str,
                  revelar_bloqueio: bool = False) -> tuple[sqlite3.Row | None, str | None]:
    """Confere e-mail e senha. Devolve (usuário, None) ou (None, mensagem de erro).

    Para quem está de fora (a tela de entrada), toda recusa responde igual e leva o mesmo tempo:
    e-mail que não existe, senha errada, conta bloqueada e conta desativada. Assim ninguém descobre
    pela internet quais e-mails têm conta, nem confirma uma senha certa de conta desativada.
    revelar_bloqueio: para quem já está logado (trocar a senha), avisa que a conta bloqueou.
    """
    senha = str(senha or "")
    usuario = con.execute("SELECT * FROM usuarios WHERE email = ?", (normalizar_email(email),)).fetchone()
    if usuario is None:
        derivar(senha, SAL_FALSO, ITERACOES)  # o mesmo tempo de uma conta real
        return None, ERRO_LOGIN
    if usuario["bloqueado_ate"] > time.time():
        derivar(senha, SAL_FALSO, ITERACOES)
        return None, _erro_de_bloqueio(usuario["bloqueado_ate"]) if revelar_bloqueio else ERRO_LOGIN
    certo = derivar(senha, usuario["senha_sal"], usuario["senha_iteracoes"])
    if not hmac.compare_digest(certo, usuario["senha_hash"]):
        with con:
            # Soma no próprio banco: vários pedidos ao mesmo tempo não podem "perder" erros
            # (lendo e gravando em Python, 15 senhas erradas em paralelo não bloqueavam a conta).
            tentativas = con.execute(
                "UPDATE usuarios SET tentativas = tentativas + 1 WHERE codigo = ? RETURNING tentativas",
                (usuario["codigo"],)).fetchone()[0]
            if tentativas >= MAX_ERROS:
                ate = time.time() + BLOQUEIO_S
                con.execute("UPDATE usuarios SET tentativas = 0, bloqueado_ate = ? WHERE codigo = ?",
                            (ate, usuario["codigo"]))
                if revelar_bloqueio:
                    return None, _erro_de_bloqueio(ate)
        return None, ERRO_LOGIN
    if not usuario["ativo"]:
        return None, ERRO_LOGIN
    with con:
        con.execute("UPDATE usuarios SET tentativas = 0, bloqueado_ate = 0 WHERE codigo = ?", (usuario["codigo"],))
    return usuario, None


def pendencia(usuario: sqlite3.Row) -> tuple[str, str] | None:
    """O que falta para a conta entrar: ("senhaProvisoria", msg), ("termos", msg) ou None."""
    if usuario["provisoria"]:
        return "senhaProvisoria", ERRO_PROVISORIA
    if usuario["termos_versao"] != TERMOS_VERSAO:
        return "termos", ERRO_FALTAM_TERMOS
    return None


class Recusa(Exception):
    """Pedido de conta recusado. status: 400 (dado), 401 (senha), 409 (situação da conta)."""

    def __init__(self, status: int, erro: str, campo: str | None = None):
        super().__init__(erro)
        self.status, self.erro, self.campo = status, erro, campo


def definir_senha(con: sqlite3.Connection, email: str, atual: str, nova: str, aceitou_termos: bool,
                  iteracoes: int = ITERACOES) -> None:
    """Primeiro acesso: troca a senha provisória pela da pessoa e anota o aceite dos termos.
    Confere a senha atual com o mesmo bloqueio do login. Dá Recusa se algo não servir.
    Como no acesso.js (trocarSenha): conta provisória sem o aceite da versão atual precisa aceitar agora."""
    erro = erro_da_senha(nova)
    if erro:
        raise Recusa(400, erro, "novaSenha")
    if nova == atual:
        raise Recusa(400, "A senha nova precisa ser diferente da atual.", "novaSenha")
    usuario, erro = validar_login(con, email, atual)
    if erro:
        raise Recusa(401, erro, "senhaAtual")
    if not usuario["provisoria"]:
        raise Recusa(409, "Esta conta já tem senha própria. Entre com ela; para mudar, use Trocar senha.")
    if usuario["termos_versao"] != TERMOS_VERSAO and aceitou_termos is not True:
        raise Recusa(400, ERRO_TERMOS, "aceitouTermos")
    g = nova_senha_guardada(nova, iteracoes)
    with con:
        con.execute("UPDATE usuarios SET senha_sal = ?, senha_iteracoes = ?, senha_hash = ?, provisoria = 0 WHERE codigo = ?",
                    (g["sal"], g["iteracoes"], g["hash"], usuario["codigo"]))
        if aceitou_termos is True:
            con.execute("UPDATE usuarios SET termos_versao = ?, termos_em = ? WHERE codigo = ?",
                        (TERMOS_VERSAO, _agora_utc(), usuario["codigo"]))
        con.execute("DELETE FROM sessoes WHERE usuario_codigo = ?", (usuario["codigo"],))


def aceitar_termos(con: sqlite3.Connection, email: str, senha: str, aceito: bool) -> None:
    """Quem já tem senha própria e ainda não aceitou esta versão dos termos. Confere a senha de novo."""
    if aceito is not True:
        raise Recusa(400, ERRO_TERMOS, "aceito")
    usuario, erro = validar_login(con, email, senha)
    if erro:
        raise Recusa(401, erro, "senha")
    if usuario["provisoria"]:
        raise Recusa(409, "Crie a sua senha antes de continuar.", "senhaProvisoria")
    with con:
        con.execute("UPDATE usuarios SET termos_versao = ?, termos_em = ? WHERE codigo = ?",
                    (TERMOS_VERSAO, _agora_utc(), usuario["codigo"]))


def trocar_senha(con: sqlite3.Connection, email: str, atual: str, nova: str,
                 manter_sessao: str | None = None, iteracoes: int = ITERACOES) -> str | None:
    """Troca a senha conferindo a atual (com o mesmo bloqueio do login). Devolve None ou a mensagem de erro.
    As outras sessões da conta são fechadas: quem tinha a senha antiga não continua dentro."""
    erro = erro_da_senha(nova)
    if erro:
        return erro
    if nova == atual:
        return "A senha nova precisa ser diferente da atual."
    usuario, erro = validar_login(con, email, atual, revelar_bloqueio=True)
    if erro:
        return erro
    g = nova_senha_guardada(nova, iteracoes)
    with con:
        con.execute("UPDATE usuarios SET senha_sal = ?, senha_iteracoes = ?, senha_hash = ? WHERE codigo = ?",
                    (g["sal"], g["iteracoes"], g["hash"], usuario["codigo"]))
        con.execute("DELETE FROM sessoes WHERE usuario_codigo = ? AND token_hash != ?",
                    (usuario["codigo"], _hash_do_token(manter_sessao or "")))
    return None


def redefinir_senha(con: sqlite3.Connection, email: str, nova: str, iteracoes: int = ITERACOES) -> None:
    """Para quem cuida do servidor: troca a senha sem pedir a atual, desbloqueia e fecha as sessões.
    A senha nova é provisória: no próximo acesso, a pessoa cria a dela (como o "Gerar senha" do app)."""
    erro = erro_da_senha(nova)
    if erro:
        raise ValueError(erro)
    usuario = con.execute("SELECT codigo FROM usuarios WHERE email = ?", (normalizar_email(email),)).fetchone()
    if usuario is None:
        raise ValueError("Não existe conta com esse e-mail.")
    g = nova_senha_guardada(nova, iteracoes)
    with con:
        con.execute("UPDATE usuarios SET senha_sal = ?, senha_iteracoes = ?, senha_hash = ?, tentativas = 0,"
                    " bloqueado_ate = 0, provisoria = 1 WHERE codigo = ?", (g["sal"], g["iteracoes"], g["hash"], usuario["codigo"]))
        con.execute("DELETE FROM sessoes WHERE usuario_codigo = ?", (usuario["codigo"],))


def _hash_do_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def abrir_sessao(con: sqlite3.Connection, usuario_codigo: str, duracao_s: int = SESSAO_S) -> str:
    """Cria a sessão e devolve o token (vai só no cookie; o banco guarda o hash)."""
    token = secrets.token_urlsafe(32)
    agora = time.time()
    with con:
        con.execute("DELETE FROM sessoes WHERE expira_em < ?", (agora,))  # faxina das vencidas
        con.execute("INSERT INTO sessoes (token_hash, usuario_codigo, criada_em, expira_em) VALUES (?, ?, ?, ?)",
                    (_hash_do_token(token), usuario_codigo, agora, agora + duracao_s))
    return token


def usuario_da_sessao(con: sqlite3.Connection, token: str | None) -> sqlite3.Row | None:
    if not token:
        return None
    return con.execute(
        # Como o contaAtual() do acesso.js: provisória ou sem o aceite da versão atual não vale como sessão.
        "SELECT u.* FROM sessoes s JOIN usuarios u ON u.codigo = s.usuario_codigo"
        " WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1 AND u.provisoria = 0 AND u.termos_versao = ?",
        (_hash_do_token(token), time.time(), TERMOS_VERSAO),
    ).fetchone()


def fechar_sessao(con: sqlite3.Connection, token: str | None) -> None:
    if token:
        with con:
            con.execute("DELETE FROM sessoes WHERE token_hash = ?", (_hash_do_token(token),))
