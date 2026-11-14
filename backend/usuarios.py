"""Contas do servidor, pelo terminal.

Uso, da pasta do projeto:
    python -m backend.usuarios criar "Nome da Pessoa" email@exemplo.com administrador
    python -m backend.usuarios senha email@exemplo.com
    python -m backend.usuarios desativar email@exemplo.com
    python -m backend.usuarios ativar email@exemplo.com

"criar" cadastra uma conta; "senha" dá uma senha nova a uma conta (e desbloqueia), para quando a
pessoa esqueceu a dela. As senhas são pedidas sem aparecer na tela.
Perfis: administrador, financeiro, almoxarifado, voluntario.

Nos dois casos a senha é PROVISÓRIA: entregue-a pessoalmente. No primeiro acesso, o app pede para a
pessoa criar a senha dela e aceitar os Termos de uso; até lá, o servidor não abre sessão para ela.

Com o servidor, as contas existem só aqui: o app confere e-mail e senha no servidor e guarda no
aparelho só uma cópia da conta (sem senha). Por isso, criar contas, trocar senhas esquecidas e
desativar quem saiu da equipe é sempre por estes comandos.
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
            print(f"Conta criada: {seguranca.normalizar_email(email)} ({perfil}). A senha é provisória: "
                  "no primeiro acesso a pessoa cria a dela e aceita os termos.")
        else:
            seguranca.redefinir_senha(con, argumentos[1], senha)
            print(f"Senha trocada: {seguranca.normalizar_email(argumentos[1])}. Ela é provisória: "
                  "no próximo acesso a pessoa cria a dela.")
    except ValueError as e:
        print(e)
        return 1
    finally:
        con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
