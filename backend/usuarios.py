"""Contas do servidor, pelo terminal.

Uso, da pasta do projeto:
    python -m backend.usuarios criar "Nome da Pessoa" email@exemplo.com administrador
    python -m backend.usuarios senha email@exemplo.com
    python -m backend.usuarios desativar email@exemplo.com
    python -m backend.usuarios ativar email@exemplo.com

"criar" cadastra uma conta; "senha" troca a senha de uma conta (e desbloqueia), para quando a
pessoa esqueceu ou recuperou o acesso no aparelho. As senhas são pedidas sem aparecer na tela.
Perfis: administrador, financeiro, almoxarifado, voluntario.

Para o site puxar os dados, a senha do servidor precisa ser a MESMA da conta no aparelho.
Pessoa nova: crie a conta aqui com a mesma senha provisória que o app mostrou no cadastro;
no primeiro acesso, o app troca a senha nos dois lugares.
"""
import getpass
import sys

from . import banco, seguranca


def _pedir_senha() -> str | None:
    senha = getpass.getpass("Senha: ")
    if senha != getpass.getpass("Repita a senha: "):
        print("As duas senhas não são iguais.")
        return None
    return senha


def mudar_ativo(email: str, ativo: bool) -> int:
    """Desativa (fecha as sessões abertas) ou reativa uma conta, sem apagar nada."""
    con = banco.abrir_banco()
    try:
        email = seguranca.normalizar_email(email)
        linha = con.execute("SELECT codigo FROM usuarios WHERE email = ?", (email,)).fetchone()
        if linha is None:
            print("Não existe conta com esse e-mail.")
            return 1
        with con:
            con.execute("UPDATE usuarios SET ativo = ? WHERE codigo = ?", (int(ativo), linha["codigo"]))
            if not ativo:
                con.execute("DELETE FROM sessoes WHERE usuario_codigo = ?", (linha["codigo"],))
        print(f"Conta {'reativada' if ativo else 'desativada'}: {email}.")
        return 0
    finally:
        con.close()


def main(argumentos: list[str]) -> int:
    comando = argumentos[0] if argumentos else ""
    if comando in ("desativar", "ativar") and len(argumentos) == 2:
        return mudar_ativo(argumentos[1], comando == "ativar")
    if not ((comando == "criar" and len(argumentos) == 4) or (comando == "senha" and len(argumentos) == 2)):
        print(__doc__)
        return 1
    senha = _pedir_senha()
    if senha is None:
        return 1
    con = banco.abrir_banco()
    try:
        if comando == "criar":
            _, nome, email, perfil = argumentos
            seguranca.criar_usuario(con, nome, email, perfil, senha)
            print(f"Conta criada: {seguranca.normalizar_email(email)} ({perfil}).")
        else:
            seguranca.redefinir_senha(con, argumentos[1], senha)
            print(f"Senha trocada: {seguranca.normalizar_email(argumentos[1])}.")
    except ValueError as e:
        print(e)
        return 1
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
