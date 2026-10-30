/*
 * Camada de dados do protótipo (o "back-end de mentira").
 *
 * Toda regra de negócio fica aqui: validar, somar saldo, baixar estoque.
 * A tela (app.js) só chama registrar(), estornar() e resumo() e desenha o resultado.
 * Quando o back-end em Python existir, estas funções passam a chamar a API com fetch().
 * Como fetch é assíncrono, app.js vai precisar de await nas chamadas; as regras e o
 * desenho da tela continuam os mesmos.
 *
 * Os dados ficam no localStorage do navegador. Isso serve para demonstrar,
 * não para uso real: veja o README (seção "Riscos").
 */
(function (raiz) {
  'use strict';

  const CHAVE_STORAGE = 'via-matris:dados:v1';
  const DIAS_ALERTA_VALIDADE = 15;

  const TIPOS = {
    doacao_item: { rotulo: 'Doação de itens', area: 'estoque', sinal: 1 },
    saida_item: { rotulo: 'Saída de itens', area: 'estoque', sinal: -1 },
    entrada_dinheiro: { rotulo: 'Entrada de dinheiro', area: 'financeiro', sinal: 1 },
    saida_dinheiro: { rotulo: 'Despesa', area: 'financeiro', sinal: -1 },
  };
  const CATEGORIAS = ['Alimentos', 'Higiene', 'Limpeza'];

  // ---------- utilitários ----------

  function dataISO(d) {
    // Data local (não UTC), senão à noite o "hoje" viraria amanhã.
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function diasAte(iso, hoje = new Date()) {
    const alvo = new Date(iso + 'T00:00:00');
    const base = new Date(dataISO(hoje) + 'T00:00:00');
    return Math.round((alvo - base) / 86400000);
  }

  function novoId() {
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
  function centavosDeTexto(valor) {
    return Math.round(numeroDeTexto(valor, 2) * 100);
  }

  function quantidadeDeTexto(valor) {
    return typeof valor === 'number' ? valor : numeroDeTexto(valor, 3);
  }

  // "2026-02-31" passa na regex e o JS rola para março; reconverter pega isso.
  function dataValida(iso) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) && dataISO(new Date(iso + 'T00:00:00')) === iso;
  }

  function falha(erro) {
    return { ok: false, erro };
  }

  // ---------- dados de exemplo ----------

  function dadosDeExemplo(hoje = new Date()) {
    const dia = (n) => {
      const d = new Date(hoje);
      d.setDate(d.getDate() + n);
      return dataISO(d);
    };
    const item = (id, nome, categoria, unidade, quantidade, minimo, validade = null) =>
      ({ id, nome, categoria, unidade, quantidade, minimo, validade });
    const mov = (data, tipo, extra) =>
      ({ id: novoId(), data, tipo, criadoEm: new Date(data + 'T12:00:00').toISOString(), descricao: '', pessoa: '', ...extra });

    return {
      versao: 1,
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
      movimentos: [
        mov(dia(0), 'saida_item', { itemId: 'arroz', quantidade: 3, descricao: 'Almoço', pessoa: 'Cozinha' }),
        mov(dia(-1), 'doacao_item', { itemId: 'leite', quantidade: 12, pessoa: 'Paróquia São José' }),
        mov(dia(-1), 'entrada_dinheiro', { valorCentavos: 50000, descricao: 'Doação via Pix', pessoa: 'Doador anônimo' }),
        mov(dia(-2), 'saida_dinheiro', { valorCentavos: 18990, descricao: 'Botijão de gás', pessoa: 'Gás Central' }),
        mov(dia(-3), 'doacao_item', { itemId: 'arroz', quantidade: 25, pessoa: 'Supermercado Bom Preço' }),
        mov(dia(-4), 'saida_item', { itemId: 'fralda', quantidade: 6, descricao: 'Reposição semanal', pessoa: 'Ala feminina' }),
        mov(dia(-7), 'entrada_dinheiro', { valorCentavos: 120000, descricao: 'Bazar beneficente', pessoa: 'Bazar da casa' }),
        mov(dia(-6), 'saida_dinheiro', { valorCentavos: 64000, descricao: 'Conta de luz', pessoa: 'Concessionária de energia' }),
        mov(dia(-8), 'doacao_item', { itemId: 'sabonete', quantidade: 24, pessoa: 'Grupo de voluntários' }),
        mov(dia(-10), 'saida_item', { itemId: 'detergente', quantidade: 4, descricao: 'Limpeza geral', pessoa: 'Limpeza' }),
        mov(dia(-14), 'entrada_dinheiro', { valorCentavos: 175000, descricao: 'Contribuição mensal', pessoa: 'Associação de amigos' }),
        mov(dia(-12), 'saida_dinheiro', { valorCentavos: 115010, descricao: 'Verduras e carnes da semana', pessoa: 'Feira do bairro' }),
      ],
    };
  }

  // ---------- store ----------

  // Em aba anônima ou com cookies bloqueados, só ler window.localStorage já lança erro.
  // Sem storage o sistema ainda funciona; apenas não guarda nada ao fechar.
  function storageSeguro() {
    try {
      return raiz.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function criarStore(storage = storageSeguro()) {
    let estado = carregar();

    function carregar() {
      try {
        const bruto = storage && storage.getItem(CHAVE_STORAGE);
        if (bruto) {
          const dados = JSON.parse(bruto);
          if (dados && dados.versao === 1 && Array.isArray(dados.itens) && Array.isArray(dados.movimentos)) {
            // Descarta movimentos corrompidos em vez de derrubar a tela inteira.
            // Um valor faltando viraria NaN no saldo e desligaria a checagem de saldo insuficiente.
            dados.movimentos = dados.movimentos.filter((m) => m && TIPOS[m.tipo] && typeof m.data === 'string' &&
              (TIPOS[m.tipo].area === 'financeiro'
                ? Number.isInteger(m.valorCentavos) && m.valorCentavos > 0
                : Number.isFinite(m.quantidade) && m.quantidade > 0));
            return dados;
          }
        }
      } catch (e) {
        console.warn('Dados salvos ilegíveis; carregando exemplo.', e);
      }
      return dadosDeExemplo();
    }

    function salvar() {
      // Sem armazenamento nada é gravado: responder false faz a tela avisar o usuário.
      if (!storage) return false;
      try {
        storage.setItem(CHAVE_STORAGE, JSON.stringify(estado));
        return true;
      } catch (e) {
        // Navegador em modo privado ou cota cheia: a tela avisa o usuário.
        console.warn('Não foi possível salvar.', e);
        return false;
      }
    }

    function acharItem(id) {
      return estado.itens.find((i) => i.id === id);
    }

    function saldoCentavos() {
      return estado.movimentos.reduce((total, m) => {
        const t = TIPOS[m.tipo];
        return t.area === 'financeiro' ? total + t.sinal * m.valorCentavos : total;
      }, 0);
    }

    function registrar(entrada) {
      const tipo = TIPOS[entrada.tipo];
      if (!tipo) return falha('Escolha o que aconteceu.');

      const hoje = dataISO(new Date());
      const data = entrada.data || hoje;
      if (!dataValida(data)) return falha('Informe uma data válida.');
      if (data > hoje) return falha('A data não pode estar no futuro.');

      const mov = {
        id: novoId(),
        tipo: entrada.tipo,
        data,
        criadoEm: new Date().toISOString(),
        descricao: texto(entrada.descricao, 120),
        pessoa: texto(entrada.pessoa, 80),
      };

      let novoItem = null;

      if (tipo.area === 'estoque') {
        const quantidade = arred(quantidadeDeTexto(entrada.quantidade));
        if (!Number.isFinite(quantidade) || quantidade <= 0) return falha('Informe uma quantidade maior que zero.');

        let item;
        if (entrada.novoItem) {
          if (entrada.tipo !== 'doacao_item') return falha('Só dá para cadastrar item novo ao registrar uma doação.');
          const nome = texto(entrada.novoItem.nome, 60);
          const unidade = texto(entrada.novoItem.unidade, 10);
          const minimo = arred(quantidadeDeTexto(entrada.novoItem.minimo || '0'));
          if (!nome) return falha('Dê um nome ao item novo.');
          if (!unidade) return falha('Informe a unidade do item novo (kg, L, un, pct).');
          if (!CATEGORIAS.includes(entrada.novoItem.categoria)) return falha('Escolha a categoria do item novo.');
          if (!Number.isFinite(minimo) || minimo < 0) return falha('O estoque mínimo não pode ser negativo.');
          const igual = estado.itens.find((i) => i.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'));
          if (igual) return falha(`"${igual.nome}" já está cadastrado. Escolha-o na lista.`);
          novoItem = { id: novoId(), nome, categoria: entrada.novoItem.categoria, unidade, quantidade: 0, minimo, validade: null };
          item = novoItem;
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
          return falha(`Só há ${String(item.quantidade).replace('.', ',')} ${item.unidade} de ${item.nome} em estoque.`);
        }

        // Todas as validações passaram: só agora o estado muda.
        // Guarda a validade de antes para o Desfazer voltar exatamente ao que era.
        mov.validadeAnterior = item.validade;
        if (novoItem) mov.criouItem = true;
        if (novoItem) estado.itens.push(novoItem);
        if (entrada.tipo === 'doacao_item') {
          item.quantidade = arred(item.quantidade + quantidade);
          // shortcut: guarda só a validade mais próxima do item, não por lote; controle por lote fica para o back-end.
          if (validade && (!item.validade || validade < item.validade)) item.validade = validade;
        } else {
          item.quantidade = arred(item.quantidade - quantidade);
          if (item.quantidade === 0) item.validade = null;
        }
        mov.itemId = item.id;
        mov.quantidade = quantidade;
      } else {
        const valor = centavosDeTexto(entrada.valor);
        if (!Number.isFinite(valor) || valor <= 0) return falha('Informe um valor em reais maior que zero, como 150,00.');
        if (!mov.descricao) return falha(entrada.tipo === 'saida_dinheiro' ? 'Diga com o que o dinheiro foi gasto.' : 'Diga de onde veio o dinheiro.');
        if (entrada.tipo === 'saida_dinheiro' && valor > saldoCentavos()) {
          return falha('Saldo insuficiente em caixa para essa despesa. Confira o valor ou registre antes a entrada.');
        }
        mov.valorCentavos = valor;
      }

      estado.movimentos.push(mov);
      return { ok: true, movimento: mov, salvo: salvar() };
    }

    // Desfaz uma movimentação, devolvendo o estoque/caixa ao que era.
    function estornar(id) {
      const mov = estado.movimentos.find((m) => m.id === id);
      if (!mov) return falha('Essa movimentação não existe mais.');

      if (TIPOS[mov.tipo].area === 'estoque') {
        const item = acharItem(mov.itemId);
        if (!item) return falha('O item dessa movimentação não existe mais.');
        if (mov.tipo === 'doacao_item') {
          if (item.quantidade < mov.quantidade) return falha('Parte desses itens já saiu do estoque; não dá para desfazer.');
          item.quantidade = arred(item.quantidade - mov.quantidade);
        } else {
          item.quantidade = arred(item.quantidade + mov.quantidade);
        }
        if ('validadeAnterior' in mov) {
          // Se o item mudou depois desta movimentação, a validade "de antes" já não vale:
          // restaurá-la poderia esconder um lote novo que vence antes.
          const mexidoDepois = estado.movimentos.slice(estado.movimentos.indexOf(mov) + 1).some((m) => m.itemId === item.id);
          if (!mexidoDepois) item.validade = mov.validadeAnterior;
          else if (mov.tipo === 'saida_item' && mov.validadeAnterior && (!item.validade || mov.validadeAnterior < item.validade)) {
            item.validade = mov.validadeAnterior; // os itens devolvidos voltam com a validade deles
          }
          if (item.quantidade === 0) item.validade = null;
        }
        // Item cadastrado por esta doação e sem outro uso sai junto; senão vira um item fantasma.
        const usadoEmOutro = estado.movimentos.some((m) => m !== mov && m.itemId === item.id);
        if (mov.criouItem && !usadoEmOutro) estado.itens = estado.itens.filter((i) => i !== item);
      } else if (mov.tipo === 'entrada_dinheiro' && saldoCentavos() < mov.valorCentavos) {
        return falha('Esse dinheiro já foi usado em despesas; não dá para desfazer.');
      }

      estado.movimentos = estado.movimentos.filter((m) => m !== mov);
      return { ok: true, salvo: salvar() };
    }

    function resumo(hoje = new Date()) {
      const mes = dataISO(hoje).slice(0, 7);
      let entradasMes = 0;
      let saidasMes = 0;
      let doacoesItens = 0;
      let doacoesDinheiro = 0;
      for (const m of estado.movimentos) {
        if (!m.data.startsWith(mes)) continue;
        if (m.tipo === 'entrada_dinheiro') entradasMes += m.valorCentavos;
        if (m.tipo === 'saida_dinheiro') saidasMes += m.valorCentavos;
        if (m.tipo === 'doacao_item') doacoesItens += 1;
        if (m.tipo === 'entrada_dinheiro') doacoesDinheiro += 1;
      }
      return {
        saldoCentavos: saldoCentavos(),
        entradasMes,
        saidasMes,
        doacoesItens,
        doacoesDinheiro,
        abaixoDoMinimo: estado.itens.filter((i) => i.quantidade <= i.minimo),
        vencendo: estado.itens.filter((i) => i.validade && i.quantidade > 0 && diasAte(i.validade, hoje) <= DIAS_ALERTA_VALIDADE),
      };
    }

    // Outra aba gravou dados: relê para não sobrescrever o que ela salvou.
    function recarregar() {
      estado = carregar();
    }

    function restaurarExemplo() {
      estado = dadosDeExemplo();
      return salvar();
    }

    // A tela recebe cópias, então não consegue alterar o estado sem passar pelas regras acima.
    return {
      itens: () => estado.itens.map((i) => ({ ...i })),
      movimentos: () => estado.movimentos.map((m) => ({ ...m })),
      item: (id) => { const i = acharItem(id); return i ? { ...i } : null; },
      registrar,
      estornar,
      resumo,
      restaurarExemplo,
      recarregar,
      chave: CHAVE_STORAGE,
    };
  }

  const api = { criarStore, TIPOS, CATEGORIAS, DIAS_ALERTA_VALIDADE, dataISO, diasAte, centavosDeTexto, quantidadeDeTexto, dataValida };
  raiz.ViaMatris = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
