"""Gravar no banco: registrar e desfazer movimentações.

Repete as regras do js/store.js (registrar e estornar), com as mesmas mensagens, para o site
mostrar o erro no mesmo lugar, venha ele do aparelho ou do servidor. Mudou lá, tem que mudar aqui.

Duas diferenças de propósito:
- Desfazer não apaga nada: grava um lançamento contrário, ligado ao original por estorno_de.
  Para a prestação de contas, o que aconteceu fica registrado (o store.js, só no aparelho, apaga).
- Item cadastrado por uma doação desfeita continua na tabela, com quantidade 0 (o lançamento
  contrário aponta para ele, então ele não pode sumir).

Cada gravação é uma transação só (BEGIN IMMEDIATE): a conferência (tem estoque? tem saldo?) e a
gravação acontecem com o banco travado para outras gravações. Assim, duas pessoas tirando ao mesmo
tempo o último item não conseguem as duas: a segunda espera a primeira e já vê o estoque zerado.
"""
import re
import secrets
import sqlite3
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from . import banco, config, seguranca

TIPOS = {
    "doacao_item": {"area": "estoque", "contrario": "saida_item"},
    "saida_item": {"area": "estoque", "contrario": "doacao_item"},
    "entrada_dinheiro": {"area": "financeiro", "contrario": "saida_dinheiro"},
    "saida_dinheiro": {"area": "financeiro", "contrario": "entrada_dinheiro"},
}
CATEGORIAS = ("Alimentos", "Higiene", "Limpeza")
QUANTIDADE_MAXIMA_MILESIMOS = 1_000_000_000 * 1000  # QUANTIDADE_MAXIMA do store.js, em milésimos
CENTAVOS_MAXIMO = 2**53 - 1  # o maior inteiro exato no JavaScript (Number.isSafeInteger)
DOADOR_ANONIMO = "Doador anônimo"
TIPOS_DE_DOACAO = ("doacao_item", "entrada_dinheiro")
NEGADO = "Seu perfil não pode fazer isso."


class Recusa(Exception):
    """Pedido recusado por uma regra. status: 422 (regra), 403 (perfil), 404 (não existe), 409 (já desfeito)."""

    def __init__(self, erro: str, campo: str | None = None, status: int = 422):
        super().__init__(erro)
        self.erro, self.campo, self.status = erro, campo, status


# ---------- conversões (sem número com vírgula flutuante) ----------

def hoje() -> str:
    """O dia de hoje em Brasília, como o dataDeHoje() do aparelho."""
    return datetime.now(config.FUSO).date().isoformat()


def _agora_utc() -> str:
    # Mesmo formato do new Date().toISOString() do store.js.
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def data_valida(valor) -> bool:
    """Só AAAA-MM-DD de um dia que existe (31/02 não), como o dataValida do store.js."""
    if not isinstance(valor, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", valor):
        return False
    try:
        date.fromisoformat(valor)
    except ValueError:
        return False
    return True


def texto(valor, maximo: int) -> str:
    """Corta espaços sobrando e limita o tamanho, como o texto() do store.js."""
    return " ".join(str("" if valor is None else valor).split())[:maximo]


def _milesimos_de_texto(valor: str) -> int | None:
    """Número no formato brasileiro ("2,5", "1.000", "1.234,567"), como o numeroDeTexto do store.js."""
    s = re.sub(r"R\$|\s", "", valor)
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    if not re.fullmatch(r"\d+(\.\d{1,3})?", s):
        return None
    inteiro, _, frac = s.partition(".")
    return int(inteiro) * 1000 + int(frac.ljust(3, "0") or 0)


def milesimos(valor) -> int | None:
    """Quantidade em milésimos inteiros (2,5 → 2500). Aceita número ou texto, como o quantidadeDeTexto.

    O número vira texto antes da conta (Decimal(str(2.5))): assim 0,1 + 0,2 não vira 0,30000000000000004.
    Arredonda para 3 casas, como o arred() do store.js. Devolve None quando não é um número.
    """
    if isinstance(valor, str):
        return _milesimos_de_texto(valor)
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    try:
        d = Decimal(str(valor))
    except InvalidOperation:
        return None
    if not d.is_finite():
        return None
    return int((d * 1000).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def quantidade_publica(m: int) -> float | int:
    """Milésimos → número do jeito que o dados.js guarda (2500 → 2.5, 3000 → 3)."""
    return m // 1000 if m % 1000 == 0 else m / 1000


def texto_da_quantidade(m: int, unidade: str) -> str:
    """Como o textoDaQuantidade do utilitarios.js: 1234500 milésimos de kg → "1.234,5 kg"."""
    inteiro, frac = divmod(m, 1000)
    numero = f"{inteiro:,}".replace(",", ".")
    if frac:
        numero += "," + f"{frac:03d}".rstrip("0")
    return f"{numero} {unidade}" if unidade else numero


# ---------- respostas: os mesmos campos do js/dados.js ----------

def item_publico(i: sqlite3.Row) -> dict:
    return {
        "codigo": i["codigo"], "nome": i["nome"], "categoria": i["categoria"], "unidade": i["unidade"],
        "quantidade": quantidade_publica(i["quantidade_milesimos"]), "minimo": quantidade_publica(i["minimo_milesimos"]),
        "validade": i["validade"],
    }


def doacao_publica(m: sqlite3.Row) -> dict:
    mov = {
        "codigo": m["codigo"], "tipo": m["tipo"], "data": m["data"], "itemId": m["item_codigo"],
        "quantidade": quantidade_publica(m["quantidade_milesimos"]), "descricao": m["descricao"],
        "pessoa": m["pessoa"], "criadoEm": m["criado_em"],
    }
    # Só manda a chave quando a validade de antes é conhecida: o store.js testa 'validadeAnterior' in mov,
    # e um null "desconhecido" (planilha importada) apagaria a validade do item ao desfazer.
    if m["guardou_validade"] or m["validade_anterior"] is not None:
        mov["validadeAnterior"] = m["validade_anterior"]
    if m["criou_item"]:
        mov["criouItem"] = True
    if m["estorno_de"] is not None:
        mov["estornoDe"] = m["estorno_de"]
    return mov


def dinheiro_publico(m: sqlite3.Row) -> dict:
    mov = {
        "codigo": m["codigo"], "tipo": m["tipo"], "data": m["data"], "valorCentavos": m["valor_centavos"],
        "descricao": m["descricao"], "pessoa": m["pessoa"], "criadoEm": m["criado_em"],
    }
    if m["estorno_de"] is not None:
        mov["estornoDe"] = m["estorno_de"]
    return mov


def _saldo(con: sqlite3.Connection) -> int:
    return con.execute(
        "SELECT COALESCE(SUM(CASE tipo WHEN 'entrada_dinheiro' THEN valor_centavos ELSE -valor_centavos END), 0)"
        " FROM dinheiro").fetchone()[0]


def _item(con: sqlite3.Connection, codigo) -> sqlite3.Row | None:
    if not isinstance(codigo, str) or not codigo:
        return None
    return con.execute("SELECT * FROM itens WHERE codigo = ?", (codigo,)).fetchone()


def _em_transacao(con: sqlite3.Connection, tarefa):
    """Roda a tarefa com o banco travado para gravação. Qualquer erro desfaz tudo (rollback)."""
    con.execute("BEGIN IMMEDIATE")
    try:
        resultado = tarefa()
        con.commit()
        return resultado
    except BaseException:
        con.rollback()
        raise


# ---------- registrar (store.js: registrar, registrarEstoque, registrarDinheiro) ----------

def registrar(con: sqlite3.Connection, perfil: str, entrada: dict) -> dict:
    """Grava uma movimentação. Devolve {"movimento": ..., "item": ... ou None}. Dá Recusa se uma regra não deixar."""
    tipo = entrada.get("tipo")
    if tipo not in TIPOS:
        raise Recusa("Escolha o que aconteceu.", "tipo")
    if not seguranca.pode(perfil, tipo):
        raise Recusa(NEGADO, status=403)

    dia = hoje()
    data = entrada.get("data") or dia
    if not data_valida(data):
        raise Recusa("Informe uma data válida.", "data")
    if data > dia:
        raise Recusa("A data não pode estar no futuro.", "data")

    mov = {
        "codigo": secrets.token_hex(8), "tipo": tipo, "data": data, "criado_em": _agora_utc(),
        "descricao": texto(entrada.get("descricao"), 120), "pessoa": texto(entrada.get("pessoa"), 80),
    }
    if tipo in TIPOS_DE_DOACAO and not mov["pessoa"]:
        mov["pessoa"] = DOADOR_ANONIMO

    if TIPOS[tipo]["area"] == "estoque":
        return _em_transacao(con, lambda: _registrar_estoque(con, entrada, mov, dia))
    return _em_transacao(con, lambda: _registrar_dinheiro(con, entrada, mov))


def _registrar_estoque(con: sqlite3.Connection, entrada: dict, mov: dict, dia: str) -> dict:
    tipo = mov["tipo"]
    quantidade = milesimos(entrada.get("quantidade"))
    if quantidade is None or quantidade <= 0:
        raise Recusa("Informe uma quantidade maior que zero.", "quantidade")
    if quantidade > QUANTIDADE_MAXIMA_MILESIMOS:
        raise Recusa("Essa quantidade parece errada. Confira o número digitado.", "quantidade")

    novo = entrada.get("novoItem")
    if novo:
        if tipo != "doacao_item":
            raise Recusa("Só dá para cadastrar item novo ao registrar uma doação.", "novoItem")
        nome = texto(novo.get("nome"), 60)
        unidade = texto(novo.get("unidade"), 10)
        minimo = milesimos(novo.get("minimo") or "0")  # vazio vale 0, como no store.js
        if not nome:
            raise Recusa("Dê um nome ao item novo.", "novoItem.nome")
        if not unidade:
            raise Recusa("Informe a unidade do item novo (kg, L, un, pct).", "novoItem.unidade")
        if novo.get("categoria") not in CATEGORIAS:
            raise Recusa("Escolha a categoria do item novo.", "novoItem.categoria")
        if minimo is None:
            raise Recusa("Informe o estoque mínimo só com números, como 5 ou 2,5.", "novoItem.minimo")
        if minimo < 0:
            raise Recusa("O estoque mínimo não pode ser negativo.", "novoItem.minimo")
        chave = seguranca.chave_do_nome(nome)
        # Compara com todos os nomes, como o store.js (inclui itens antigos que ficaram sem nome_chave).
        igual = next((n for (n,) in con.execute("SELECT nome FROM itens") if seguranca.chave_do_nome(n) == chave), None)
        if igual:
            raise Recusa(f'"{igual}" já está cadastrado. Escolha-o na lista.', "novoItem.nome")
        item = {"codigo": secrets.token_hex(8), "nome": nome, "categoria": novo.get("categoria"), "unidade": unidade,
                "quantidade_milesimos": 0, "minimo_milesimos": minimo, "validade": None}
    else:
        linha = _item(con, entrada.get("itemId"))
        if linha is None:
            raise Recusa("Escolha um item da lista.", "itemId")
        item = dict(linha)

    validade = None
    if tipo == "doacao_item" and entrada.get("validade"):
        if not data_valida(entrada.get("validade")):
            raise Recusa("Informe uma validade válida.", "validade")
        if entrada["validade"] < dia:
            raise Recusa("Esse lote já está vencido. Confira a validade antes de guardar.", "validade")
        validade = entrada["validade"]

    if tipo == "saida_item" and quantidade > item["quantidade_milesimos"]:
        texto_qtd = texto_da_quantidade(item["quantidade_milesimos"], item["unidade"])
        raise Recusa(f"Só há {texto_qtd} de {item['nome']} em estoque.", "quantidade")

    # Todas as conferências passaram: só agora algo é gravado.
    if novo:
        con.execute(
            "INSERT INTO itens (codigo, nome, nome_chave, categoria, unidade, quantidade_milesimos, minimo_milesimos, validade)"
            " VALUES (?, ?, ?, ?, ?, 0, ?, NULL)",
            (item["codigo"], item["nome"], chave, item["categoria"], item["unidade"], item["minimo_milesimos"]))

    validade_anterior = item["validade"]  # para o Desfazer voltar exatamente ao que era
    if tipo == "doacao_item":
        nova_quantidade = item["quantidade_milesimos"] + quantidade
        # Só a validade mais próxima, como o store.js (a validade por lote fica para a tabela de lotes).
        nova_validade = validade if validade and (not item["validade"] or validade < item["validade"]) else item["validade"]
    else:
        nova_quantidade = item["quantidade_milesimos"] - quantidade
        nova_validade = None if nova_quantidade == 0 else item["validade"]
    con.execute("UPDATE itens SET quantidade_milesimos = ?, validade = ? WHERE codigo = ?",
                (nova_quantidade, nova_validade, item["codigo"]))
    con.execute(
        "INSERT INTO doacoes (codigo, tipo, data, item_codigo, quantidade_milesimos, descricao, pessoa, criado_em,"
        " validade_anterior, guardou_validade, criou_item) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)",
        (mov["codigo"], tipo, mov["data"], item["codigo"], quantidade, mov["descricao"], mov["pessoa"],
         mov["criado_em"], validade_anterior, int(bool(novo))))
    return _resposta_estoque(con, mov["codigo"])


def _registrar_dinheiro(con: sqlite3.Connection, entrada: dict, mov: dict) -> dict:
    tipo = mov["tipo"]
    valor = entrada.get("valorCentavos")
    if isinstance(valor, bool) or not isinstance(valor, int) or not 0 < valor <= CENTAVOS_MAXIMO:
        raise Recusa("Informe um valor em reais maior que zero, como 150,00.", "valorCentavos")
    if not mov["descricao"]:
        raise Recusa("Diga com o que o dinheiro foi gasto." if tipo == "saida_dinheiro" else "Diga de onde veio o dinheiro.",
                     "descricao")
    if tipo == "saida_dinheiro" and valor > _saldo(con):
        raise Recusa("Saldo insuficiente em caixa para essa despesa. Confira o valor ou registre antes a entrada.",
                     "valorCentavos")
    con.execute(
        "INSERT INTO dinheiro (codigo, tipo, data, valor_centavos, descricao, pessoa, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (mov["codigo"], tipo, mov["data"], valor, mov["descricao"], mov["pessoa"], mov["criado_em"]))
    return _resposta_dinheiro(con, mov["codigo"])


def _resposta_estoque(con: sqlite3.Connection, codigo: str) -> dict:
    m = con.execute("SELECT * FROM doacoes WHERE codigo = ?", (codigo,)).fetchone()
    return {"movimento": doacao_publica(m), "item": item_publico(_item(con, m["item_codigo"]))}


def _resposta_dinheiro(con: sqlite3.Connection, codigo: str) -> dict:
    m = con.execute("SELECT * FROM dinheiro WHERE codigo = ?", (codigo,)).fetchone()
    return {"movimento": dinheiro_publico(m), "item": None}


# ---------- desfazer (store.js: estornar, estornarEstoque) ----------

def estornar(con: sqlite3.Connection, perfil: str, codigo: str) -> dict:
    """Desfaz uma movimentação gravando o lançamento contrário. Devolve o contrário e o item."""
    if not seguranca.pode(perfil, "desfazer"):
        raise Recusa(NEGADO, status=403)
    try:
        return _em_transacao(con, lambda: _estornar(con, perfil, codigo))
    except banco.ErroDeIntegridade:
        # O índice único de estorno_de: outro pedido desfez a mesma movimentação no mesmo instante.
        raise Recusa("Essa movimentação já foi desfeita.", status=409) from None


def _estornar(con: sqlite3.Connection, perfil: str, codigo: str) -> dict:
    tabela = "doacoes"
    mov = con.execute("SELECT * FROM doacoes WHERE codigo = ?", (codigo,)).fetchone()
    if mov is None:
        tabela = "dinheiro"
        mov = con.execute("SELECT * FROM dinheiro WHERE codigo = ?", (codigo,)).fetchone()
    if mov is None:
        raise Recusa("Essa movimentação não existe mais.", status=404)
    if not seguranca.pode(perfil, f"ver_{TIPOS[mov['tipo']]['area']}"):
        raise Recusa(NEGADO, status=403)
    if mov["estorno_de"] is not None:
        raise Recusa("Esse lançamento já desfaz outro e não pode ser desfeito.")
    if con.execute(f"SELECT 1 FROM {tabela} WHERE estorno_de = ?", (codigo,)).fetchone():
        raise Recusa("Essa movimentação já foi desfeita.", status=409)

    contrario = {
        "codigo": secrets.token_hex(8), "tipo": TIPOS[mov["tipo"]]["contrario"], "data": hoje(),
        "criado_em": _agora_utc(), "pessoa": mov["pessoa"],
        "descricao": texto(f"Desfeito: {mov['descricao']}" if mov["descricao"] else "Desfeito", 120),
    }
    if tabela == "doacoes":
        validade_antes = _estornar_estoque(con, mov)
        con.execute(
            "INSERT INTO doacoes (codigo, tipo, data, item_codigo, quantidade_milesimos, descricao, pessoa, criado_em,"
            " validade_anterior, guardou_validade, criou_item, estorno_de) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)",
            (contrario["codigo"], contrario["tipo"], contrario["data"], mov["item_codigo"], mov["quantidade_milesimos"],
             contrario["descricao"], contrario["pessoa"], contrario["criado_em"], validade_antes, codigo))
        return _resposta_estoque(con, contrario["codigo"])

    if mov["tipo"] == "entrada_dinheiro" and _saldo(con) < mov["valor_centavos"]:
        raise Recusa("Esse dinheiro já foi usado em despesas; não dá para desfazer.")
    con.execute(
        "INSERT INTO dinheiro (codigo, tipo, data, valor_centavos, descricao, pessoa, criado_em, estorno_de)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (contrario["codigo"], contrario["tipo"], contrario["data"], mov["valor_centavos"], contrario["descricao"],
         contrario["pessoa"], contrario["criado_em"], codigo))
    return _resposta_dinheiro(con, contrario["codigo"])


def _estornar_estoque(con: sqlite3.Connection, mov: sqlite3.Row) -> str | None:
    """Devolve o estoque e a validade do item ao que eram. Devolve a validade de antes do estorno."""
    item = _item(con, mov["item_codigo"])
    if item is None:
        raise Recusa("O item dessa movimentação não existe mais.")
    quantidade, validade = item["quantidade_milesimos"], item["validade"]
    if mov["tipo"] == "doacao_item":
        if quantidade < mov["quantidade_milesimos"]:
            raise Recusa("Parte desses itens já saiu do estoque; não dá para desfazer.")
        quantidade -= mov["quantidade_milesimos"]
    else:
        quantidade += mov["quantidade_milesimos"]

    if mov["guardou_validade"]:
        # Se o item mudou depois desta movimentação, a validade "de antes" já não vale: restaurá-la poderia
        # esconder um lote novo que vence antes. "Depois" = gravado depois (rowid), como a ordem da lista no store.js.
        mexido_depois = con.execute(
            "SELECT 1 FROM doacoes WHERE item_codigo = ? AND rowid > (SELECT rowid FROM doacoes WHERE codigo = ?) LIMIT 1",
            (item["codigo"], mov["codigo"])).fetchone()
        if not mexido_depois:
            validade = mov["validade_anterior"]
        elif mov["tipo"] == "saida_item" and mov["validade_anterior"] and (not validade or mov["validade_anterior"] < validade):
            validade = mov["validade_anterior"]  # os itens devolvidos voltam com a validade deles
        if quantidade == 0:
            validade = None

    con.execute("UPDATE itens SET quantidade_milesimos = ?, validade = ? WHERE codigo = ?",
                (quantidade, validade, item["codigo"]))
    return item["validade"]
