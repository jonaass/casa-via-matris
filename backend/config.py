"""Configuração do back-end, lida das variáveis de ambiente (ou do arquivo backend/.env).

Os segredos e caminhos de cada computador ficam fora do Git: o modelo é o .env.example.
"""
import os
from pathlib import Path
from zoneinfo import ZoneInfo

PASTA_BACKEND = Path(__file__).resolve().parent
RAIZ_DO_SITE = PASTA_BACKEND.parent  # onde estão index.html, css/, js/...

# A casa fica no Brasil: "hoje" é o dia de Brasília, não o do servidor (que costuma estar em UTC).
FUSO = ZoneInfo("America/Sao_Paulo")


def _ler_arquivo_env() -> None:
    """Lê backend/.env (formato NOME=valor), sem passar por cima do que já veio do sistema."""
    arquivo = PASTA_BACKEND / ".env"
    if not arquivo.exists():
        return
    for linha in arquivo.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        nome, valor = linha.split("=", 1)
        os.environ.setdefault(nome.strip(), valor.strip())


_ler_arquivo_env()


def caminho_do_banco() -> Path:
    caminho = Path(os.environ.get("VM_BANCO", "backend/dados/casa-via-matris.db"))
    return caminho if caminho.is_absolute() else RAIZ_DO_SITE / caminho


def cookie_seguro(endereco_https: bool) -> bool:
    """O cookie de sessão só viaja por https? "auto" (padrão): sim quando o site foi aberto por https.
    Em http://localhost precisa ser não, senão o Safari não guarda o cookie e o login não fica."""
    valor = os.environ.get("VM_COOKIE_SEGURO", "auto")
    if valor == "auto":
        return endereco_https
    return valor != "0"
