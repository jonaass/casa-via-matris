/*
 * Regras de negócio do app: validar, somar saldo, baixar estoque.
 *
 * Quem lê e grava no aparelho é o dados.js; este arquivo decide o que pode ser gravado.
 * A tela (app.js) só chama registrar(), estornar() e resumo() e desenha o resultado.
 * Precisa, carregados antes: utilitarios.js e dados.js.
 *
 * Nada fica guardado na memória: toda função lê do dados.js na hora. Assim duas abas
 * abertas não sobrescrevem o que a outra gravou.
 */
(function (raiz) {
  'use strict';

  const DIAS_ALERTA_VALIDADE = 15;
  const QUANTIDADE_MAXIMA = 1000000000; // acima disso é erro de digitação

  const TIPOS = {
    doacao_item: { rotulo: 'Doação de itens', area: 'estoque', sinal: 1 },
    saida_item: { rotulo: 'Saída de itens', area: 'estoque', sinal: -1 },
    entrada_dinheiro: { rotulo: 'Entrada de dinheiro', area: 'financeiro', sinal: 1 },
    saida_dinheiro: { rotulo: 'Despesa', area: 'financeiro', sinal: -1 },
  };
  const CATEGORIAS = ['Alimentos', 'Higiene', 'Limpeza'];
  const PREFIXO_EXEMPLO = 'ex-'; // código dos lançamentos de exemplo, para reconhecê-los depois

  // ---------- utilitários ----------

  function gerarCodigo() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Quantidades podem ser fracionadas (2,5 kg); arredondar evita 0.30000000000000004.
  function arred(n) {
    return Math.round(n * 1000) / 1000;
  }

  // Corta espaços e limita o tamanho de textos livres vindos do formulário.
  function texto(valor, max) {
    return String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  }

  /*
   * Número no formato brasileiro: "2,5" = dois e meio, "1.000" = mil, "1.234,56".
   * Number("1.000") daria 1, e Number("0x10") daria 16; por isso a regex.
   * Uma regra só para dinheiro e quantidade, para as duas nunca divergirem.
   */
  function numeroDeTexto(valor, casasDecimais) {
    let s = String(valor ?? '').replace(/R\$|\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    if (!new RegExp(`^\\d+(\\.\\d{1,${casasDecimais}})?$`).test(s)) return NaN;
    return Number(s);
  }

  // Dinheiro é guardado em centavos inteiros: 0,1 + 0,2 em ponto flutuante dá
  // 0,30000000000000004, e em contabilidade esse erro se acumula.
  function textoParaCentavos(valor) {
    const centavos = Math.round(numeroDeTexto(valor, 2) * 100);
    return Number.isSafeInteger(centavos) ? centavos : NaN;
  }

  function centavosParaTexto(centavos) {
    return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function quantidadeDeTexto(valor) {
    return typeof valor === 'number' ? valor : numeroDeTexto(valor, 3);
  }

  // Só vale data que existe no calendário: textoParaData recusa 31/02.
  function dataValida(data) {
    return textoParaData(data) === data;
  }

  function falha(erro) {
    return { ok: false, erro };
  }

  // ---------- leitura ----------

  // Um valor faltando viraria NaN no saldo e desligaria a checagem de saldo insuficiente.
  // Por isso registros estragados são ignorados aqui, e não só na hora de gravar.
  function itensValidos() {
    return lerTudo('itens').filter((i) => typeof i.nome === 'string' &&
      Number.isFinite(i.quantidade) && Number.isFinite(i.minimo));
  }

  function movimentosDeEstoque() {
    return lerTudo('doacoes').filter((m) => TIPOS[m.tipo]?.area === 'estoque' &&
      typeof m.data === 'string' && Number.isFinite(m.quantidade) && m.quantidade > 0);
  }

  function movimentosDeDinheiro() {
    return lerTudo('dinheiro').filter((m) => TIPOS[m.tipo]?.area === 'financeiro' &&
      typeof m.data === 'string' && Number.isSafeInteger(m.valorCentavos) && m.valorCentavos > 0);
  }

  function saldoCentavos() {
    return movimentosDeDinheiro().reduce((total, m) => total + TIPOS[m.tipo].sinal * m.valorCentavos, 0);
  }

  // ---------- dados de exemplo ----------

  function dadosDeExemplo() {
    const hoje = new Date();
    const dia = (n) => {
      const d = new Date(hoje);
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const item = (codigo, nome, categoria, unidade, quantidade, minimo, validade = null) =>
      ({ codigo, nome, categoria, unidade, quantidade, minimo, validade });
    let n = 0;
    const mov = (data, tipo, extra) =>
      ({ codigo: `${PREFIXO_EXEMPLO}${++n}`, data, tipo, criadoEm: new Date(data + 'T00:00:00').toISOString(), descricao: '', pessoa: '', ...extra });

    return {
      itens: [
        item('arroz', 'Arroz', 'Alimentos', 'kg', 42, 20, dia(160)),
        item('feijao', 'Feijão carioca', 'Alimentos', 'kg', 9, 15, dia(120)),
        item('leite', 'Leite integral', 'Alimentos', 'L', 18, 24, dia(9)),
        item('oleo', 'Óleo de soja', 'Alimentos', 'L', 11, 6, dia(200)),
        item('macarrao', 'Macarrão', 'Alimentos', 'kg', 14, 8, dia(240)),
        item('cafe', 'Café', 'Alimentos', 'kg', 2, 3, dia(12)),
        item('acucar', 'Açúcar', 'Alimentos', 'kg', 16, 8, dia(300)),
        item('fralda', 'Fralda geriátrica G', 'Higiene', 'pct', 4, 10),
        item('sabonete', 'Sabonete', 'Higiene', 'un', 36, 20),
        item('papel', 'Papel higiênico', 'Higiene', 'pct', 12, 8),
        item('detergente', 'Detergente', 'Limpeza', 'un', 0, 6),
        item('sanitaria', 'Água sanitária', 'Limpeza', 'L', 7, 5),
      ],
      doacoes: [
        mov(dia(-10), 'saida_item', { itemId: 'detergente', quantidade: 4, descricao: 'Limpeza geral', pessoa: 'Limpeza' }),
        mov(dia(-8), 'doacao_item', { itemId: 'sabonete', quantidade: 24, pessoa: 'Grupo de voluntários' }),
        mov(dia(-4), 'saida_item', { itemId: 'fralda', quantidade: 6, descricao: 'Reposição semanal', pessoa: 'Ala feminina' }),
        mov(dia(-3), 'doacao_item', { itemId: 'arroz', quantidade: 25, pessoa: 'Supermercado Bom Preço' }),
        mov(dia(-1), 'doacao_item', { itemId: 'leite', quantidade: 12, pessoa: 'Paróquia São José' }),
        mov(dia(0), 'saida_item', { itemId: 'arroz', quantidade: 3, descricao: 'Almoço', pessoa: 'Cozinha' }),
      ],
      dinheiro: [
        mov(dia(-14), 'entrada_dinheiro', { valorCentavos: 175000, descricao: 'Contribuição mensal', pessoa: 'Associação de amigos' }),
        mov(dia(-12), 'saida_dinheiro', { valorCentavos: 115010, descricao: 'Verduras e carnes da semana', pessoa: 'Feira do bairro' }),
        mov(dia(-7), 'entrada_dinheiro', { valorCentavos: 120000, descricao: 'Bazar beneficente', pessoa: 'Bazar da casa' }),
        mov(dia(-6), 'saida_dinheiro', { valorCentavos: 64000, descricao: 'Conta de luz', pessoa: 'Concessionária de energia' }),
        mov(dia(-2), 'saida_dinheiro', { valorCentavos: 18990, descricao: 'Botijão de gás', pessoa: 'Gás Central' }),
        mov(dia(-1), 'entrada_dinheiro', { valorCentavos: 50000, descricao: 'Doação via Pix', pessoa: 'Doador anônimo' }),
      ],
    };
  }

  // Grava as três coleções de uma vez. Devolve a primeira mensagem de erro, ou null.
  function gravarColecoes(dados) {
    for (const colecao of ['itens', 'doacoes', 'dinheiro']) {
      const r = substituirColecao(colecao, dados[colecao]);
      if (!r.ok) return r.erros[0];
    }
    return null;
  }

  // ---------- store ----------

  function criarStore() {
    // Primeira abertura neste aparelho: mostra exemplos para a tela não abrir vazia.
    // Depois disso nunca mais, senão apagar tudo faria os exemplos voltarem.
    if (!lerConfig().iniciado) {
      if (!itensValidos().length && !movimentosDeEstoque().length && !movimentosDeDinheiro().length) {
        gravarColecoes(dadosDeExemplo());
      }
      salvarConfig({ iniciado: true });
    }

    function acharItem(codigo) {
      return itensValidos().find((i) => i.codigo === codigo);
    }

    function registrarEstoque(entrada, mov, hoje) {
      const quantidade = arred(quantidadeDeTexto(entrada.quantidade));
      if (!Number.isFinite(quantidade) || quantidade <= 0) return falha('Informe uma quantidade maior que zero.');
      if (quantidade > QUANTIDADE_MAXIMA) return falha('Essa quantidade parece errada. Confira o número digitado.');

      let item;
      let novoItem = false;
      if (entrada.novoItem) {
        if (entrada.tipo !== 'doacao_item') return falha('Só dá para cadastrar item novo ao registrar uma doação.');
        const nome = texto(entrada.novoItem.nome, 60);
        const unidade = texto(entrada.novoItem.unidade, 10);
        const minimo = arred(quantidadeDeTexto(entrada.novoItem.minimo || '0'));
        if (!nome) return falha('Dê um nome ao item novo.');
        if (!unidade) return falha('Informe a unidade do item novo (kg, L, un, pct).');
        if (!CATEGORIAS.includes(entrada.novoItem.categoria)) return falha('Escolha a categoria do item novo.');
        if (!Number.isFinite(minimo) || minimo < 0) return falha('O estoque mínimo não pode ser negativo.');
        const igual = itensValidos().find((i) => i.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'));
        if (igual) return falha(`"${igual.nome}" já está cadastrado. Escolha-o na lista.`);
        item = { codigo: gerarCodigo(), nome, categoria: entrada.novoItem.categoria, unidade, quantidade: 0, minimo, validade: null };
        novoItem = true;
      } else {
        item = acharItem(entrada.itemId);
        if (!item) return falha('Escolha um item da lista.');
      }

      let validade = null;
      if (entrada.tipo === 'doacao_item' && entrada.validade) {
        if (!dataValida(entrada.validade)) return falha('Informe uma validade válida.');
        if (entrada.validade < hoje) return falha('Esse lote já está vencido. Confira a validade antes de guardar.');
        validade = entrada.validade;
      }

      if (entrada.tipo === 'saida_item' && quantidade > item.quantidade) {
        return falha(`Só há ${textoDaQuantidade(item.quantidade, item.unidade)} de ${item.nome} em estoque.`);
      }

      // Todas as validações passaram: só agora algo é gravado.
      // Guarda a validade de antes para o Desfazer voltar exatamente ao que era.
      mov.validadeAnterior = item.validade;
      if (novoItem) mov.criouItem = true;
      mov.itemId = item.codigo;
      mov.quantidade = quantidade;

      const salvoMov = salvarRegistro('doacoes', mov);
      if (!salvoMov.ok) return falha(salvoMov.erros[0]);

      if (entrada.tipo === 'doacao_item') {
        item.quantidade = arred(item.quantidade + quantidade);
        // shortcut: guarda só a validade mais próxima do item, não por lote; controle por lote fica para o back-end.
        if (validade && (!item.validade || validade < item.validade)) item.validade = validade;
      } else {
        item.quantidade = arred(item.quantidade - quantidade);
        if (item.quantidade === 0) item.validade = null;
      }
      const salvoItem = salvarRegistro('itens', item);
      if (!salvoItem.ok) {
        // São duas gravações: se a segunda falhar, desfaz a primeira para o estoque não ficar errado.
        removerRegistro('doacoes', mov.codigo);
        return falha(salvoItem.erros[0]);
      }
      return { ok: true, movimento: mov };
    }

    function registrarDinheiro(entrada, mov) {
      const valor = textoParaCentavos(entrada.valor);
      if (!Number.isFinite(valor) || valor <= 0) return falha('Informe um valor em reais maior que zero, como 150,00.');
      if (!mov.descricao) return falha(entrada.tipo === 'saida_dinheiro' ? 'Diga com o que o dinheiro foi gasto.' : 'Diga de onde veio o dinheiro.');
      if (entrada.tipo === 'saida_dinheiro' && valor > saldoCentavos()) {
        return falha('Saldo insuficiente em caixa para essa despesa. Confira o valor ou registre antes a entrada.');
      }
      mov.valorCentavos = valor;
      const salvo = salvarRegistro('dinheiro', mov);
      return salvo.ok ? { ok: true, movimento: mov } : falha(salvo.erros[0]);
    }

    function registrar(entrada) {
      const tipo = TIPOS[entrada.tipo];
      if (!tipo) return falha('Escolha o que aconteceu.');

      const hoje = dataDeHoje();
      const data = entrada.data || hoje;
      if (!dataValida(data)) return falha('Informe uma data válida.');
      if (data > hoje) return falha('A data não pode estar no futuro.');

      const mov = {
        codigo: gerarCodigo(),
        tipo: entrada.tipo,
        data,
        criadoEm: new Date().toISOString(),
        descricao: texto(entrada.descricao, 120),
        pessoa: texto(entrada.pessoa, 80),
      };
      return tipo.area === 'estoque' ? registrarEstoque(entrada, mov, hoje) : registrarDinheiro(entrada, mov);
    }

    function estornarEstoque(mov) {
      const item = acharItem(mov.itemId);
      if (!item) return falha('O item dessa movimentação não existe mais.');
      if (mov.tipo === 'doacao_item') {
        if (item.quantidade < mov.quantidade) return falha('Parte desses itens já saiu do estoque; não dá para desfazer.');
        item.quantidade = arred(item.quantidade - mov.quantidade);
      } else {
        item.quantidade = arred(item.quantidade + mov.quantidade);
      }

      const lista = movimentosDeEstoque();
      if ('validadeAnterior' in mov) {
        // Se o item mudou depois desta movimentação, a validade "de antes" já não vale:
        // restaurá-la poderia esconder um lote novo que vence antes.
        const posicao = lista.findIndex((m) => m.codigo === mov.codigo);
        const mexidoDepois = lista.slice(posicao + 1).some((m) => m.itemId === item.codigo);
        if (!mexidoDepois) item.validade = mov.validadeAnterior;
        else if (mov.tipo === 'saida_item' && mov.validadeAnterior && (!item.validade || mov.validadeAnterior < item.validade)) {
          item.validade = mov.validadeAnterior; // os itens devolvidos voltam com a validade deles
        }
        if (item.quantidade === 0) item.validade = null;
      }

      // Item cadastrado por esta doação e sem outro uso sai junto; senão vira um item fantasma.
      const usadoEmOutro = lista.some((m) => m.codigo !== mov.codigo && m.itemId === item.codigo);
      const gravado = mov.criouItem && !usadoEmOutro ? removerRegistro('itens', item.codigo) : salvarRegistro('itens', item);
      return gravado.ok ? { ok: true } : falha(gravado.erros[0]);
    }

    // Desfaz uma movimentação, devolvendo o estoque/caixa ao que era.
    function estornar(codigo) {
      const mov = [...movimentosDeEstoque(), ...movimentosDeDinheiro()].find((m) => m.codigo === codigo);
      if (!mov) return falha('Essa movimentação não existe mais.');

      if (TIPOS[mov.tipo].area === 'estoque') {
        const r = estornarEstoque(mov);
        if (!r.ok) return r;
      } else if (mov.tipo === 'entrada_dinheiro' && saldoCentavos() < mov.valorCentavos) {
        return falha('Esse dinheiro já foi usado em despesas; não dá para desfazer.');
      }

      const removido = removerRegistro(TIPOS[mov.tipo].area === 'estoque' ? 'doacoes' : 'dinheiro', mov.codigo);
      return removido.ok ? { ok: true } : falha(removido.erros[0]);
    }

    function resumo() {
      const mes = dataDeHoje().slice(0, 7);
      let entradasMes = 0;
      let saidasMes = 0;
      let doacoesItens = 0;
      let doacoesDinheiro = 0;
      for (const m of movimentosDeDinheiro()) {
        if (!m.data.startsWith(mes)) continue;
        if (m.tipo === 'entrada_dinheiro') { entradasMes += m.valorCentavos; doacoesDinheiro += 1; }
        if (m.tipo === 'saida_dinheiro') saidasMes += m.valorCentavos;
      }
      for (const m of movimentosDeEstoque()) {
        if (m.tipo === 'doacao_item' && m.data.startsWith(mes)) doacoesItens += 1;
      }
      const itens = itensValidos();
      return {
        saldoCentavos: saldoCentavos(),
        entradasMes,
        saidasMes,
        doacoesItens,
        doacoesDinheiro,
        abaixoDoMinimo: itens.filter((i) => i.quantidade <= i.minimo),
        vencendo: itens.filter((i) => i.validade && i.quantidade > 0 && diasAte(i.validade) <= DIAS_ALERTA_VALIDADE),
      };
    }

    function movimentos() {
      return [...movimentosDeEstoque(), ...movimentosDeDinheiro()];
    }

    const ehExemplo = (m) => m.codigo.startsWith(PREFIXO_EXEMPLO);

    return {
      itens: itensValidos,
      movimentos,
      item: (codigo) => acharItem(codigo) ?? null,
      registrar,
      estornar,
      resumo,
      restaurarExemplo: () => gravarColecoes(dadosDeExemplo()),
      apagarTudo: () => gravarColecoes({ itens: [], doacoes: [], dinheiro: [] }),
      // Ainda há exemplos na tela? E só exemplos, sem nada lançado por alguém?
      temExemplos: () => movimentos().some(ehExemplo),
      soExemplos: () => { const m = movimentos(); return m.length > 0 && m.every(ehExemplo); },
    };
  }

  // gerarCodigo e as conversões de dinheiro são usadas também pelo backup.js.
  Object.assign(raiz, { gerarCodigo, textoParaCentavos, centavosParaTexto });

  const api = { criarStore, TIPOS, CATEGORIAS, DIAS_ALERTA_VALIDADE, quantidadeDeTexto };
  raiz.ViaMatris = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
