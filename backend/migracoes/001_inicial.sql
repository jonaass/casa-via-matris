-- Migração 001: as três coleções do app (iguais às do js/dados.js), contas e sessões.
-- Nunca altere este arquivo depois de rodado: crie um 002_... com a mudança.

-- O estoque. Quantidades em milésimos inteiros (2,5 kg = 2500), pelo mesmo motivo do
-- dinheiro em centavos: número com vírgula flutuante acumula erro (0,1 + 0,2 = 0,30000000000000004).
CREATE TABLE itens (
  codigo               TEXT PRIMARY KEY,
  nome                 TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 60),
  categoria            TEXT NOT NULL CHECK (categoria IN ('Alimentos', 'Higiene', 'Limpeza')),
  unidade              TEXT NOT NULL CHECK (length(unidade) BETWEEN 1 AND 10),
  quantidade_milesimos INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_milesimos >= 0),
  minimo_milesimos     INTEGER NOT NULL DEFAULT 0 CHECK (minimo_milesimos >= 0),
  validade             TEXT -- AAAA-MM-DD, a mais próxima (a tabela de lotes vem depois)
);
-- Nome repetido é recusado sem ligar para maiúsculas, como no store.js.
CREATE UNIQUE INDEX itens_nome_unico ON itens (lower(nome));

-- Doações de itens que chegaram e itens que saíram.
CREATE TABLE doacoes (
  codigo               TEXT PRIMARY KEY,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('doacao_item', 'saida_item')),
  data                 TEXT NOT NULL, -- AAAA-MM-DD
  item_codigo          TEXT NOT NULL REFERENCES itens (codigo),
  quantidade_milesimos INTEGER NOT NULL CHECK (quantidade_milesimos > 0),
  descricao            TEXT NOT NULL DEFAULT '',
  pessoa               TEXT NOT NULL DEFAULT '',
  criado_em            TEXT NOT NULL,
  validade_anterior    TEXT,
  criou_item           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX doacoes_por_data ON doacoes (data);

-- Entradas e despesas. Dinheiro sempre em centavos inteiros.
CREATE TABLE dinheiro (
  codigo         TEXT PRIMARY KEY,
  tipo           TEXT NOT NULL CHECK (tipo IN ('entrada_dinheiro', 'saida_dinheiro')),
  data           TEXT NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos > 0),
  descricao      TEXT NOT NULL,
  pessoa         TEXT NOT NULL DEFAULT '',
  criado_em      TEXT NOT NULL
);
CREATE INDEX dinheiro_por_data ON dinheiro (data);

-- Contas do servidor. Os perfis são os do js/acesso.js.
CREATE TABLE usuarios (
  codigo          TEXT PRIMARY KEY,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE, -- sempre em minúsculas
  perfil          TEXT NOT NULL CHECK (perfil IN ('administrador', 'financeiro', 'almoxarifado', 'voluntario')),
  senha_sal       TEXT NOT NULL,
  senha_iteracoes INTEGER NOT NULL,
  senha_hash      TEXT NOT NULL,
  ativo           INTEGER NOT NULL DEFAULT 1,
  tentativas      INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate   REAL NOT NULL DEFAULT 0, -- segundos desde 1970
  criado_em       TEXT NOT NULL
);

-- Sessões abertas. Guarda só o hash do token: quem copiar o banco não consegue entrar com ele.
CREATE TABLE sessoes (
  token_hash     TEXT PRIMARY KEY,
  usuario_codigo TEXT NOT NULL REFERENCES usuarios (codigo) ON DELETE CASCADE,
  criada_em      REAL NOT NULL,
  expira_em      REAL NOT NULL
);
