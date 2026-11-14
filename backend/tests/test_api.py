"""Testes da API. Rodar da pasta do projeto: python -m pytest backend/tests"""
import json
import os
import shutil
import sqlite3
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import banco, importar, movimentos, seguranca
from backend.principal import app

RAIZ = Path(__file__).resolve().parents[2]
PLANILHAS = RAIZ / "tests" / "planilhas"
ORIGEM = {"Origin": "http://testserver"}
# Com VM_TESTE_POSTGRES=<endereço de um Postgres vazio>, os testes rodam também no Postgres
# (é o que o GitHub Actions faz). Cada teste apaga e recria as tabelas desse banco.
POSTGRES = os.environ.get("VM_TESTE_POSTGRES", "").strip()
so_sqlite = pytest.mark.skipif(bool(POSTGRES), reason="mexe direto no arquivo do SQLite")
SENHA = "senha-de-teste-123"


@pytest.fixture
def con(tmp_path, monkeypatch):
    monkeypatch.setenv("VM_BANCO", str(tmp_path / "teste.db"))
    monkeypatch.delenv("VM_COOKIE_SEGURO", raising=False)  # padrão "auto": o cliente de teste usa http
    if POSTGRES:
        monkeypatch.setenv("DATABASE_URL", POSTGRES)
        import psycopg
        with psycopg.connect(POSTGRES, autocommit=True) as pg:
            pg.execute("DROP SCHEMA public CASCADE")
            pg.execute("CREATE SCHEMA public")
    else:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    c = banco.abrir_banco()
    # Poucas iterações só para o teste ser rápido; contas de verdade usam 600 mil.
    # Contas prontas para entrar: senha própria (não provisória) e termos aceitos.
    for perfil in seguranca.PERFIS:
        seguranca.criar_usuario(c, perfil.title(), f"{perfil}@teste.com", perfil, SENHA, iteracoes=1000,
                                provisoria=False, aceitou_termos=True)
    importar.importar_arquivos(c, sorted(PLANILHAS.glob("via-matris-*-teste.csv")))
    yield c
    c.close()


@pytest.fixture
def cliente(con):
    return TestClient(app)


def entrar(cliente, perfil, senha=SENHA):
    return cliente.post("/api/entrar", json={"email": f"{perfil}@teste.com", "senha": senha}, headers=ORIGEM)


def test_saude_responde_sem_login(cliente):
    assert cliente.get("/api/saude").json() == {"ok": True, "servico": "casa-via-matris"}


def test_sem_sessao_responde_401(cliente):
    for rota in ("/api/itens", "/api/doacoes", "/api/dinheiro", "/api/eu"):
        r = cliente.get(rota)
        assert r.status_code == 401
        assert "erro" in r.json()


def test_administrador_ve_as_tres_colecoes(cliente):
    assert entrar(cliente, "administrador").status_code == 200
    itens = cliente.get("/api/itens").json()
    assert {"codigo", "nome", "categoria", "unidade", "quantidade", "minimo", "validade"} <= set(itens[0])
    assert cliente.get("/api/doacoes").status_code == 200
    dinheiro = cliente.get("/api/dinheiro").json()
    assert all(isinstance(m["valorCentavos"], int) for m in dinheiro)


def test_financeiro_nao_ve_estoque(cliente):
    entrar(cliente, "financeiro")
    assert cliente.get("/api/itens").status_code == 403
    assert cliente.get("/api/doacoes").status_code == 403
    assert cliente.get("/api/dinheiro").status_code == 200


@pytest.mark.parametrize("perfil", ["almoxarifado", "voluntario"])
def test_estoque_e_voluntario_nao_veem_dinheiro(cliente, perfil):
    entrar(cliente, perfil)
    assert cliente.get("/api/dinheiro").status_code == 403
    assert cliente.get("/api/itens").status_code == 200


def test_senha_errada_e_email_inexistente_dao_a_mesma_resposta(cliente):
    a = entrar(cliente, "administrador", "senha-errada-000")
    b = cliente.post("/api/entrar", json={"email": "ninguem@teste.com", "senha": "x" * 10}, headers=ORIGEM)
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json() == {"erro": seguranca.ERRO_LOGIN}


def test_cinco_erros_bloqueiam_a_conta(cliente):
    for _ in range(seguranca.MAX_ERROS):
        r = entrar(cliente, "voluntario", "senha-errada-000")
    # Para quem está de fora a resposta é a mesma de sempre (não revela que o e-mail existe)...
    assert r.json() == {"erro": seguranca.ERRO_LOGIN}
    assert entrar(cliente, "voluntario").status_code == 401  # nem com a senha certa, até passar o tempo
    # ...mas a conta ficou bloqueada no banco.
    assert con_bloqueado(cliente)


def con_bloqueado(_):
    import time
    c = banco.conectar()
    try:
        return c.execute("SELECT bloqueado_ate FROM usuarios WHERE email = 'voluntario@teste.com'").fetchone()[0] > time.time()
    finally:
        c.close()


def test_login_de_outro_site_e_recusado(cliente):
    r = cliente.post("/api/entrar", json={"email": "administrador@teste.com", "senha": SENHA},
                     headers={"Origin": "https://site-malicioso.example"})
    assert r.status_code == 403
    r = cliente.post("/api/entrar", json={"email": "administrador@teste.com", "senha": SENHA})
    assert r.status_code == 403  # sem Origin também


def test_cookie_de_sessao_protegido_e_banco_guarda_so_o_hash(cliente, con):
    r = entrar(cliente, "administrador")
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    token = cliente.cookies.get("vm_sessao")
    guardados = [l["token_hash"] for l in con.execute("SELECT token_hash FROM sessoes")]
    assert token not in guardados and len(guardados) == 1


def test_cookie_seguro_em_https(con):
    cliente = TestClient(app, base_url="https://testserver")
    r = cliente.post("/api/entrar", json={"email": "administrador@teste.com", "senha": SENHA},
                     headers={"Origin": "https://testserver"})
    assert r.status_code == 200 and "secure" in r.headers["set-cookie"].lower()


def test_cookie_sem_secure_em_http_para_o_safari_guardar(cliente):
    r = entrar(cliente, "administrador")
    assert "secure" not in r.headers["set-cookie"].lower()


def test_sair_encerra_a_sessao(cliente):
    entrar(cliente, "administrador")
    token = cliente.cookies.get("vm_sessao")
    assert cliente.post("/api/sair", headers=ORIGEM).status_code == 200
    cliente.cookies.set("vm_sessao", token)  # mesmo guardando o token, ele não vale mais
    assert cliente.get("/api/eu").status_code == 401


def test_quantidade_fracionada_sem_erro_de_arredondamento(con, cliente):
    con.execute("INSERT INTO itens (codigo, nome, categoria, unidade, quantidade_milesimos) VALUES ('x', 'Feijão X', 'Alimentos', 'kg', 2500)")
    con.commit()
    entrar(cliente, "almoxarifado")
    item = next(i for i in cliente.get("/api/itens").json() if i["codigo"] == "x")
    assert item["quantidade"] == 2.5


def test_site_e_entregue_mas_nao_os_arquivos_internos(cliente):
    r = cliente.get("/")
    assert r.status_code == 200 and "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert cliente.get("/js/servidor.js").status_code == 200
    for proibido in ("/backend/principal.py", "/.git/config", "/backend/dados/casa-via-matris.db", "/CLAUDE.md"):
        assert cliente.get(proibido).status_code == 404


def test_api_nao_fica_em_cache(cliente):
    assert cliente.get("/api/saude").headers["cache-control"] == "no-store"


def test_rota_inexistente_responde_404_no_formato_de_erro(cliente):
    r = cliente.get("/api/nao-existe")
    assert r.status_code == 404 and "erro" in r.json()


def test_trocar_senha_confere_a_atual_e_fecha_outras_sessoes(cliente):
    entrar(cliente, "voluntario")
    outro = TestClient(app)
    entrar(outro, "voluntario")
    r = cliente.post("/api/trocar-senha", json={"senhaAtual": "errada-00000", "novaSenha": "nova-senha-456"}, headers=ORIGEM)
    assert r.status_code == 400 and r.json()["campo"] == "senhaAtual"
    r = cliente.post("/api/trocar-senha", json={"senhaAtual": SENHA, "novaSenha": "curta"}, headers=ORIGEM)
    assert r.status_code == 400 and r.json()["campo"] == "novaSenha"
    r = cliente.post("/api/trocar-senha", json={"senhaAtual": SENHA, "novaSenha": "nova-senha-456"}, headers=ORIGEM)
    assert r.status_code == 200
    assert cliente.get("/api/eu").status_code == 200  # quem trocou continua dentro
    assert outro.get("/api/eu").status_code == 401  # a outra sessão foi fechada
    assert entrar(TestClient(app), "voluntario", "nova-senha-456").status_code == 200


def test_trocar_senha_sem_sessao_ou_de_outro_site(cliente):
    corpo = {"senhaAtual": SENHA, "novaSenha": "nova-senha-456"}
    assert cliente.post("/api/trocar-senha", json=corpo, headers=ORIGEM).status_code == 401
    entrar(cliente, "voluntario")
    assert cliente.post("/api/trocar-senha", json=corpo, headers={"Origin": "https://outro.example"}).status_code == 403


def test_comando_cria_conta_e_redefine_senha(con, monkeypatch, capsys):
    from backend import usuarios
    senhas = iter(["senha-cli-1234", "senha-cli-1234", "outra-cli-5678", "outra-cli-5678"])
    monkeypatch.setattr(usuarios.getpass, "getpass", lambda _: next(senhas))
    assert usuarios.main(["criar", "Pessoa CLI", "CLI@Teste.com", "financeiro"]) == 0
    assert usuarios.main(["senha", "cli@teste.com"]) == 0
    usuario, erro = seguranca.validar_login(con, "cli@teste.com", "outra-cli-5678")
    assert erro is None and usuario["perfil"] == "financeiro"
    # As duas senhas do comando são provisórias, e a conta nova ainda não aceitou os termos.
    assert usuario["provisoria"] == 1 and usuario["termos_versao"] is None
    assert usuarios.main(["criar", "x"]) == 1  # uso errado mostra a ajuda


def test_endereco_inexistente_responde_no_formato_de_erro(cliente):
    r = cliente.get("/nao-existe.html")
    assert r.status_code == 404 and r.json() == {"erro": "Não encontrado."}


# ---------- importação das planilhas ----------

def test_importar_duas_vezes_nao_duplica(con):
    resultados = importar.importar_arquivos(con, sorted(PLANILHAS.glob("via-matris-*-teste.csv")))
    assert all(r["importados"] == 0 for r in resultados)


def test_planilha_com_erros_aponta_a_linha(con):
    texto = (PLANILHAS / "via-matris-dinheiro-com-erros.csv").read_text(encoding="utf-8-sig")
    r = importar.importar_texto(con, texto)
    assert r["erros"] and all(e.startswith("Linha ") for e in r["erros"])


def test_valor_em_reais_vira_centavos_sem_float():
    assert importar._numero_br("1.890,53", 2) == 189053
    assert importar._numero_br("1.000", 2) == 100000  # "1.000" é mil, não um
    assert importar._numero_br("0,1", 2) == 10


def test_data_impossivel_e_recusada():
    with pytest.raises(importar.LinhaRuim):
        importar._data("31/02/2026")


# ---------- espelho do js/acesso.js ----------

@pytest.mark.skipif(shutil.which("node") is None, reason="precisa do Node.js")
def test_perfis_iguais_ao_acesso_js():
    script = (
        "globalThis.lerConfig=()=>({});globalThis.salvarConfig=()=>({ok:true});"
        f"require({json.dumps(str(RAIZ / 'js' / 'acesso.js'))});"
        "const p={};for(const [k,v] of Object.entries(PERFIS))p[k]=v.pode;console.log(JSON.stringify(p));"
    )
    saida = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout
    no_js = {k: sorted(v) for k, v in json.loads(saida).items()}
    assert no_js == {k: sorted(v) for k, v in seguranca.PERFIS.items()}


def test_head_na_pagina_inicial_para_monitoramento(cliente):
    r = cliente.head("/")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")


# ---------- achados da revisão (versão 1.4.0) ----------

def test_senhas_erradas_em_paralelo_bloqueiam_a_conta(con):
    from concurrent.futures import ThreadPoolExecutor

    def errar(_):
        c = banco.conectar()
        try:
            return seguranca.validar_login(c, "voluntario@teste.com", "senha-errada-000")
        finally:
            c.close()

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(errar, range(15)))
    assert con_bloqueado(None)


def test_migracao_simultanea_nao_falha(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    caminho = tmp_path / "novo.db"

    def abrir(_):
        c = banco.abrir_banco(caminho)
        c.close()
        return True

    with ThreadPoolExecutor(8) as ex:
        assert all(ex.map(abrir, range(16)))


def test_conta_bloqueada_e_email_inexistente_dao_a_mesma_resposta(cliente):
    for _ in range(seguranca.MAX_ERROS + 1):
        a = entrar(cliente, "voluntario", "senha-errada-000")
    b = cliente.post("/api/entrar", json={"email": "ninguem@teste.com", "senha": "x" * 10}, headers=ORIGEM)
    assert a.json() == b.json()


def test_conta_desativada_nao_revela_senha_certa(cliente, con):
    with con:
        con.execute("UPDATE usuarios SET ativo = 0 WHERE email = 'voluntario@teste.com'")
    certa, errada = entrar(cliente, "voluntario"), entrar(cliente, "voluntario", "senha-errada-000")
    assert certa.status_code == errada.status_code == 401
    assert certa.json() == errada.json()


def test_limite_por_ip_responde_429_e_nao_guarda_ip_sem_erro(cliente):
    from backend import principal
    assert entrar(cliente, "administrador").status_code == 200
    c = banco.conectar()
    assert c.execute("SELECT count(*) FROM erros_de_login").fetchone()[0] == 0  # login certo não fica guardado
    c.close()
    for i in range(principal.LIMITE_POR_IP):
        cliente.post("/api/entrar", json={"email": f"x{i}@teste.com", "senha": "x" * 10}, headers=ORIGEM)
    assert entrar(cliente, "administrador").status_code == 429


def test_nome_repetido_sem_acento_e_recusado(con):
    texto = "Código;Item;Categoria;Unidade;Quantidade em estoque;Estoque mínimo\nzz1;Feijão  Carioca;Alimentos;kg;1;0\nzz2;feijao carioca;Alimentos;kg;1;0\n"
    r = importar.importar_texto(con, texto)
    assert r["importados"] == 1 and len(r["erros"]) == 1
    with pytest.raises(Exception):
        with con:
            con.execute("INSERT INTO itens (codigo, nome, nome_chave, categoria, unidade) VALUES ('zz3', 'FEIJÃO carioca', ?, 'Alimentos', 'kg')",
                        (seguranca.chave_do_nome("FEIJÃO carioca"),))


def test_movimento_sem_validade_anterior_nao_manda_a_chave(cliente):
    entrar(cliente, "administrador")
    assert all("validadeAnterior" not in m or m["validadeAnterior"] for m in cliente.get("/api/doacoes").json())


def test_docs_desligado_por_padrao(cliente):
    for rota in ("/docs", "/redoc", "/openapi.json"):
        assert cliente.get(rota).status_code == 404


def test_origin_com_esquema_errado_ou_host_forjado_e_recusado(cliente):
    corpo = {"email": "administrador@teste.com", "senha": SENHA}
    assert cliente.post("/api/entrar", json=corpo, headers={"Origin": "https://testserver"}).status_code == 403
    r = cliente.post("/api/entrar", json=corpo, headers={"Origin": "http://evil.example", "Host": "evil.example"})
    assert r.status_code == 200  # sem VM_ORIGENS vale o próprio endereço...


def test_lista_de_origens_do_env(cliente, monkeypatch):
    monkeypatch.setenv("VM_ORIGENS", "https://casa.example")
    corpo = {"email": "administrador@teste.com", "senha": SENHA}
    r = cliente.post("/api/entrar", json=corpo, headers={"Origin": "http://evil.example", "Host": "evil.example"})
    assert r.status_code == 403  # ...e com a lista, só ela
    assert cliente.post("/api/entrar", json=corpo, headers={"Origin": "https://casa.example"}).status_code == 200


@pytest.mark.parametrize("caminho", ["/js/%2e%2e/CLAUDE.md", "/css/../CLAUDE.md", "/tests/", "/README.md",
                                     "/backend/.env.example", "/MIGUEL.md", "/js/"])
def test_caminhos_internos_nao_saem(cliente, caminho):
    assert cliente.get(caminho).status_code == 404


def test_data_em_formato_de_semana_e_recusada():
    with pytest.raises(importar.LinhaRuim):
        importar._data("2026W011")


def test_erro_aponta_a_linha_certa_com_linhas_em_branco(con):
    texto = "Código;Data;Movimento;Valor (R$);Descrição;Quem\n\n\nq1;01/01/2026;Entrada;abc;Teste;\n"
    assert importar.importar_texto(con, texto)["erros"][0].startswith("Linha 4:")


def test_doacao_acha_item_pelo_nome_quando_o_codigo_nao_existe(con):
    nome = con.execute("SELECT nome FROM itens LIMIT 1").fetchone()[0]
    texto = f"Código;Data;Movimento;Código do item;Item;Quantidade\nn1;01/01/2026;Doação;nao-existe;{nome.upper()};1\n"
    assert importar.importar_texto(con, texto)["importados"] == 1


def test_rota_existente_com_metodo_errado_responde_405(cliente):
    assert cliente.post("/api/itens", headers=ORIGEM).status_code == 405


def test_erro_interno_responde_no_formato_de_erro(con, monkeypatch):
    from backend import principal
    monkeypatch.setattr(principal, "saude", None)
    def quebrar(*_a, **_k):
        raise RuntimeError("falha de teste")
    monkeypatch.setattr(seguranca, "usuario_da_sessao", quebrar)
    r = TestClient(app, raise_server_exceptions=False).get("/api/eu", cookies={"vm_sessao": "x"})
    assert r.status_code == 500 and "erro" in r.json()


def test_manter_conectado_dura_30_dias(cliente):
    r = cliente.post("/api/entrar", json={"email": "administrador@teste.com", "senha": SENHA, "manter": True}, headers=ORIGEM)
    assert f"Max-Age={seguranca.SESSAO_LONGA_S}" in r.headers["set-cookie"]
    assert f"Max-Age={seguranca.SESSAO_S}" in entrar(cliente, "financeiro").headers["set-cookie"]


# ---------- gravar pela API: registrar e desfazer (versão 1.5.0) ----------

def gravar(cliente, **corpo):
    return cliente.post("/api/movimentos", json=corpo, headers=ORIGEM)


def desfazer(cliente, codigo):
    return cliente.post(f"/api/movimentos/{codigo}/estorno", headers=ORIGEM)


def item_novo(cliente, nome="Lentilha Teste", quantidade=5, validade=None, **extra):
    """Doação que cadastra um item novo. Devolve a resposta inteira (movimento e item)."""
    r = gravar(cliente, tipo="doacao_item", quantidade=quantidade, validade=validade,
               novoItem={"nome": nome, "categoria": "Alimentos", "unidade": "kg", "minimo": 1}, **extra)
    assert r.status_code == 200, r.json()
    return r.json()


def saldo(con):
    return con.execute("SELECT COALESCE(SUM(CASE tipo WHEN 'entrada_dinheiro' THEN valor_centavos"
                       " ELSE -valor_centavos END), 0) FROM dinheiro").fetchone()[0]


def caixa_com(con, centavos=1_000_000):
    """As planilhas de teste deixam o saldo negativo. Isto põe uma entrada para o caixa ficar com este valor."""
    falta = centavos - saldo(con)
    if falta > 0:
        with con:
            con.execute("INSERT INTO dinheiro (codigo, tipo, data, valor_centavos, descricao, criado_em)"
                        " VALUES ('acerto', 'entrada_dinheiro', '2026-01-01', ?, 'Acerto', '2026-01-01T00:00:00Z')", (falta,))


def test_doacao_com_item_novo_e_saida_gravam_com_os_campos_do_app(cliente):
    entrar(cliente, "almoxarifado")
    r = item_novo(cliente, quantidade="2,5")
    mov, item = r["movimento"], r["item"]
    assert mov["pessoa"] == "Doador anônimo"  # doação sem nome, como no store.js
    assert mov["criouItem"] is True and mov["validadeAnterior"] is None and mov["data"] == movimentos.hoje()
    assert item["quantidade"] == 2.5 and item["minimo"] == 1
    # A resposta tem os mesmos campos da lista (GET), para o site usar sem converter.
    assert mov in cliente.get("/api/doacoes").json()
    assert item in cliente.get("/api/itens").json()
    r = gravar(cliente, tipo="saida_item", itemId=item["codigo"], quantidade=2.5, pessoa="Cozinha")
    assert r.status_code == 200 and r.json()["item"]["quantidade"] == 0


def test_quantidade_e_dinheiro_sem_erro_de_arredondamento(cliente, con):
    entrar(cliente, "administrador")
    codigo = item_novo(cliente, quantidade=0.1)["item"]["codigo"]
    gravar(cliente, tipo="doacao_item", itemId=codigo, quantidade=0.2)
    gravar(cliente, tipo="doacao_item", itemId=codigo, quantidade="0,001")
    assert con.execute("SELECT quantidade_milesimos FROM itens WHERE codigo = ?", (codigo,)).fetchone()[0] == 301
    antes = saldo(con)
    assert gravar(cliente, tipo="entrada_dinheiro", valorCentavos=10, descricao="Moedas").status_code == 200
    assert saldo(con) == antes + 10


def test_saida_acima_do_estoque_e_recusada(cliente, con):
    entrar(cliente, "almoxarifado")
    codigo = item_novo(cliente, quantidade=3)["item"]["codigo"]
    r = gravar(cliente, tipo="saida_item", itemId=codigo, quantidade=3.5)
    assert r.status_code == 422
    assert r.json() == {"erro": "Só há 3 kg de Lentilha Teste em estoque.", "campo": "quantidade"}
    assert con.execute("SELECT quantidade_milesimos FROM itens WHERE codigo = ?", (codigo,)).fetchone()[0] == 3000


def test_despesa_acima_do_saldo_e_recusada(cliente, con):
    entrar(cliente, "financeiro")
    caixa_com(con, 10000)  # R$ 100,00 em caixa
    antes = saldo(con)
    assert antes == 10000
    r = gravar(cliente, tipo="saida_dinheiro", valorCentavos=antes + 1, descricao="Gás")
    assert r.status_code == 422 and r.json()["campo"] == "valorCentavos"
    assert r.json()["erro"].startswith("Saldo insuficiente")
    assert gravar(cliente, tipo="saida_dinheiro", valorCentavos=antes, descricao="Gás").status_code == 200
    assert saldo(con) == 0


@pytest.mark.parametrize("corpo, erro, campo", [
    ({"tipo": "pagamento"}, "Escolha o que aconteceu.", "tipo"),
    ({"tipo": "doacao_item", "data": "2026-02-31", "itemId": "arroz", "quantidade": 1}, "Informe uma data válida.", "data"),
    ({"tipo": "doacao_item", "data": "31/12/2026", "itemId": "arroz", "quantidade": 1}, "Informe uma data válida.", "data"),
    ({"tipo": "doacao_item", "data": "2999-01-01", "itemId": "arroz", "quantidade": 1}, "A data não pode estar no futuro.", "data"),
    ({"tipo": "doacao_item", "itemId": "arroz", "quantidade": 0}, "Informe uma quantidade maior que zero.", "quantidade"),
    ({"tipo": "doacao_item", "itemId": "arroz", "quantidade": -1}, "Informe uma quantidade maior que zero.", "quantidade"),
    ({"tipo": "doacao_item", "itemId": "arroz", "quantidade": "abc"}, "Informe uma quantidade maior que zero.", "quantidade"),
    ({"tipo": "doacao_item", "itemId": "arroz", "quantidade": "1,2345"}, "Informe uma quantidade maior que zero.", "quantidade"),
    ({"tipo": "doacao_item", "itemId": "arroz", "quantidade": True}, "Informe uma quantidade maior que zero.", "quantidade"),
    ({"tipo": "doacao_item", "itemId": "arroz", "quantidade": 1_000_000_001},
     "Essa quantidade parece errada. Confira o número digitado.", "quantidade"),
    ({"tipo": "doacao_item", "itemId": "nao-existe", "quantidade": 1}, "Escolha um item da lista.", "itemId"),
    ({"tipo": "saida_item", "quantidade": 1, "novoItem": {"nome": "X", "categoria": "Alimentos", "unidade": "kg"}},
     "Só dá para cadastrar item novo ao registrar uma doação.", "novoItem"),
    ({"tipo": "doacao_item", "quantidade": 1, "novoItem": {"nome": " ", "categoria": "Alimentos", "unidade": "kg"}},
     "Dê um nome ao item novo.", "novoItem.nome"),
    ({"tipo": "doacao_item", "quantidade": 1, "novoItem": {"nome": "X", "categoria": "Alimentos", "unidade": ""}},
     "Informe a unidade do item novo (kg, L, un, pct).", "novoItem.unidade"),
    ({"tipo": "doacao_item", "quantidade": 1, "novoItem": {"nome": "X", "categoria": "Roupas", "unidade": "kg"}},
     "Escolha a categoria do item novo.", "novoItem.categoria"),
    ({"tipo": "doacao_item", "quantidade": 1, "novoItem": {"nome": "X", "categoria": "Alimentos", "unidade": "kg", "minimo": "x"}},
     "Informe o estoque mínimo só com números, como 5 ou 2,5.", "novoItem.minimo"),
    ({"tipo": "doacao_item", "quantidade": 1, "novoItem": {"nome": "X", "categoria": "Alimentos", "unidade": "kg", "minimo": -2}},
     "O estoque mínimo não pode ser negativo.", "novoItem.minimo"),
    ({"tipo": "doacao_item", "quantidade": 1, "novoItem": {"nome": "  LEITE   íntegral ", "categoria": "Alimentos", "unidade": "L"}},
     '"Leite integral" já está cadastrado. Escolha-o na lista.', "novoItem.nome"),
    ({"tipo": "doacao_item", "itemId": "arroz", "quantidade": 1, "validade": "2026-13-01"}, "Informe uma validade válida.", "validade"),
    ({"tipo": "doacao_item", "itemId": "arroz", "quantidade": 1, "validade": "2020-01-01"},
     "Esse lote já está vencido. Confira a validade antes de guardar.", "validade"),
    ({"tipo": "entrada_dinheiro", "valorCentavos": 0, "descricao": "x"}, "Informe um valor em reais maior que zero, como 150,00.", "valorCentavos"),
    ({"tipo": "entrada_dinheiro", "valorCentavos": 10.5, "descricao": "x"}, "Informe um valor em reais maior que zero, como 150,00.", "valorCentavos"),
    ({"tipo": "entrada_dinheiro", "valorCentavos": "150,00", "descricao": "x"}, "Informe um valor em reais maior que zero, como 150,00.", "valorCentavos"),
    ({"tipo": "entrada_dinheiro", "valorCentavos": 2**53, "descricao": "x"}, "Informe um valor em reais maior que zero, como 150,00.", "valorCentavos"),
    ({"tipo": "entrada_dinheiro", "valorCentavos": 100, "descricao": "  "}, "Diga de onde veio o dinheiro.", "descricao"),
    ({"tipo": "saida_dinheiro", "valorCentavos": 100}, "Diga com o que o dinheiro foi gasto.", "descricao"),
])
def test_regras_do_store_js_com_as_mesmas_mensagens(cliente, con, corpo, erro, campo):
    entrar(cliente, "administrador")
    antes = [con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("itens", "doacoes", "dinheiro")]
    r = gravar(cliente, **corpo)
    assert r.status_code == 422 and r.json() == {"erro": erro, "campo": campo}
    # Recusado = nada gravado em lugar nenhum (nem o item novo).
    assert antes == [con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("itens", "doacoes", "dinheiro")]


def test_textos_sao_cortados_e_validade_mais_proxima_fica_no_item(cliente):
    entrar(cliente, "almoxarifado")
    perto, longe = (date.today() + timedelta(days=30)).isoformat(), (date.today() + timedelta(days=90)).isoformat()
    r = item_novo(cliente, validade=longe, descricao="  muito   " + "x" * 200, pessoa="p" * 100)
    assert len(r["movimento"]["descricao"]) == 120 and r["movimento"]["descricao"].startswith("muito xx")
    assert len(r["movimento"]["pessoa"]) == 80 and r["item"]["validade"] == longe
    codigo = r["item"]["codigo"]
    assert gravar(cliente, tipo="doacao_item", itemId=codigo, quantidade=1, validade=perto).json()["item"]["validade"] == perto
    assert gravar(cliente, tipo="doacao_item", itemId=codigo, quantidade=1, validade=longe).json()["item"]["validade"] == perto
    # A saída de tudo apaga a validade, como no store.js; a validade numa saída é ignorada.
    r = gravar(cliente, tipo="saida_item", itemId=codigo, quantidade=7, validade="2020-01-01")
    assert r.status_code == 200 and r.json()["item"]["validade"] is None


TIPOS_E_PERMISSOES = ["doacao_item", "saida_item", "entrada_dinheiro", "saida_dinheiro"]


@pytest.mark.parametrize("perfil", list(seguranca.PERFIS))
@pytest.mark.parametrize("tipo", TIPOS_E_PERMISSOES)
def test_cada_perfil_grava_so_o_que_pode(cliente, con, perfil, tipo):
    caixa_com(con)
    entrar(cliente, perfil)
    corpo = ({"itemId": "leite", "quantidade": 1} if tipo.endswith("item")
             else {"valorCentavos": 100, "descricao": "Teste"})
    r = gravar(cliente, tipo=tipo, **corpo)
    if seguranca.pode(perfil, tipo):
        assert r.status_code == 200, r.json()
    else:
        assert r.status_code == 403 and r.json() == {"erro": "Seu perfil não pode fazer isso."}


def test_gravar_sem_sessao_ou_de_outro_site_e_recusado(cliente):
    corpo = {"tipo": "doacao_item", "itemId": "leite", "quantidade": 1}
    assert cliente.post("/api/movimentos", json=corpo, headers=ORIGEM).status_code == 401
    entrar(cliente, "administrador")
    assert cliente.post("/api/movimentos", json=corpo, headers={"Origin": "https://outro.example"}).status_code == 403
    assert cliente.post("/api/movimentos", json=corpo).status_code == 403  # sem Origin
    assert desfazer(cliente, "qualquer").status_code == 404  # com sessão e Origin, chega à regra
    assert cliente.post("/api/movimentos/qualquer/estorno").status_code == 403


def test_desfazer_grava_o_contrario_e_volta_estoque_e_saldo(cliente, con):
    caixa_com(con)
    entrar(cliente, "administrador")
    entrada = gravar(cliente, tipo="entrada_dinheiro", valorCentavos=5000, descricao="Bazar").json()["movimento"]
    antes = saldo(con)
    r = desfazer(cliente, entrada["codigo"])
    assert r.status_code == 200
    contrario = r.json()["movimento"]
    assert contrario["tipo"] == "saida_dinheiro" and contrario["estornoDe"] == entrada["codigo"]
    assert contrario["valorCentavos"] == 5000 and contrario["descricao"] == "Desfeito: Bazar" and r.json()["item"] is None
    assert saldo(con) == antes - 5000
    # Nada foi apagado: o original e o contrário aparecem na lista, e só o contrário tem estornoDe.
    lista = {m["codigo"]: m for m in cliente.get("/api/dinheiro").json()}
    assert "estornoDe" not in lista[entrada["codigo"]] and lista[contrario["codigo"]] == contrario

    codigo = item_novo(cliente, quantidade=4)["item"]["codigo"]
    saida = gravar(cliente, tipo="saida_item", itemId=codigo, quantidade=1.5).json()["movimento"]
    r = desfazer(cliente, saida["codigo"])
    assert r.json()["movimento"]["tipo"] == "doacao_item" and r.json()["item"]["quantidade"] == 4


def test_desfazer_duas_vezes_e_desfazer_o_contrario_sao_recusados(cliente, con):
    caixa_com(con)
    entrar(cliente, "administrador")
    mov = gravar(cliente, tipo="entrada_dinheiro", valorCentavos=700, descricao="Pix").json()["movimento"]
    contrario = desfazer(cliente, mov["codigo"]).json()["movimento"]
    r = desfazer(cliente, mov["codigo"])
    assert r.status_code == 409 and r.json() == {"erro": "Essa movimentação já foi desfeita."}
    r = desfazer(cliente, contrario["codigo"])
    assert r.status_code == 422 and r.json() == {"erro": "Esse lançamento já desfaz outro e não pode ser desfeito."}
    assert desfazer(cliente, "nao-existe").json() == {"erro": "Essa movimentação não existe mais."}
    # E o próprio banco recusa um segundo contrário, mesmo que o código deixe passar.
    with pytest.raises(banco.ErroDeIntegridade):
        with con:
            con.execute("INSERT INTO dinheiro (codigo, tipo, data, valor_centavos, descricao, criado_em, estorno_de)"
                        " VALUES ('z', 'saida_dinheiro', '2026-01-01', 700, 'x', 'x', ?)", (mov["codigo"],))


def test_desfazer_que_quebraria_estoque_ou_saldo_e_recusado(cliente, con):
    entrar(cliente, "administrador")
    r = item_novo(cliente, quantidade=5)
    gravar(cliente, tipo="saida_item", itemId=r["item"]["codigo"], quantidade=1)
    falha = desfazer(cliente, r["movimento"]["codigo"])
    assert falha.status_code == 422
    assert falha.json()["erro"] == "Parte desses itens já saiu do estoque; não dá para desfazer."

    caixa_com(con, 1)
    entrada = gravar(cliente, tipo="entrada_dinheiro", valorCentavos=1000, descricao="Rifa").json()["movimento"]
    assert gravar(cliente, tipo="saida_dinheiro", valorCentavos=saldo(con), descricao="Mercado").status_code == 200
    falha = desfazer(cliente, entrada["codigo"])
    assert falha.status_code == 422 and falha.json()["erro"] == "Esse dinheiro já foi usado em despesas; não dá para desfazer."
    assert con.execute("SELECT COUNT(*) FROM dinheiro WHERE estorno_de IS NOT NULL").fetchone()[0] == 0


def test_item_criado_por_doacao_desfeita_fica_com_quantidade_zero(cliente, con):
    entrar(cliente, "almoxarifado")
    r = item_novo(cliente, quantidade=2, validade=(date.today() + timedelta(days=10)).isoformat())
    assert desfazer(cliente, r["movimento"]["codigo"]).status_code == 200
    item = next(i for i in cliente.get("/api/itens").json() if i["codigo"] == r["item"]["codigo"])
    assert item["quantidade"] == 0 and item["validade"] is None


@pytest.mark.parametrize("perfil, area, status", [
    ("voluntario", "estoque", 403),     # sem "desfazer"
    ("financeiro", "estoque", 403),     # tem "desfazer", mas não vê o estoque
    ("almoxarifado", "financeiro", 403),
    ("almoxarifado", "estoque", 200),
    ("financeiro", "financeiro", 200),
    ("administrador", "estoque", 200),
])
def test_desfazer_pede_desfazer_e_ver_a_area(cliente, con, perfil, area, status):
    caixa_com(con)
    entrar(cliente, "administrador")
    if area == "estoque":
        codigo = gravar(cliente, tipo="doacao_item", itemId="leite", quantidade=1).json()["movimento"]["codigo"]
    else:
        codigo = gravar(cliente, tipo="entrada_dinheiro", valorCentavos=100, descricao="x").json()["movimento"]["codigo"]
    outro = TestClient(app)
    entrar(outro, perfil)
    r = desfazer(outro, codigo)
    assert r.status_code == status, r.json()


def test_desfazer_com_validade_anotada_volta_a_validade_de_antes(cliente, con):
    """guardou_validade = 1 (gravado pela API): desfazer volta a validade de antes, como o store.js."""
    entrar(cliente, "almoxarifado")
    perto = (date.today() + timedelta(days=5)).isoformat()
    leite = con.execute("SELECT validade FROM itens WHERE codigo = 'leite'").fetchone()[0]
    mov = gravar(cliente, tipo="doacao_item", itemId="leite", quantidade=1, validade=perto).json()
    assert mov["item"]["validade"] == perto and mov["movimento"]["validadeAnterior"] == leite
    assert con.execute("SELECT guardou_validade FROM doacoes WHERE codigo = ?", (mov["movimento"]["codigo"],)).fetchone()[0] == 1
    assert desfazer(cliente, mov["movimento"]["codigo"]).json()["item"]["validade"] == leite


def test_desfazer_com_validade_anotada_mas_item_mexido_depois_nao_esconde_lote_novo(cliente, con):
    entrar(cliente, "almoxarifado")
    d5, d3 = ((date.today() + timedelta(days=n)).isoformat() for n in (5, 3))
    primeira = gravar(cliente, tipo="doacao_item", itemId="leite", quantidade=1, validade=d5).json()["movimento"]
    gravar(cliente, tipo="doacao_item", itemId="leite", quantidade=1, validade=d3)
    assert desfazer(cliente, primeira["codigo"]).json()["item"]["validade"] == d3


def test_desfazer_sem_validade_anotada_nao_mexe_na_validade(cliente, con):
    """guardou_validade = 0 (veio da planilha): a validade de antes é desconhecida e o item fica como está."""
    entrar(cliente, "almoxarifado")
    d0 = con.execute("SELECT * FROM doacoes WHERE codigo = 'd0'").fetchone()  # importada: Detergente
    assert d0["guardou_validade"] == 0 and d0["validade_anterior"] is None
    assert "validadeAnterior" not in next(m for m in cliente.get("/api/doacoes").json() if m["codigo"] == "d0")
    with con:
        con.execute("UPDATE itens SET validade = '2030-01-01', quantidade_milesimos = quantidade_milesimos + 5000"
                    " WHERE codigo = 'detergente'")
    r = desfazer(cliente, "d0")
    assert r.status_code == 200 and r.json()["item"]["validade"] == "2030-01-01"


def test_ultimo_item_tirado_ao_mesmo_tempo_so_um_consegue(con):
    """Concorrência de verdade: 8 conexões ao banco, em 8 threads, tentam tirar juntas as 3 últimas unidades."""
    with con:
        con.execute("INSERT INTO itens (codigo, nome, nome_chave, categoria, unidade, quantidade_milesimos)"
                    " VALUES ('ultimo', 'Último', 'ultimo', 'Limpeza', 'un', 3000)")
    largada = threading.Barrier(8)

    def tirar(_):
        c = banco.conectar()
        try:
            largada.wait()  # todas começam no mesmo instante
            movimentos.registrar(c, "almoxarifado", {"tipo": "saida_item", "itemId": "ultimo", "quantidade": 1})
            return "ok"
        except movimentos.Recusa as e:
            return e.erro
        finally:
            c.close()

    with ThreadPoolExecutor(8) as ex:
        resultados = list(ex.map(tirar, range(8)))
    assert resultados.count("ok") == 3
    assert all(r == "ok" or r.startswith("Só há 0 un") for r in resultados)
    assert con.execute("SELECT quantidade_milesimos FROM itens WHERE codigo = 'ultimo'").fetchone()[0] == 0
    assert con.execute("SELECT COUNT(*) FROM doacoes WHERE item_codigo = 'ultimo'").fetchone()[0] == 3


def test_a_ultima_unidade_com_duas_pessoas_ao_mesmo_tempo(con):
    with con:
        con.execute("INSERT INTO itens (codigo, nome, nome_chave, categoria, unidade, quantidade_milesimos)"
                    " VALUES ('so-um', 'Só um', 'so um', 'Limpeza', 'un', 1000)")
    largada = threading.Barrier(2)

    def tirar(_):
        c = banco.conectar()
        try:
            largada.wait()
            movimentos.registrar(c, "voluntario", {"tipo": "saida_item", "itemId": "so-um", "quantidade": 1})
            return True
        except movimentos.Recusa:
            return False
        finally:
            c.close()

    with ThreadPoolExecutor(2) as ex:
        assert sorted(ex.map(tirar, range(2))) == [False, True]  # exatamente uma pessoa consegue


def test_desfazer_ao_mesmo_tempo_so_um_contrario(con):
    caixa_com(con)
    with con:
        con.execute("INSERT INTO dinheiro (codigo, tipo, data, valor_centavos, descricao, criado_em)"
                    " VALUES ('pix', 'entrada_dinheiro', '2026-01-01', 100, 'Pix', '2026-01-01T00:00:00Z')")
    largada = threading.Barrier(4)

    def tentar(_):
        c = banco.conectar()
        try:
            largada.wait()
            movimentos.estornar(c, "financeiro", "pix")
            return 200
        except movimentos.Recusa as e:
            return e.status
        finally:
            c.close()

    with ThreadPoolExecutor(4) as ex:
        assert sorted(ex.map(tentar, range(4))) == [200, 409, 409, 409]


def test_migracao_003_em_banco_que_ja_tem_contas_e_movimentos(tmp_path):
    """Banco parado na versão 2, com conta e movimentos: a 003 entra sem perder nada."""
    c = banco.conectar(tmp_path / "antigo.db")
    for arquivo in sorted(banco.PASTA_MIGRACOES.glob("00[12]_*.sql")):
        for comando in banco._comandos(arquivo.read_text(encoding="utf-8")):
            c.execute(comando)
    c.execute("PRAGMA user_version = 2")
    c.execute("INSERT INTO itens (codigo, nome, nome_chave, categoria, unidade, quantidade_milesimos)"
              " VALUES ('a', 'Arroz', 'arroz', 'Alimentos', 'kg', 5000)")
    c.execute("INSERT INTO doacoes (codigo, tipo, data, item_codigo, quantidade_milesimos, criado_em)"
              " VALUES ('m1', 'doacao_item', '2026-01-01', 'a', 5000, '2026-01-01T00:00:00Z')")
    c.execute("INSERT INTO dinheiro (codigo, tipo, data, valor_centavos, descricao, criado_em)"
              " VALUES ('m2', 'entrada_dinheiro', '2026-01-01', 900, 'Pix', '2026-01-01T00:00:00Z')")
    g = seguranca.nova_senha_guardada(SENHA, 1000)
    c.execute("INSERT INTO usuarios (codigo, nome, email, perfil, senha_sal, senha_iteracoes, senha_hash, criado_em)"
              " VALUES ('u1', 'Antiga', 'antiga@teste.com', 'administrador', ?, ?, ?, '2026-01-01')",
              (g["sal"], g["iteracoes"], g["hash"]))
    c.commit()

    assert banco.migrar(c) >= 3
    m1 = c.execute("SELECT * FROM doacoes WHERE codigo = 'm1'").fetchone()
    assert m1["estorno_de"] is None and m1["guardou_validade"] == 0 and m1["quantidade_milesimos"] == 5000
    antiga = c.execute("SELECT * FROM usuarios WHERE codigo = 'u1'").fetchone()
    # A conta antiga não é provisória, mas ainda não aceitou os termos: aceita na próxima entrada.
    assert antiga["provisoria"] == 0 and antiga["termos_versao"] is None and antiga["termos_em"] is None
    assert seguranca.pendencia(antiga) == ("termos", seguranca.ERRO_FALTAM_TERMOS)
    # E o que entrou funciona: desfazer o movimento antigo grava o contrário.
    movimentos.estornar(c, "administrador", "m2")
    assert c.execute("SELECT estorno_de FROM dinheiro WHERE estorno_de IS NOT NULL").fetchone()[0] == "m2"
    c.close()


# ---------- senha provisória e aceite dos termos no servidor (1.5.0) ----------

def nova_conta(con, email="nova@teste.com", provisoria=True, aceitou_termos=False, perfil="almoxarifado"):
    seguranca.criar_usuario(con, "Nova", email, perfil, SENHA, iteracoes=1000,
                            provisoria=provisoria, aceitou_termos=aceitou_termos)
    return email


def entrar_email(cliente, email, senha=SENHA):
    return cliente.post("/api/entrar", json={"email": email, "senha": senha}, headers=ORIGEM)


def definir(cliente, email, atual=SENHA, nova="senha-da-pessoa-1", aceitou=True):
    return cliente.post("/api/definir-senha", headers=ORIGEM,
                        json={"email": email, "senhaAtual": atual, "novaSenha": nova, "aceitouTermos": aceitou})


def aceitar(cliente, email, senha=SENHA, aceito=True):
    return cliente.post("/api/aceitar-termos", json={"email": email, "senha": senha, "aceito": aceito}, headers=ORIGEM)


def test_termos_versao_igual_ao_acesso_js():
    if shutil.which("node") is None:
        pytest.skip("precisa do Node.js")
    script = (
        "globalThis.lerConfig=()=>({});globalThis.salvarConfig=()=>({ok:true});"
        f"require({json.dumps(str(RAIZ / 'js' / 'acesso.js'))});console.log(TERMOS_VERSAO);"
    )
    saida = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout.strip()
    assert saida == seguranca.TERMOS_VERSAO


def test_conta_nova_e_provisoria_e_sem_termos_por_padrao(con):
    nova_conta(con, provisoria=True)
    seguranca.criar_usuario(con, "Padrão", "padrao@teste.com", "voluntario", SENHA, iteracoes=1000)
    linha = con.execute("SELECT provisoria, termos_versao FROM usuarios WHERE email = 'padrao@teste.com'").fetchone()
    assert tuple(linha) == (1, None)


def test_login_com_senha_provisoria_e_recusado_sem_cookie(cliente, con):
    email = nova_conta(con)
    r = entrar_email(cliente, email)
    assert r.status_code == 403
    assert r.json() == {"erro": seguranca.ERRO_PROVISORIA, "campo": "senhaProvisoria"}
    assert "set-cookie" not in r.headers and cliente.cookies.get("vm_sessao") is None
    assert cliente.get("/api/eu").status_code == 401


def test_provisoria_so_aparece_com_a_senha_certa(cliente, con):
    email = nova_conta(con)
    r = entrar_email(cliente, email, "senha-errada-000")
    assert r.status_code == 401 and r.json() == {"erro": seguranca.ERRO_LOGIN}


@pytest.mark.parametrize("versao", [None, "2020-01-01"])
def test_login_sem_termos_ou_com_versao_antiga_e_recusado(cliente, con, versao):
    email = nova_conta(con, provisoria=False)
    with con:
        con.execute("UPDATE usuarios SET termos_versao = ? WHERE email = ?", (versao, email))
    r = entrar_email(cliente, email)
    assert r.status_code == 403 and r.json() == {"erro": seguranca.ERRO_FALTAM_TERMOS, "campo": "termos"}
    assert "set-cookie" not in r.headers


def test_sessao_aberta_deixa_de_valer_sem_os_termos(cliente, con):
    """Como o contaAtual() do acesso.js: termos novos derrubam a sessão, e a pessoa aceita ao entrar de novo."""
    entrar(cliente, "voluntario")
    assert cliente.get("/api/eu").status_code == 200
    with con:
        con.execute("UPDATE usuarios SET termos_versao = '2020-01-01' WHERE email = 'voluntario@teste.com'")
    assert cliente.get("/api/eu").status_code == 401
    with con:
        con.execute("UPDATE usuarios SET termos_versao = ?, provisoria = 1 WHERE email = 'voluntario@teste.com'",
                    (seguranca.TERMOS_VERSAO,))
    assert cliente.get("/api/itens").status_code == 401  # provisória também não vale como sessão


def test_definir_senha_no_primeiro_acesso(cliente, con):
    email = nova_conta(con)
    r = definir(cliente, email)
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert "set-cookie" not in r.headers  # não abre sessão: o site entra depois, normalmente
    linha = con.execute("SELECT * FROM usuarios WHERE email = ?", (email,)).fetchone()
    assert linha["provisoria"] == 0 and linha["termos_versao"] == seguranca.TERMOS_VERSAO
    assert linha["termos_em"].endswith("+00:00")  # hora em UTC
    assert entrar_email(cliente, email).status_code == 401  # a provisória não vale mais
    r = entrar_email(cliente, email, "senha-da-pessoa-1")
    assert r.status_code == 200 and r.json()["termosVersao"] == seguranca.TERMOS_VERSAO
    assert cliente.get("/api/eu").json()["termosEm"] == linha["termos_em"]


@pytest.mark.parametrize("corpo, status, campo", [
    ({"atual": "senha-errada-000"}, 401, "senhaAtual"),
    ({"nova": "curta"}, 400, "novaSenha"),
    ({"nova": SENHA}, 400, "novaSenha"),
    ({"aceitou": False}, 400, "aceitouTermos"),
])
def test_definir_senha_recusada_nao_muda_nada(cliente, con, corpo, status, campo):
    email = nova_conta(con)
    antes = dict(con.execute("SELECT * FROM usuarios WHERE email = ?", (email,)).fetchone())
    r = definir(cliente, email, **corpo)
    assert r.status_code == status and r.json()["campo"] == campo
    depois = dict(con.execute("SELECT * FROM usuarios WHERE email = ?", (email,)).fetchone())
    for chave in ("senha_hash", "provisoria", "termos_versao"):
        assert antes[chave] == depois[chave]


def test_definir_senha_so_para_conta_provisoria(cliente, con):
    r = definir(cliente, "voluntario@teste.com")
    assert r.status_code == 409 and "já tem senha própria" in r.json()["erro"]
    assert entrar(cliente, "voluntario").status_code == 200  # a senha não mudou


def test_definir_senha_com_termos_ja_aceitos_nao_pede_de_novo(cliente, con):
    email = nova_conta(con, provisoria=True, aceitou_termos=True)  # "senha" do comando numa conta antiga
    assert definir(cliente, email, aceitou=False).status_code == 200
    assert entrar_email(cliente, email, "senha-da-pessoa-1").status_code == 200


def test_definir_senha_fecha_sessoes_antigas(con):
    email = nova_conta(con)
    codigo = con.execute("SELECT codigo FROM usuarios WHERE email = ?", (email,)).fetchone()[0]
    seguranca.abrir_sessao(con, codigo)
    seguranca.definir_senha(con, email, SENHA, "senha-da-pessoa-1", True, iteracoes=1000)
    assert con.execute("SELECT COUNT(*) FROM sessoes WHERE usuario_codigo = ?", (codigo,)).fetchone()[0] == 0


def test_aceitar_termos_e_entrar(cliente, con):
    email = nova_conta(con, provisoria=False)
    assert entrar_email(cliente, email).json()["campo"] == "termos"
    r = aceitar(cliente, email)
    assert r.status_code == 200 and "set-cookie" not in r.headers
    assert entrar_email(cliente, email).status_code == 200


def test_aceitar_termos_recusado(cliente, con):
    email = nova_conta(con, provisoria=False)
    r = aceitar(cliente, email, aceito=False)
    assert r.status_code == 400 and r.json() == {"erro": seguranca.ERRO_TERMOS, "campo": "aceito"}
    r = aceitar(cliente, email, senha="senha-errada-000")
    assert r.status_code == 401 and r.json() == {"erro": seguranca.ERRO_LOGIN, "campo": "senha"}
    provisoria = nova_conta(con, email="prov@teste.com")
    r = aceitar(cliente, provisoria)
    assert r.status_code == 409 and r.json()["campo"] == "senhaProvisoria"
    assert entrar_email(cliente, email).json()["campo"] == "termos"  # nada foi aceito


def test_definir_senha_e_aceitar_termos_pedem_o_proprio_site(cliente, con):
    email = nova_conta(con)
    corpo = {"email": email, "senhaAtual": SENHA, "novaSenha": "senha-da-pessoa-1", "aceitouTermos": True}
    assert cliente.post("/api/definir-senha", json=corpo, headers={"Origin": "https://outro.example"}).status_code == 403
    assert cliente.post("/api/aceitar-termos", json={"email": email, "senha": SENHA, "aceito": True}).status_code == 403


def test_definir_senha_conta_para_o_bloqueio_e_o_limite_por_ip(cliente, con):
    from backend import principal
    email = nova_conta(con)
    for _ in range(seguranca.MAX_ERROS):
        definir(cliente, email, atual="senha-errada-000")
    assert definir(cliente, email).status_code == 401  # bloqueada, nem com a senha certa
    for i in range(principal.LIMITE_POR_IP):
        aceitar(cliente, f"x{i}@teste.com", senha="x" * 10)
    assert aceitar(cliente, "voluntario@teste.com").status_code == 429
    assert entrar(cliente, "voluntario").status_code == 429  # o limite é o mesmo do login


def test_comando_senha_deixa_a_conta_provisoria(con, monkeypatch):
    from backend import usuarios
    senhas = iter(["senha-nova-cli-1", "senha-nova-cli-1"])
    monkeypatch.setattr(usuarios.getpass, "getpass", lambda _: next(senhas))
    assert usuarios.main(["senha", "voluntario@teste.com"]) == 0
    linha = con.execute("SELECT provisoria, termos_versao FROM usuarios WHERE email = 'voluntario@teste.com'").fetchone()
    assert linha["provisoria"] == 1 and linha["termos_versao"] == seguranca.TERMOS_VERSAO
    r = entrar_email(TestClient(app), "voluntario@teste.com", "senha-nova-cli-1")
    assert r.status_code == 403 and r.json()["campo"] == "senhaProvisoria"


@so_sqlite
def test_migracao_003_conta_antiga_aceita_os_termos_e_entra(tmp_path, monkeypatch):
    """Banco da versão 2 com uma conta: depois da 003, a pessoa só entra depois de aceitar os termos."""
    caminho = tmp_path / "antigo.db"
    c = banco.conectar(caminho)
    for arquivo in sorted(banco.PASTA_MIGRACOES.glob("00[12]_*.sql")):
        for comando in banco._comandos(arquivo.read_text(encoding="utf-8")):
            c.execute(comando)
    c.execute("PRAGMA user_version = 2")
    g = seguranca.nova_senha_guardada(SENHA, 1000)
    c.execute("INSERT INTO usuarios (codigo, nome, email, perfil, senha_sal, senha_iteracoes, senha_hash, criado_em)"
              " VALUES ('u1', 'Antiga', 'antiga@teste.com', 'financeiro', ?, ?, ?, '2026-01-01')",
              (g["sal"], g["iteracoes"], g["hash"]))
    c.commit()
    c.close()
    monkeypatch.setenv("VM_BANCO", str(caminho))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with TestClient(app) as cliente:  # "with": o servidor liga e roda as migrações, como de verdade
        assert entrar_email(cliente, "antiga@teste.com").json()["campo"] == "termos"
        assert aceitar(cliente, "antiga@teste.com").status_code == 200
        assert entrar_email(cliente, "antiga@teste.com").status_code == 200
        assert cliente.get("/api/dinheiro").status_code == 200


def test_traducao_do_sql_para_o_postgres():
    assert banco.traduzir("SELECT * FROM itens WHERE codigo = ? ORDER BY nome COLLATE NOCASE") == \
        "SELECT * FROM itens WHERE codigo = %s ORDER BY lower(nome)"
    assert banco.traduzir("SELECT '50%' WHERE a = ?") == "SELECT '50%%' WHERE a = %s"
    script = (banco.PASTA_MIGRACOES / "001_inicial.sql").read_text(encoding="utf-8")
    comandos = banco._sql_da_migracao(script, postgres=True)
    doacoes = next(c for c in comandos if c.startswith("CREATE TABLE doacoes"))
    assert "rowid BIGSERIAL" in doacoes and "INTEGER" not in doacoes
    usuarios = next(c for c in comandos if c.startswith("CREATE TABLE usuarios"))
    assert "bloqueado_ate   DOUBLE PRECISION" in usuarios
    assert banco._sql_da_migracao(script, postgres=False) == banco._comandos(script)
