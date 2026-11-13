"""Perfis, senhas e sessões do servidor.

Os perfis repetem o PERFIS do js/acesso.js. O teste test_perfis_iguais_ao_acesso_js confere
se os dois continuam iguais: mudou lá, tem que mudar aqui.
"""
import hashlib
import hmac
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
SESSAO_S = 8 * 60 * 60

ERRO_LOGIN = "E-mail ou senha incorretos."
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


def criar_usuario(con: sqlite3.Connection, nome: str, email: str, perfil: str, senha: str,
                  iteracoes: int = ITERACOES) -> str:
    """Cadastra uma conta e devolve o código dela. Dá ValueError com a explicação se algo não servir."""
    nome = " ".join(str(nome or "").split())[:80]
    email = normalizar_email(email)
    if not nome:
        raise ValueError("Informe o nome da pessoa.")
    if "@" not in email or len(email) > 120:
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
            "INSERT INTO usuarios (codigo, nome, email, perfil, senha_sal, senha_iteracoes, senha_hash, criado_em)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (codigo, nome, email, perfil, g["sal"], g["iteracoes"], g["hash"],
             datetime.now(timezone.utc).isoformat()),
        )
    return codigo


def _erro_de_bloqueio(ate: float) -> str:
    minutos = max(1, int((ate - time.time() + 59) // 60))
    return (f"Conta bloqueada por muitas tentativas. Tente de novo em {minutos} min "
            "ou peça ajuda ao administrador.")


def validar_login(con: sqlite3.Connection, email: str, senha: str) -> tuple[sqlite3.Row | None, str | None]:
    """Confere e-mail e senha na ordem do acesso.js. Devolve (usuário, None) ou (None, mensagem de erro)."""
    senha = str(senha or "")
    usuario = con.execute("SELECT * FROM usuarios WHERE email = ?", (normalizar_email(email),)).fetchone()
    if usuario is None:
        # Gasta o mesmo tempo de uma conta real, para não revelar quais e-mails existem.
        derivar(senha, SAL_FALSO, ITERACOES)
        return None, ERRO_LOGIN
    if usuario["bloqueado_ate"] > time.time():
        return None, _erro_de_bloqueio(usuario["bloqueado_ate"])
    certo = derivar(senha, usuario["senha_sal"], usuario["senha_iteracoes"])
    if not hmac.compare_digest(certo, usuario["senha_hash"]):
        tentativas = usuario["tentativas"] + 1
        with con:
            if tentativas >= MAX_ERROS:
                ate = time.time() + BLOQUEIO_S
                con.execute("UPDATE usuarios SET tentativas = 0, bloqueado_ate = ? WHERE codigo = ?",
                            (ate, usuario["codigo"]))
                return None, _erro_de_bloqueio(ate)
            con.execute("UPDATE usuarios SET tentativas = ? WHERE codigo = ?", (tentativas, usuario["codigo"]))
        return None, ERRO_LOGIN
    if not usuario["ativo"]:
        return None, "Esta conta foi desativada. Fale com o administrador."
    with con:
        con.execute("UPDATE usuarios SET tentativas = 0, bloqueado_ate = 0 WHERE codigo = ?", (usuario["codigo"],))
    return usuario, None


def trocar_senha(con: sqlite3.Connection, email: str, atual: str, nova: str,
                 manter_sessao: str | None = None, iteracoes: int = ITERACOES) -> str | None:
    """Troca a senha conferindo a atual (com o mesmo bloqueio do login). Devolve None ou a mensagem de erro.
    As outras sessões da conta são fechadas: quem tinha a senha antiga não continua dentro."""
    erro = erro_da_senha(nova)
    if erro:
        return erro
    if nova == atual:
        return "A senha nova precisa ser diferente da atual."
    usuario, erro = validar_login(con, email, atual)
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
    """Para quem cuida do servidor: troca a senha sem pedir a atual, desbloqueia e fecha as sessões."""
    erro = erro_da_senha(nova)
    if erro:
        raise ValueError(erro)
    usuario = con.execute("SELECT codigo FROM usuarios WHERE email = ?", (normalizar_email(email),)).fetchone()
    if usuario is None:
        raise ValueError("Não existe conta com esse e-mail.")
    g = nova_senha_guardada(nova, iteracoes)
    with con:
        con.execute("UPDATE usuarios SET senha_sal = ?, senha_iteracoes = ?, senha_hash = ?, tentativas = 0,"
                    " bloqueado_ate = 0 WHERE codigo = ?", (g["sal"], g["iteracoes"], g["hash"], usuario["codigo"]))
        con.execute("DELETE FROM sessoes WHERE usuario_codigo = ?", (usuario["codigo"],))


def _hash_do_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def abrir_sessao(con: sqlite3.Connection, usuario_codigo: str) -> str:
    """Cria a sessão e devolve o token (vai só no cookie; o banco guarda o hash)."""
    token = secrets.token_urlsafe(32)
    agora = time.time()
    with con:
        con.execute("DELETE FROM sessoes WHERE expira_em < ?", (agora,))  # faxina das vencidas
        con.execute("INSERT INTO sessoes (token_hash, usuario_codigo, criada_em, expira_em) VALUES (?, ?, ?, ?)",
                    (_hash_do_token(token), usuario_codigo, agora, agora + SESSAO_S))
    return token


def usuario_da_sessao(con: sqlite3.Connection, token: str | None) -> sqlite3.Row | None:
    if not token:
        return None
    return con.execute(
        "SELECT u.* FROM sessoes s JOIN usuarios u ON u.codigo = s.usuario_codigo"
        " WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1",
        (_hash_do_token(token), time.time()),
    ).fetchone()


def fechar_sessao(con: sqlite3.Connection, token: str | None) -> None:
    if token:
        with con:
            con.execute("DELETE FROM sessoes WHERE token_hash = ?", (_hash_do_token(token),))
