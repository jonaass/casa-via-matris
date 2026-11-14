-- Migração 003: desfazer vira lançamento contrário, em vez de apagar (prestação de contas).
-- O lançamento contrário guarda em estorno_de o código do movimento que ele desfaz.
-- O índice único só vale para quem tem estorno_de: o próprio banco recusa desfazer duas vezes a mesma coisa,
-- mesmo com dois pedidos chegando juntos.
ALTER TABLE doacoes ADD COLUMN estorno_de TEXT REFERENCES doacoes (codigo);
ALTER TABLE dinheiro ADD COLUMN estorno_de TEXT REFERENCES dinheiro (codigo);
CREATE UNIQUE INDEX doacoes_estorno_unico ON doacoes (estorno_de) WHERE estorno_de IS NOT NULL;
CREATE UNIQUE INDEX dinheiro_estorno_unico ON dinheiro (estorno_de) WHERE estorno_de IS NOT NULL;

-- 1 = a validade de antes foi anotada ao gravar (mesmo vazia), como o 'validadeAnterior' in mov do store.js.
-- 0 = não se sabe (movimentos que vieram das planilhas): ao desfazer, a validade do item não é mexida.
ALTER TABLE doacoes ADD COLUMN guardou_validade INTEGER NOT NULL DEFAULT 0;
