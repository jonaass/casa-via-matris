"""Leva as planilhas de backup do app (as do botão "Fazer backup") para o banco.

Uso, da pasta do projeto:
    python -m backend.importar via-matris-estoque-2026-11-13.csv via-matris-doacoes-2026-11-13.csv ...

Segue as mesmas regras do js/backup.js:
- reconhece cada planilha pelo cabeçalho e importa o estoque antes das doações;
- registro com Código que já existe no banco é ignorado (importar duas vezes não duplica);
- linha com problema é pulada e o motivo aparece com o número dela; as outras entram;
- não mexe no estoque nem confere saldo: restaura registros.
"""
import csv
import io
import re
import secrets
import sqlite3
import sys
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

from . import banco, config
from .seguranca import chave_do_nome

MAX_QUANTIDADE_MILESIMOS = 1_000_000_000 * 1000


def _sem_acento(texto: str) -> str:
    nfd = unicodedata.normalize("NFD", str(texto or ""))
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").strip().lower()


# Cabeçalhos de cada planilha (sem acento e em minúsculas) → campo.
COLUNAS = {
    "itens": {"codigo": "codigo", "item": "nome", "categoria": "categoria", "unidade": "unidade",
              "quantidade em estoque": "quantidade", "estoque minimo": "minimo",
              "validade mais proxima": "validade"},
    "doacoes": {"codigo": "codigo", "data": "data", "movimento": "tipo", "codigo do item": "itemId",
                "item": "nomeDoItem", "quantidade": "quantidade", "unidade": "unidadeDoItem",
                "quem doou / para onde foi": "pessoa", "observacao": "descricao"},
    "dinheiro": {"codigo": "codigo", "data": "data", "movimento": "tipo", "valor (r$)": "valor",
                 "descricao": "descricao", "quem": "pessoa"},
}
# Coluna que só existe naquela planilha: é assim que se descobre qual é qual.
MARCA = {"itens": "quantidade em estoque", "doacoes": "codigo do item", "dinheiro": "valor (r$)"}
ORDEM = ["itens", "doacoes", "dinheiro"]

TIPOS = {
    "doacoes": {"doacao": "doacao_item", "doacao_item": "doacao_item", "saida": "saida_item", "saida_item": "saida_item"},
    "dinheiro": {"entrada": "entrada_dinheiro", "entrada_dinheiro": "entrada_dinheiro",
                 "despesa": "saida_dinheiro", "saida_dinheiro": "saida_dinheiro"},
}
CATEGORIAS = {"alimentos": "Alimentos", "higiene": "Higiene", "limpeza": "Limpeza"}
DOADOR_ANONIMO = "Doador anônimo"


class LinhaRuim(ValueError):
    pass


def _texto(valor: str, maximo: int) -> str:
    texto = " ".join(str(valor or "").split())
    if texto.startswith("'") and len(texto) > 1 and texto[1] in "=+-@":
        texto = texto[1:]  # o backup.js põe um apóstrofo antes de =, +, - e @ (proteção contra fórmula)
    if len(texto) > maximo:
        raise LinhaRuim(f"texto maior que {maximo} letras")
    return texto


def _data(valor: str, ate_hoje: bool = False) -> str | None:
    valor = str(valor or "").strip()
    if not valor:
        return None
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", valor) or None
    try:
        if m:
            d = date(int(m[3]), int(m[2]), int(m[1]))
        elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
            d = date.fromisoformat(valor)
        else:
            raise ValueError(valor)  # fromisoformat sozinho aceitaria "2026W011" (semana do ano)
    except ValueError:
        raise LinhaRuim(f'Data inválida ("{valor}"), use DD/MM/AAAA.') from None
    if ate_hoje and d > datetime.now(config.FUSO).date():
        raise LinhaRuim("a data não pode estar no futuro")
    return d.isoformat()


def _numero_br(valor: str, casas: int) -> int:
    """'1.234,56' com casas=2 → 123456. Devolve o número multiplicado por 10**casas, inteiro."""
    s = re.sub(r"R\$|\s", "", str(valor or ""))
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    if not re.fullmatch(rf"\d+(\.\d{{1,{casas}}})?", s):
        raise LinhaRuim(f'número inválido ("{valor}")')
    inteiro, _, frac = s.partition(".")
    return int(inteiro) * 10**casas + int(frac.ljust(casas, "0") or 0)


def _quantidade(valor: str, aceita_zero: bool = False) -> int:
    milesimos = _numero_br(valor, 3)
    if milesimos == 0 and not aceita_zero:
        raise LinhaRuim("a quantidade precisa ser maior que zero")
    if milesimos > MAX_QUANTIDADE_MILESIMOS:
        raise LinhaRuim("essa quantidade parece errada")
    return milesimos


def ler_planilha(texto: str) -> tuple[str, list[dict]]:
    """Descobre a coleção pelo cabeçalho e devolve (colecao, linhas como dicionários)."""
    texto = texto.lstrip("﻿")
    primeira = texto.splitlines()[0] if texto.strip() else ""
    separador = ";" if primeira.count(";") >= primeira.count(",") else ","
    leitor = csv.reader(io.StringIO(texto), delimiter=separador)
    # Guarda o número real de cada linha: as em branco são puladas, mas o erro aponta a linha certa.
    linhas = [(n, l) for n, l in enumerate(leitor, start=1) if any(c.strip() for c in l)]
    if not linhas:
        raise ValueError("A planilha está vazia.")
    cabecalho = [_sem_acento(c) for c in linhas[0][1]]
    colecao = next((c for c in ORDEM if MARCA[c] in cabecalho), None)
    if colecao is None:
        raise ValueError("Não reconheci esta planilha. Use as planilhas baixadas pelo botão Fazer backup.")
    campos = [COLUNAS[colecao].get(c) for c in cabecalho]
    registros = [{"_linha": n, **{campo: valor for campo, valor in zip(campos, linha) if campo}} for n, linha in linhas[1:]]
    return colecao, registros


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat()


def _codigo(r: dict) -> str:
    return _texto(r.get("codigo", ""), 40) or secrets.token_hex(6)


def _existe(con, tabela: str, codigo: str) -> bool:
    # Registro com código que já está no banco: importar duas vezes não duplica. (O INSERT OR IGNORE
    # que havia antes também engolia linhas recusadas pelo banco, que viravam "já existia".)
    return con.execute(f"SELECT 1 FROM {tabela} WHERE codigo = ?", (codigo,)).fetchone() is not None


def _importar_item(con, r):
    nome = _texto(r.get("nome"), 60)
    if not nome:
        raise LinhaRuim("falta o nome do item")
    categoria = CATEGORIAS.get(_sem_acento(r.get("categoria")))
    if not categoria:
        raise LinhaRuim("categoria precisa ser Alimentos, Higiene ou Limpeza")
    unidade = _texto(r.get("unidade"), 10)
    if not unidade:
        raise LinhaRuim("falta a unidade")
    codigo = _codigo(r)
    if _existe(con, "itens", codigo):
        return False
    if con.execute("SELECT 1 FROM itens WHERE nome_chave = ?", (chave_do_nome(nome),)).fetchone():
        if not r.get("codigo"):
            return False  # item sem código com nome que já existe: ignorado, para não duplicar
        raise LinhaRuim(f'já existe um item chamado "{nome}" (sem contar acentos e maiúsculas)')
    con.execute(
        "INSERT INTO itens (codigo, nome, nome_chave, categoria, unidade, quantidade_milesimos, minimo_milesimos, validade)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (codigo, nome, chave_do_nome(nome), categoria, unidade, _quantidade(r.get("quantidade"), True),
         _quantidade(r.get("minimo") or "0", True), _data(r.get("validade"))),
    )
    return True


def _importar_doacao(con, r):
    data = _data(r.get("data"), ate_hoje=True)
    if not data:
        raise LinhaRuim("falta a data")
    tipo = TIPOS["doacoes"].get(_sem_acento(r.get("tipo")))
    if not tipo:
        raise LinhaRuim("Movimento precisa ser Doação ou Saída")
    item_codigo = _texto(r.get("itemId"), 40)
    achado = con.execute("SELECT codigo FROM itens WHERE codigo = ?", (item_codigo,)).fetchone() if item_codigo else None
    if not achado and _texto(r.get("nomeDoItem"), 60):
        # Como o ligarAoItem do backup.js: código desconhecido, procura pelo nome (sem acento).
        achado = con.execute("SELECT codigo FROM itens WHERE nome_chave = ?",
                             (chave_do_nome(_texto(r.get("nomeDoItem"), 60)),)).fetchone()
    if not achado:
        raise LinhaRuim("o item não existe no estoque (importe a planilha do estoque primeiro)")
    pessoa = _texto(r.get("pessoa"), 80) or (DOADOR_ANONIMO if tipo == "doacao_item" else "")
    codigo = _codigo(r)
    if _existe(con, "doacoes", codigo):
        return False
    con.execute(
        "INSERT INTO doacoes (codigo, tipo, data, item_codigo, quantidade_milesimos, descricao, pessoa, criado_em)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (codigo, tipo, data, achado["codigo"], _quantidade(r.get("quantidade")),
         _texto(r.get("descricao"), 120), pessoa, _agora()),
    )
    return True


def _importar_dinheiro(con, r):
    data = _data(r.get("data"), ate_hoje=True)
    if not data:
        raise LinhaRuim("falta a data")
    tipo = TIPOS["dinheiro"].get(_sem_acento(r.get("tipo")))
    if not tipo:
        raise LinhaRuim("Movimento precisa ser Entrada ou Despesa")
    centavos = _numero_br(r.get("valor"), 2)
    if centavos <= 0:
        raise LinhaRuim("o valor precisa ser maior que zero")
    if centavos > 2**53:
        raise LinhaRuim("esse valor parece errado")
    descricao = _texto(r.get("descricao"), 120)
    if not descricao:
        raise LinhaRuim("falta a descrição")
    pessoa = _texto(r.get("pessoa"), 80) or (DOADOR_ANONIMO if tipo == "entrada_dinheiro" else "")
    codigo = _codigo(r)
    if _existe(con, "dinheiro", codigo):
        return False
    con.execute(
        "INSERT INTO dinheiro (codigo, tipo, data, valor_centavos, descricao, pessoa, criado_em)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (codigo, tipo, data, centavos, descricao, pessoa, _agora()),
    )
    return True


IMPORTADORES = {"itens": _importar_item, "doacoes": _importar_doacao, "dinheiro": _importar_dinheiro}


def importar_texto(con: sqlite3.Connection, texto: str) -> dict:
    """Importa uma planilha. Devolve { colecao, importados, ignorados, erros }."""
    colecao, registros = ler_planilha(texto)
    resultado = {"colecao": colecao, "importados": 0, "ignorados": 0, "erros": []}
    with con:  # a planilha entra numa transação só
        for r in registros:
            numero = r["_linha"]
            try:
                entrou = IMPORTADORES[colecao](con, r)
            except (LinhaRuim, sqlite3.IntegrityError) as e:
                resultado["erros"].append(f"Linha {numero}: {e}")
                continue
            resultado["importados" if entrou else "ignorados"] += 1
    return resultado


def importar_arquivos(con: sqlite3.Connection, caminhos: list[Path]) -> list[dict]:
    lidos = []
    for caminho in caminhos:
        texto = caminho.read_text(encoding="utf-8-sig")
        colecao, _ = ler_planilha(texto)
        lidos.append((ORDEM.index(colecao), caminho, texto))
    resultados = []
    for _, caminho, texto in sorted(lidos, key=lambda x: x[0]):  # estoque antes das doações
        r = importar_texto(con, texto)
        r["arquivo"] = caminho.name
        resultados.append(r)
    return resultados


def main(argumentos: list[str]) -> int:
    if not argumentos:
        print(__doc__)
        return 1
    con = banco.abrir_banco()
    try:
        for r in importar_arquivos(con, [Path(a) for a in argumentos]):
            print(f"{r['arquivo']} ({r['colecao']}): {r['importados']} importados, {r['ignorados']} já existiam")
            for erro in r["erros"]:
                print("   ", erro)
    except ValueError as e:
        print(e)
        return 1
    finally:
        con.close()
    saldo = banco.abrir_banco().execute(
        "SELECT COALESCE(SUM(CASE tipo WHEN 'entrada_dinheiro' THEN valor_centavos ELSE -valor_centavos END), 0)"
        " FROM dinheiro").fetchone()[0]
    if saldo < 0:
        print(f"Atenção: o saldo ficou negativo (R$ {saldo / 100:.2f}). Falta alguma planilha de entradas?")
    print(f"Banco: {config.caminho_do_banco()}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
