-- Migração 006: o administrador pode tirar do histórico um movimento desfeito e o contrário dele (1.7.0).
-- Nada é apagado de verdade: as linhas ficam no banco, marcadas, para a prestação de contas.
-- As listas (GET /api/doacoes e /api/dinheiro) não mandam as linhas marcadas.
ALTER TABLE doacoes ADD COLUMN apagado_em TEXT;  -- em UTC, como o criado_em
ALTER TABLE doacoes ADD COLUMN apagado_por TEXT; -- o nome de quem tirou do histórico
ALTER TABLE dinheiro ADD COLUMN apagado_em TEXT;
ALTER TABLE dinheiro ADD COLUMN apagado_por TEXT;
