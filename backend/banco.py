"""Conexão com o banco e migrações. Funciona com dois bancos:

- SQLite (padrão): um arquivo no computador. É o que roda nos testes e no desenvolvimento.
- Postgres: quando existe a variável DATABASE_URL (na Vercel, o banco Neon). Um servidor sem disco
  próprio, como a Vercel, apaga o arquivo do SQLite a cada publicação; o Postgres fica num serviço à parte.

O resto do back-end escreve o SQL do jeito do SQLite (com "?") e usa a conexão como a do sqlite3.
A classe ConexaoPostgres traduz o pouco que muda. As migrações são os arquivos numerados em migracoes/:
cada uma roda uma vez só, e o número da última fica guardado no próprio banco.
"""
import contextlib
import decimal
import re
import sqlite3
import time
from pathlib import Path

from . import config

PASTA_MIGRACOES = Path(__file__).resolve().parent / "migracoes"

try:
    import psycopg
    _ERROS_PG = (psycopg.errors.IntegrityError,)
except ImportError:  # o psycopg só é necessário com o Postgres
    psycopg = None
    _ERROS_PG = ()

# Para usar em "except": nome repetido, desfazer duas vezes... nos dois bancos.
ErroDeIntegridade = (sqlite3.IntegrityError, *_ERROS_PG)

# Número fixo da trava de gravação no Postgres (pg_advisory_xact_lock). Faz o papel do BEGIN IMMEDIATE do
# SQLite: uma gravação por vez no banco inteiro. Para uma casa de acolhimento, é rápido de sobra.
_TRAVA_GRAVACAO = 7301
_TRAVA_MIGRACAO = 7302


# ---------- Postgres ----------


class _Linha(tuple):
    """Uma linha do resultado, lida por posição (linha[0]) ou por nome (linha["nome"]), como a sqlite3.Row."""

    def __new__(cls, nomes, valores):
        # A soma de BIGINT no Postgres volta como Decimal: o resto do código espera int.
        valores = [int(v) if isinstance(v, decimal.Decimal) and v == v.to_integral_value() else v for v in valores]
        linha = super().__new__(cls, valores)
        linha._nomes = nomes
        return linha

    def __getitem__(self, chave):
        if isinstance(chave, str):
            return tuple.__getitem__(self, self._nomes.index(chave))
        return tuple.__getitem__(self, chave)

    def keys(self):
        return list(self._nomes)


class _Cursor:
    def __init__(self, cursor):
        self._c = cursor
        self._nomes = [d.name for d in cursor.description] if cursor.description else []

    def _linha(self, valores):
        return None if valores is None else _Linha(self._nomes, valores)

    def fetchone(self):
        return self._linha(self._c.fetchone()) if self._nomes else None

    def fetchall(self):
        return [self._linha(v) for v in self._c.fetchall()] if self._nomes else []

    def __iter__(self):
        return iter(self.fetchall())

    @property
    def rowcount(self):
        return self._c.rowcount


def traduzir(sql: str) -> str:
    """O SQL do back-end está no dialeto do SQLite. Aqui vira Postgres."""
    sql = sql.replace("%", "%%").replace("?", "%s")
    sql = sql.replace("nome COLLATE NOCASE", "lower(nome)")
    return sql


class ConexaoPostgres:
    """Imita a conexão do sqlite3 (execute, commit, rollback, close e "with con:")."""
    postgres = True

    def __init__(self, url: str):
        self._c = psycopg.connect(url)

    def execute(self, sql: str, parametros=()):
        if sql.strip().upper() == "BEGIN IMMEDIATE":
            self._c.commit()  # fecha leituras pendentes, como o SQLite começaria do zero
            sql = f"SELECT pg_advisory_xact_lock({_TRAVA_GRAVACAO})"
        cursor = self._c.cursor()
        cursor.execute(traduzir(sql), parametros)
        return _Cursor(cursor)

    def commit(self):
        self._c.commit()

    def rollback(self):
        self._c.rollback()

    def close(self):
        self._c.close()

    def __enter__(self):
        return self

    def __exit__(self, tipo, *_):
        if tipo is None:
            self._c.commit()
        else:
            self._c.rollback()
        return False


# ---------- abrir ----------


def usa_postgres() -> bool:
    return bool(config.url_do_postgres())


def conectar(caminho: Path | None = None):
    """Abre a conexão: Postgres se houver DATABASE_URL (e nenhum arquivo foi pedido), senão SQLite."""
    url = config.url_do_postgres()
    if url and caminho is None:
        if psycopg is None:
            raise RuntimeError("DATABASE_URL aponta para um Postgres, mas falta instalar o psycopg.")
        return ConexaoPostgres(url)
    caminho = caminho or config.caminho_do_banco()
    caminho.parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: o FastAPI pode abrir a conexão numa thread e usá-la em outra,
    # mas cada pedido tem a sua conexão, então nunca há duas threads usando a mesma ao mesmo tempo.
    con = sqlite3.connect(caminho, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout = 5000")
    con.execute("PRAGMA foreign_keys = ON")
    _ligar_wal(con)
    return con


def _ligar_wal(con: sqlite3.Connection) -> None:
    """Liga o modo WAL. Num banco novo, duas conexões abrindo juntas disputam essa troca, e o SQLite
    não espera (o busy_timeout não vale para ela): responde "database is locked" na hora.
    Por isso tenta de novo por até uns 5 segundos. Depois da primeira vez o WAL fica gravado no arquivo."""
    for tentativa in range(100):
        try:
            con.execute("PRAGMA journal_mode = WAL")
            return
        except sqlite3.OperationalError as erro:
            if "locked" not in str(erro) or tentativa == 99:
                raise
            time.sleep(0.05)


def eh_postgres(con) -> bool:
    return getattr(con, "postgres", False)


@contextlib.contextmanager
def gravacao(con):
    """Uma gravação por vez no banco inteiro: conferir (tem estoque? tem saldo?) e gravar acontecem juntos.
    Qualquer erro desfaz tudo."""
    con.execute("BEGIN IMMEDIATE")
    try:
        yield
        con.commit()
    except BaseException:
        con.rollback()
        raise


@contextlib.contextmanager
def linha_protegida(con):
    """Para o "except ErroDeIntegridade" no meio de uma transação maior (a importação de planilhas):
    no Postgres, um erro estraga a transação inteira, então cada linha vira um ponto de retorno."""
    if not eh_postgres(con):
        yield
        return
    con.execute("SAVEPOINT linha")
    try:
        yield
    except BaseException:
        con.execute("ROLLBACK TO SAVEPOINT linha")
        raise
    con.execute("RELEASE SAVEPOINT linha")


# ---------- migrações ----------


def _sql_da_migracao(script: str, postgres: bool) -> list[str]:
    comandos = _comandos(script)
    if not postgres:
        return comandos
    traduzidos = []
    for c in comandos:
        c = re.sub(r"\bINTEGER\b", "BIGINT", c)  # dinheiro em centavos passa de 2 bilhões
        c = re.sub(r"\bREAL\b", "DOUBLE PRECISION", c)  # segundos desde 1970 precisam de precisão dupla
        # O SQLite numera as linhas sozinho (rowid) e o código usa isso como "ordem de gravação".
        c = re.sub(r"^CREATE TABLE (doacoes|dinheiro) \(", r"CREATE TABLE \1 (\n  rowid BIGSERIAL,", c)
        traduzidos.append(c)
    return traduzidos


def migrar(con) -> int:
    """Roda as migrações que ainda não rodaram. Devolve a versão em que o banco ficou.

    A trava de gravação vem antes de ler a versão: se dois processos abrirem um banco novo ao mesmo
    tempo, o segundo espera o primeiro e não tenta criar as tabelas de novo.
    """
    postgres = eh_postgres(con)
    if postgres:
        with con:
            con.execute(f"SELECT pg_advisory_xact_lock({_TRAVA_MIGRACAO})")
            con.execute("CREATE TABLE IF NOT EXISTS versao_do_banco (versao BIGINT NOT NULL)")
            if con.execute("SELECT versao FROM versao_do_banco").fetchone() is None:
                con.execute("INSERT INTO versao_do_banco (versao) VALUES (0)")

    def versao() -> int:
        if postgres:
            return con.execute("SELECT versao FROM versao_do_banco").fetchone()[0]
        return con.execute("PRAGMA user_version").fetchone()[0]

    for arquivo in sorted(PASTA_MIGRACOES.glob("*.sql")):
        numero = int(arquivo.name.split("_", 1)[0])
        if numero <= versao():
            continue
        script = arquivo.read_text(encoding="utf-8")
        if postgres:
            con.commit()
            con.execute(f"SELECT pg_advisory_xact_lock({_TRAVA_MIGRACAO})")
        else:
            con.execute("BEGIN IMMEDIATE")
        try:
            if numero <= versao():
                con.rollback()  # outro processo rodou enquanto este esperava
                continue
            # Uma migração entra inteira ou não entra. executescript faria COMMIT antes; por isso,
            # cada comando roda separado dentro da mesma transação.
            for comando in _sql_da_migracao(script, postgres):
                con.execute(comando)
            if postgres:
                con.execute("UPDATE versao_do_banco SET versao = ?", (numero,))
            else:
                con.execute(f"PRAGMA user_version = {numero}")
            con.commit()
        except Exception:
            con.rollback()
            raise
    _preencher_chaves_dos_nomes(con)
    v = versao()
    con.commit()
    return v


def _preencher_chaves_dos_nomes(con) -> None:
    """Itens de antes da migração 002 ganham a chave do nome. Se dois já tinham o mesmo nome sem
    acento, o segundo fica sem chave (e aparece no aviso), em vez de travar o servidor."""
    from .seguranca import chave_do_nome
    for codigo, nome in con.execute("SELECT codigo, nome FROM itens WHERE nome_chave IS NULL").fetchall():
        try:
            with con:
                con.execute("UPDATE itens SET nome_chave = ? WHERE codigo = ?", (chave_do_nome(nome), codigo))
        except ErroDeIntegridade:
            print(f"Aviso: o item {nome!r} ({codigo}) repete o nome de outro item, sem contar acentos.")


def _comandos(script: str) -> list[str]:
    """Separa o script SQL em comandos (as migrações não usam ";" dentro de textos)."""
    sem_comentarios = "\n".join(l.split("--", 1)[0] for l in script.splitlines())
    return [c.strip() for c in sem_comentarios.split(";") if c.strip()]


def abrir_banco(caminho: Path | None = None):
    """Conecta e garante que as tabelas estão na versão mais nova (para os comandos e os testes).
    O servidor migra uma vez só, ao ligar, e depois só conecta."""
    con = conectar(caminho)
    migrar(con)
    return con
