"""Testes da API. Rodar da pasta do projeto: python -m pytest backend/tests"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import banco, importar, seguranca
from backend.principal import _erros_por_ip, app

RAIZ = Path(__file__).resolve().parents[2]
PLANILHAS = RAIZ / "tests" / "planilhas"
ORIGEM = {"Origin": "http://testserver"}
SENHA = "senha-de-teste-123"


@pytest.fixture
def con(tmp_path, monkeypatch):
    monkeypatch.setenv("VM_BANCO", str(tmp_path / "teste.db"))
    monkeypatch.delenv("VM_COOKIE_SEGURO", raising=False)  # padrão "auto": o cliente de teste usa http
    _erros_por_ip.clear()
    c = banco.abrir_banco()
    # Poucas iterações só para o teste ser rápido; contas de verdade usam 600 mil.
    for perfil in seguranca.PERFIS:
        seguranca.criar_usuario(c, perfil.title(), f"{perfil}@teste.com", perfil, SENHA, iteracoes=1000)
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
    assert "bloqueada" in r.json()["erro"]
    assert entrar(cliente, "voluntario").status_code == 401  # nem com a senha certa, até passar o tempo


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
