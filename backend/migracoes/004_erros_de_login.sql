-- Migração 004: o limite de erros de login por IP passa da memória do servidor para o banco.
-- Na Vercel, cada pedido pode cair numa cópia diferente do servidor, com a memória vazia: guardado só na
-- memória, o limite deixava de valer. Cada linha é um erro (ou uma tentativa ainda em andamento) de um IP.
CREATE TABLE erros_de_login (
  ip TEXT NOT NULL,
  em REAL NOT NULL -- segundos desde 1970
);
CREATE INDEX erros_de_login_por_ip ON erros_de_login (ip, em);
