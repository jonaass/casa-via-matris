-- Migração 002: nome repetido é recusado também sem acento, como no store.js (semAcento).
-- O lower() do SQLite só entende A-Z: "Óleo" e "óleo", ou "Feijão" e "Feijao", passavam como itens diferentes.
-- A chave (sem acento, minúsculas, espaços únicos) é calculada em Python por seguranca.chave_do_nome.
ALTER TABLE itens ADD COLUMN nome_chave TEXT;
CREATE UNIQUE INDEX itens_nome_chave_unico ON itens (nome_chave);
