"""
Gera planilhas de teste para a importação do backup (opcional, roda fora do app).

    python3 ferramentas/gerar_planilha_teste.py

Cria em tests/planilhas/, no mesmo formato que o app baixa:
  via-matris-estoque-teste.csv    os itens do estoque (importe este primeiro)
  via-matris-doacoes-teste.csv    150 doações e saídas desses itens
  via-matris-dinheiro-teste.csv   200 entradas e despesas dos últimos 12 meses
  via-matris-dinheiro-com-erros.csv  linhas boas misturadas com erros, para ver as mensagens
Os nomes são fictícios: nunca use dados reais de pessoas acolhidas.
"""
import csv
import random
from datetime import date, timedelta
from pathlib import Path

PASTA = Path(__file__).resolve().parent.parent / "tests" / "planilhas"
random.seed(42)  # sempre as mesmas planilhas


def dia_aleatorio():
    return (date.today() - timedelta(days=random.randint(0, 365))).strftime("%d/%m/%Y")


def reais(centavos):
    return f"{centavos / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def salvar(nome, cabecalho, linhas):
    # utf-8-sig coloca o BOM que o Excel precisa para ler os acentos
    with open(PASTA / nome, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(cabecalho)
        w.writerows(linhas)


def main():
    PASTA.mkdir(parents=True, exist_ok=True)

    itens = [("arroz", "Arroz", "Alimentos", "kg"), ("leite", "Leite integral", "Alimentos", "L"),
             ("sabonete", "Sabonete", "Higiene", "un"), ("fralda", "Fralda geriátrica G", "Higiene", "pct"),
             ("detergente", "Detergente", "Limpeza", "un")]
    estoque = []
    for codigo, nome, categoria, unidade in itens:
        validade = (date.today() + timedelta(days=random.randint(10, 300))).strftime("%d/%m/%Y") if categoria == "Alimentos" else ""
        estoque.append([codigo, nome, categoria, unidade, random.randint(0, 40), random.choice([5, 10, 20]), validade])
    salvar("via-matris-estoque-teste.csv", ["Código", "Item", "Categoria", "Unidade", "Quantidade em estoque",
                                            "Estoque mínimo", "Validade mais próxima"], estoque)

    doacoes = []
    for i in range(150):
        codigo, nome, _, unidade = random.choice(itens)
        movimento = random.choice(["Doação", "Doação", "Saída"])
        quem = "Doador Teste" if movimento == "Doação" else "Cozinha"
        quantidade = str(random.choice([1, 2, 2.5, 5, 10, 24])).replace(".", ",")
        doacoes.append([f"d{i}", dia_aleatorio(), movimento, codigo, nome, quantidade, unidade, quem, ""])
    salvar("via-matris-doacoes-teste.csv", ["Código", "Data", "Movimento", "Código do item", "Item", "Quantidade",
                                            "Unidade", "Quem doou / para onde foi", "Observação"], doacoes)

    entradas = ["Doação via Pix", "Bazar beneficente", "Contribuição mensal", "Rifa"]
    despesas = ["Conta de luz", "Botijão de gás", "Feira da semana", "Farmácia"]
    dinheiro = []
    for i in range(200):
        movimento = random.choice(["Entrada", "Despesa"])
        descricao = random.choice(entradas if movimento == "Entrada" else despesas)
        dinheiro.append([f"t{i}", dia_aleatorio(), movimento, reais(random.randint(500, 200000)), descricao, "Pessoa Teste"])
    cab_dinheiro = ["Código", "Data", "Movimento", "Valor (R$)", "Descrição", "Quem"]
    salvar("via-matris-dinheiro-teste.csv", cab_dinheiro, dinheiro)

    com_erros = dinheiro[:3] + [
        ["e1", "31/02/2026", "Entrada", "10,00", "Data que não existe", ""],
        ["e2", "05/10/2026", "Doação", "10,00", "Movimento errado", ""],
        ["e3", "05/10/2026", "Despesa", "dez reais", "Valor errado", ""],
        ["e4", "05/10/2026", "Despesa", "10,00", "", "Sem descrição"],
    ]
    salvar("via-matris-dinheiro-com-erros.csv", cab_dinheiro, com_erros)
    print("Planilhas geradas em", PASTA)


if __name__ == "__main__":
    main()
