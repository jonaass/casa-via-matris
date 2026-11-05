/*
 * dados.js — Miguel
 *
 * A ÚNICA parte do app que lê e grava no celular. Quem lê e grava por aqui são o store.js
 * e o backup.js. A tela (app.js) só usa aoMudarEmOutraAba, pedirArmazenamentoPersistente e VERSAO.
 *
 * Coleções, uma chave do localStorage para cada (os campos são os do front do Jonas):
 *   dinheiro → entradas e despesas
 *              { codigo, tipo: "entrada_dinheiro" | "saida_dinheiro", data, valorCentavos, descricao, pessoa, criadoEm }
 *   doacoes  → movimentos do estoque: doação que chegou e item que saiu
 *              { codigo, tipo: "doacao_item" | "saida_item", data, itemId, quantidade, descricao, pessoa, criadoEm }
 *   itens    → o estoque (despensa e almoxarifado)
 *              { codigo, nome, categoria, unidade, quantidade, minimo, validade }
 * Mais a chave "config" (ex.: data do último backup).
 *
 * Cada registro tem um "codigo" único (gerado por gerarCodigo, nas Regras).
 * O dados.js não confere os outros campos: isso é trabalho das Regras.
 *
 * Toda função lê do armazenamento na hora (não guarda cópia na memória). Assim,
 * duas abas abertas não apagam o que a outra gravou.
 *
 * Este arquivo também é carregado pelo sw.js, só para ler a VERSAO.
 * Por isso nada aqui fora das funções pode usar window ou localStorage.
 */
(function () {
  'use strict';

  /** Versão do app. Mude a cada publicação: o sw.js usa ela para baixar os arquivos novos. */
  const VERSAO = '1.1.0';

  const COLECOES = ['dinheiro', 'doacoes', 'itens'];
  const PREFIXO = 'via-matris:';
  // Onde o protótipo (store.js) guardava tudo junto. Só é lido, nunca apagado.
  const CHAVE_PROTOTIPO = 'via-matris:dados:v1';

  function armazenamento() {
    try {
      return globalThis.localStorage || null;
    } catch (e) {
      return null; // alguns navegadores dão erro só de olhar o localStorage
    }
  }

  function falha(mensagem) {
    return { ok: false, erros: [mensagem] };
  }

  function conferirColecao(colecao) {
    if (!COLECOES.includes(colecao)) {
      throw new Error(`Coleção desconhecida: "${colecao}". Use ${COLECOES.map((c) => `"${c}"`).join(', ')}.`);
    }
  }

  function lerChave(chave, padrao) {
    const s = armazenamento();
    const bruto = s ? s.getItem(PREFIXO + chave) : null;
    if (bruto == null) return padrao;
    try {
      return JSON.parse(bruto);
    } catch (e) {
      // Guarda o texto estragado à parte, para a próxima gravação não apagar de vez.
      console.warn(`Dados de "${chave}" ilegíveis. Uma cópia ficou em ${PREFIXO}${chave}:corrompido.`, e);
      // Só tira da chave principal se a cópia foi guardada; com o armazenamento cheio, setItem falha.
      try {
        s.setItem(`${PREFIXO}${chave}:corrompido`, bruto);
        s.removeItem(PREFIXO + chave);
      } catch (erro) {
        console.warn('Sem espaço para guardar a cópia; os dados ficaram onde estavam.', erro);
      }
      return padrao;
    }
  }

  // Regra de quem chama: gravação que falhou não mudou nada.
  function gravarChave(chave, valor) {
    const texto = JSON.stringify(valor);
    const s = armazenamento();
    if (!s) return falha('O celular não deixou guardar os dados. Saia da aba anônima ou libere o armazenamento do site.');
    try {
      s.setItem(PREFIXO + chave, texto);
      return { ok: true };
    } catch (e) {
      console.warn('Não foi possível gravar.', e);
      return falha('Não há espaço para guardar mais dados. Baixe as planilhas e peça ajuda a quem cuida do sistema.');
    }
  }

  /*
   * Traz, uma vez só, o que foi lançado no protótipo para as coleções novas.
   * O protótipo guardava { itens, movimentos } numa chave só e usava "id" em vez de "codigo".
   * A chave antiga continua lá, intacta, caso seja preciso conferir.
   */
  function migrarDoPrototipo() {
    const s = armazenamento();
    if (!s || lerChave('config', {}).migradoDoPrototipo) return;
    const jaTemDados = COLECOES.some((c) => s.getItem(PREFIXO + c) != null);
    const bruto = s.getItem(CHAVE_PROTOTIPO);

    let antigo = null;
    try { antigo = bruto && JSON.parse(bruto); } catch (e) { /* ilegível: não há o que migrar */ }
    if (jaTemDados || !antigo || !Array.isArray(antigo.itens) || !Array.isArray(antigo.movimentos)) {
      if (bruto) gravarChave('config', { ...lerChave('config', {}), migradoDoPrototipo: 'nada a migrar' });
      return;
    }

    const comCodigo = (r) => {
      const { id, ...resto } = r;
      return { codigo: String(id), ...resto };
    };
    const ehDinheiro = (m) => m.tipo === 'entrada_dinheiro' || m.tipo === 'saida_dinheiro';
    const ehEstoque = (m) => m.tipo === 'doacao_item' || m.tipo === 'saida_item';
    const valido = (r) => r && r.id != null;

    const colecoes = {
      itens: antigo.itens.filter(valido).map(comCodigo),
      doacoes: antigo.movimentos.filter((m) => valido(m) && ehEstoque(m)).map(comCodigo),
      dinheiro: antigo.movimentos.filter((m) => valido(m) && ehDinheiro(m)).map(comCodigo),
    };
    // Tudo ou nada: se faltar espaço no meio, apaga o que já gravou e tenta de novo na próxima
    // abertura. Sem isso, a coleção gravada faria o app achar que a migração já tinha acontecido.
    const gravadas = [];
    for (const [colecao, lista] of Object.entries(colecoes)) {
      if (!gravarChave(colecao, lista).ok) {
        gravadas.forEach((c) => s.removeItem(PREFIXO + c));
        return;
      }
      gravadas.push(colecao);
    }
    gravarChave('config', { ...lerChave('config', {}), migradoDoPrototipo: new Date().toISOString() });
  }

  function listaDaColecao(colecao) {
    migrarDoPrototipo();
    const lista = lerChave(colecao, []);
    // Ignora o que não for registro com código, em vez de derrubar a tela.
    return Array.isArray(lista) ? lista.filter((r) => r && typeof r.codigo === 'string' && r.codigo) : [];
  }

  /**
   * Todos os registros da coleção ("dinheiro", "doacoes" ou "itens"), como cópias.
   * Mudar o que voltar daqui não muda nada guardado: para isso use salvarRegistro.
   */
  function lerTudo(colecao) {
    conferirColecao(colecao);
    return listaDaColecao(colecao).map((r) => ({ ...r }));
  }

  /**
   * Guarda um registro. Se já existir um com o mesmo "codigo", ele é substituído (edição).
   * Devolve { ok: true, registro } ou { ok: false, erros: [...] }.
   */
  function salvarRegistro(colecao, registro) {
    conferirColecao(colecao);
    if (!registro || typeof registro.codigo !== 'string' || !registro.codigo) {
      return falha('Registro sem código. Gere um com gerarCodigo() antes de salvar.');
    }
    const copia = { ...registro };
    const lista = listaDaColecao(colecao);
    const posicao = lista.findIndex((r) => r.codigo === copia.codigo);
    if (posicao >= 0) lista[posicao] = copia;
    else lista.push(copia);

    const resultado = gravarChave(colecao, lista);
    return resultado.ok ? { ok: true, registro: { ...copia } } : resultado;
  }

  /** Apaga o registro com esse código. Devolve { ok: true } ou { ok: false, erros: [...] }. */
  function removerRegistro(colecao, codigo) {
    conferirColecao(colecao);
    const lista = listaDaColecao(colecao);
    const restantes = lista.filter((r) => r.codigo !== codigo);
    if (restantes.length === lista.length) return falha('Esse registro não existe mais.');
    return gravarChave(colecao, restantes);
  }

  /**
   * Troca a coleção inteira por esta lista, numa gravação só.
   * Para mudanças em lote (restaurar backup, começar do zero): gravar um registro por vez
   * relê e regrava a lista toda a cada linha, e 5.000 linhas levavam 14 segundos.
   * Se a gravação falhar, o que estava guardado continua como estava.
   */
  function substituirColecao(colecao, lista) {
    conferirColecao(colecao);
    if (!Array.isArray(lista) || lista.some((r) => !r || typeof r.codigo !== 'string' || !r.codigo)) {
      return falha('Lista com registro sem código.');
    }
    return gravarChave(colecao, lista);
  }

  /** Configurações do app, como objeto. Ex.: { ultimoBackup: { dinheiro: "2026-10-29" } }. */
  function lerConfig() {
    const config = lerChave('config', {});
    return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  }

  /**
   * Junta as mudanças com a configuração atual e guarda.
   * salvarConfig({ tutorialVisto: true }) não apaga as outras opções.
   */
  function salvarConfig(mudancas) {
    const nova = { ...lerConfig(), ...mudancas };
    const resultado = gravarChave('config', nova);
    return resultado.ok ? { ok: true, config: nova } : resultado;
  }

  /**
   * Avisa quando OUTRA aba aberta gravou dados, para a tela redesenhar em vez de
   * mostrar coisa velha. (O front já fazia isso olhando a chave do store.js.)
   *   aoMudarEmOutraAba((colecao) => atualizarTudo());
   * colecao é "dinheiro", "doacoes", "itens" ou "config". Devolve uma função que para de avisar.
   */
  function aoMudarEmOutraAba(avisar) {
    const ouvir = (e) => {
      if (!e.key || !e.key.startsWith(PREFIXO)) return;
      const chave = e.key.slice(PREFIXO.length);
      if (COLECOES.includes(chave) || chave === 'config') avisar(chave);
    };
    window.addEventListener('storage', ouvir);
    return () => window.removeEventListener('storage', ouvir);
  }

  /**
   * Pede ao navegador para não apagar os dados sozinho quando o celular fica sem espaço.
   * Chame uma vez ao abrir o app. Devolve uma Promise com true (protegido) ou false.
   * Mesmo protegido, desinstalar o app ou limpar os dados do site apaga tudo: o backup continua necessário.
   */
  async function pedirArmazenamentoPersistente() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return false;
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (e) {
      return false;
    }
  }

  // Só estes nomes ficam visíveis para os outros arquivos.
  Object.assign(globalThis, {
    VERSAO, lerTudo, salvarRegistro, removerRegistro, substituirColecao, lerConfig, salvarConfig,
    aoMudarEmOutraAba, pedirArmazenamentoPersistente,
  });
})();
