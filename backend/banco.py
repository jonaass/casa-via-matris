"""Conexão com o banco SQLite e migrações.

Toda conexão liga as chaves estrangeiras, o modo WAL (leitura e gravação ao mesmo tempo) e
uma espera quando o banco está ocupado. As migrações são os arquivos numerados em migracoes/:
cada uma roda uma vez só, e o número da última fica guardado no próprio banco (user_version).
"""
import sqlite3
from pathlib import Path

from . import config

PASTA_MIGRACOES = Path(__file__).resolve().parent / "migracoes"


def conectar(caminho: Path | None = None) -> sqlite3.Connection:
    caminho = caminho or config.caminho_do_banco()
    caminho.parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: o FastAPI pode abrir a conexão numa thread e usá-la em outra,
    # mas cada pedido tem a sua conexão, então nunca há duas threads usando a mesma ao mesmo tempo.
    con = sqlite3.connect(caminho, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA busy_timeout = 5000")
    return con


def migrar(con: sqlite3.Connection) -> int:
    """Roda as migrações que ainda não rodaram. Devolve a versão em que o banco ficou."""
    versao = con.execute("PRAGMA user_version").fetchone()[0]
    for arquivo in sorted(PASTA_MIGRACOES.glob("*.sql")):
        numero = int(arquivo.name.split("_", 1)[0])
        if numero <= versao:
            continue
        # Uma migração entra inteira ou não entra.
        script = arquivo.read_text(encoding="utf-8")
        try:
            con.executescript(f"BEGIN;\n{script}\nPRAGMA user_version = {numero};\nCOMMIT;")
        except sqlite3.Error:
            con.rollback()
            raise
        versao = numero
    return versao


def abrir_banco(caminho: Path | None = None) -> sqlite3.Connection:
    """Conecta e garante que as tabelas estão na versão mais nova."""
    con = conectar(caminho)
    migrar(con)
    return con
