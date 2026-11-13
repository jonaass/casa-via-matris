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
    """Roda as migrações que ainda não rodaram. Devolve a versão em que o banco ficou.

    BEGIN IMMEDIATE trava o banco para gravação antes de ler a versão: se dois processos abrirem um
    banco novo ao mesmo tempo, o segundo espera o primeiro e não tenta criar as tabelas de novo.
    """
    for arquivo in sorted(PASTA_MIGRACOES.glob("*.sql")):
        numero = int(arquivo.name.split("_", 1)[0])
        if numero <= con.execute("PRAGMA user_version").fetchone()[0]:
            continue
        script = arquivo.read_text(encoding="utf-8")
        con.execute("BEGIN IMMEDIATE")
        try:
            if numero <= con.execute("PRAGMA user_version").fetchone()[0]:
                con.rollback()  # outro processo rodou enquanto este esperava
                continue
            # Uma migração entra inteira ou não entra. executescript faria COMMIT antes; por isso,
            # cada comando roda separado dentro da mesma transação.
            for comando in _comandos(script):
                con.execute(comando)
            con.execute(f"PRAGMA user_version = {numero}")
            con.commit()
        except Exception:
            con.rollback()
            raise
    _preencher_chaves_dos_nomes(con)
    return con.execute("PRAGMA user_version").fetchone()[0]


def _preencher_chaves_dos_nomes(con: sqlite3.Connection) -> None:
    """Itens de antes da migração 002 ganham a chave do nome. Se dois já tinham o mesmo nome sem
    acento, o segundo fica sem chave (e aparece no aviso), em vez de travar o servidor."""
    from .seguranca import chave_do_nome
    if "nome_chave" not in {c[1] for c in con.execute("PRAGMA table_info(itens)")}:
        return
    for codigo, nome in con.execute("SELECT codigo, nome FROM itens WHERE nome_chave IS NULL").fetchall():
        try:
            with con:
                con.execute("UPDATE itens SET nome_chave = ? WHERE codigo = ?", (chave_do_nome(nome), codigo))
        except sqlite3.IntegrityError:
            print(f"Aviso: o item {nome!r} ({codigo}) repete o nome de outro item, sem contar acentos.")


def _comandos(script: str) -> list[str]:
    """Separa o script SQL em comandos (as migrações não usam ";" dentro de textos)."""
    sem_comentarios = "\n".join(l.split("--", 1)[0] for l in script.splitlines())
    return [c.strip() for c in sem_comentarios.split(";") if c.strip()]


def abrir_banco(caminho: Path | None = None) -> sqlite3.Connection:
    """Conecta e garante que as tabelas estão na versão mais nova (para os comandos e os testes).
    O servidor migra uma vez só, ao ligar, e depois só conecta."""
    con = conectar(caminho)
    migrar(con)
    return con
