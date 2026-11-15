-- Migração 005: o estoque mínimo pode ser mudado depois do cadastro (1.6.2).
-- Guarda quem fez a última mudança e quando, para a equipe saber de onde veio o número novo.
ALTER TABLE itens ADD COLUMN minimo_mudado_por TEXT; -- o nome da pessoa
ALTER TABLE itens ADD COLUMN minimo_mudado_em TEXT;  -- em UTC, como o criado_em
