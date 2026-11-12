/*
 * Camada de tela: lê o store, desenha a página e repassa as ações do usuário.
 * Nenhuma regra de negócio aqui; as regras ficam em store.js.
 *
 * Segurança: todo texto vindo do usuário entra na página via textContent,
 * nunca via innerHTML. Assim, um nome de doador como "<script>..." aparece
 * como texto e não é executado (proteção contra XSS).
 */
(function () {
  'use strict';

  const { criarStore, TIPOS, CATEGORIAS, DIAS_ALERTA_VALIDADE, DOADOR_ANONIMO } = window.ViaMatris;
  const store = criarStore({ permitir: pode });
  const conta = contaAtual();

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brlCurto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const SVG = 'http://www.w3.org/2000/svg';
  const DIAS_ENTRE_BACKUPS = 7;

  const $ = (id) => document.getElementById(id);

  // Cria um elemento com atributos e filhos. Strings viram nós de texto (seguro).
  function el(tag, atributos = {}, ...filhos) {
    const no = document.createElement(tag);
    for (const [chave, valor] of Object.entries(atributos)) {
      if (valor === false || valor == null) continue;
      if (chave === 'class') no.className = valor;
      else no.setAttribute(chave, valor === true ? '' : valor);
    }
    for (const filho of filhos.flat()) {
      if (filho == null || filho === false) continue;
      no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
    }
    return no;
  }

  // ---------- resumo ----------

  function desenharResumo() {
    const r = store.resumo();
    $('kpi-saldo').textContent = brl.format(r.saldoCentavos / 100);
    $('kpi-saldo-nota').textContent =
      `Neste mês: entrou ${brl.format(r.entradasMes / 100)}, saiu ${brl.format(r.saidasMes / 100)}`;

    $('kpi-minimo').textContent = r.abaixoDoMinimo.length;
    $('kpi-minimo-nota').textContent = r.abaixoDoMinimo.length
      ? r.abaixoDoMinimo.map((i) => i.nome).join(', ')
      : 'Tudo acima do mínimo';
    $('kpi-minimo-bloco').classList.toggle('alerta', r.abaixoDoMinimo.length > 0);

    $('kpi-validade').textContent = r.vencendo.length;
    $('kpi-validade-nota').textContent = r.vencendo.length
      ? r.vencendo.map((i) => i.nome).join(', ')
      : 'Nenhum item perto de vencer';
    $('kpi-validade-bloco').classList.toggle('atencao', r.vencendo.length > 0);

    // Cada perfil conta só as doações da própria área: o almoxarifado não fica sabendo do dinheiro.
    const verItens = pode('ver_estoque');
    const verDinheiro = pode('ver_financeiro');
    const itens = verItens ? r.doacoesItens : 0;
    const dinheiro = verDinheiro ? r.doacoesDinheiro : 0;
    $('kpi-doacoes').textContent = itens + dinheiro;
    $('kpi-doacoes-nota').textContent = verItens && verDinheiro
      ? `${itens} de itens, ${dinheiro} em dinheiro`
      : verItens ? `${itens === 1 ? 'doação' : 'doações'} de itens` : `${dinheiro === 1 ? 'entrada' : 'entradas'} de dinheiro`;
  }

  // ---------- gráfico de entradas e saídas ----------

  /*
   * Barras agrupadas por mês, desenhadas em SVG à mão (sem biblioteca: a CSP só aceita scripts
   * deste site, e o app precisa abrir sem internet). Um eixo só, em reais.
   * Cores: azul = entrou, laranja = saiu. Verde e vermelho se confundem para quem tem
   * daltonismo; este par passou na checagem de cores. A legenda e a tabela garantem
   * que a informação nunca depende só da cor.
   */
  function svg(tag, atributos = {}, ...filhos) {
    const no = document.createElementNS(SVG, tag);
    for (const [chave, valor] of Object.entries(atributos)) no.setAttribute(chave, valor);
    no.append(...filhos);
    return no;
  }

  // Coluna com só o topo arredondado (raio 4): a base fica reta, presa no eixo.
  function barra(x, y, largura, altura, classe) {
    if (altura <= 0) return null;
    const r = Math.min(4, largura / 2, altura);
    return svg('path', {
      class: classe,
      d: `M${x},${y + altura}V${y + r}Q${x},${y} ${x + r},${y}H${x + largura - r}Q${x + largura},${y} ${x + largura},${y + r}V${y + altura}Z`,
    });
  }

  // Um teto "redondo" para o eixo: 1.000, 2.000, 2.500, 5.000...
  function tetoDoEixo(maior) {
    if (maior <= 0) return 100000;
    const potencia = 10 ** Math.floor(Math.log10(maior / 4));
    const passo = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((v) => v >= maior / 4);
    return passo * 4;
  }

  const nomeMesCurto = (m) => new Date(m.ano, m.mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

  function desenharGrafico() {
    if (!pode('ver_financeiro')) return;
    const meses = store.fluxoMensal(6);
    const vazio = meses.every((m) => !m.entradas && !m.saidas);
    $('grafico-vazio').hidden = !vazio;
    $('grafico').hidden = vazio;
    $('grafico-mes-atual').hidden = vazio;

    $('corpo-grafico').replaceChildren(...meses.slice().reverse().map((m) => {
      const resultado = m.entradas - m.saidas;
      return el('tr', {},
        el('th', { scope: 'row' }, nomeDoMes(m.mes, m.ano)),
        el('td', { class: 'num' }, brl.format(m.entradas / 100)),
        el('td', { class: 'num' }, brl.format(m.saidas / 100)),
        el('td', { class: `num ${resultado < 0 ? 'negativo' : resultado > 0 ? 'positivo' : ''}` },
          `${resultado > 0 ? '+' : resultado < 0 ? '−' : ''}${brl.format(Math.abs(resultado) / 100)}`));
    }));
    if (vazio) return;

    const largura = Math.max(280, $('grafico').clientWidth || 600);
    const altura = 240;
    const margem = { topo: 24, direita: 8, baixo: 30, esquerda: largura < 420 ? 52 : 64 };
    const areaL = largura - margem.esquerda - margem.direita;
    const areaA = altura - margem.topo - margem.baixo;
    const teto = tetoDoEixo(Math.max(...meses.flatMap((m) => [m.entradas, m.saidas])));
    const y = (v) => margem.topo + areaA - (v / teto) * areaA;
    const coluna = areaL / meses.length;
    const larguraBarra = Math.min(28, coluna * 0.3);

    const grade = [0, 1, 2, 3, 4].map((i) => {
      const v = (teto / 4) * i;
      return svg('g', { class: i === 0 ? 'eixo-base' : 'eixo-grade' },
        svg('line', { x1: margem.esquerda, x2: largura - margem.direita, y1: y(v), y2: y(v) }),
        svg('text', { x: margem.esquerda - 8, y: y(v) + 4, 'text-anchor': 'end' }, brlCurto.format(v / 100)));
    });

    const grupos = meses.map((m, i) => {
      const centro = margem.esquerda + coluna * i + coluna / 2;
      const xEntrada = centro - larguraBarra - 1; // 2 px de folga entre as duas barras
      const xSaida = centro + 1;
      const atual = i === meses.length - 1;
      const resultado = m.entradas - m.saidas;
      const rotulo = `${nomeDoMes(m.mes, m.ano)}: entrou ${brl.format(m.entradas / 100)}, saiu ${brl.format(m.saidas / 100)}, ` +
        `resultado ${resultado < 0 ? 'negativo de ' : ''}${brl.format(Math.abs(resultado) / 100)}.`;
      return svg('g', { class: 'mes', tabindex: '0', role: 'img', 'aria-label': rotulo, 'data-indice': String(i) },
        // Área de toque maior que as barras: o mês inteiro responde ao dedo e ao mouse.
        svg('rect', { class: 'mes-fundo', x: margem.esquerda + coluna * i, y: margem.topo, width: coluna, height: areaA }),
        ...[barra(xEntrada, y(m.entradas), larguraBarra, y(0) - y(m.entradas), 'barra-entrada'),
          barra(xSaida, y(m.saidas), larguraBarra, y(0) - y(m.saidas), 'barra-saida')].filter(Boolean),
        svg('text', { class: atual ? 'mes-nome atual' : 'mes-nome', x: centro, y: altura - 8, 'text-anchor': 'middle' }, nomeMesCurto(m)));
    });

    const desenho = svg('svg', { width: largura, height: altura, viewBox: `0 0 ${largura} ${altura}`, 'aria-label': 'Entradas e saídas de dinheiro nos últimos 6 meses', role: 'group' },
      ...grade, ...grupos);
    $('grafico').replaceChildren(desenho);
    graficoMeses = meses;
    // O mês atual, escrito por extenso: é a pergunta mais comum ("como estamos este mês?").
    const agora = meses[meses.length - 1];
    $('grafico-mes-atual').textContent = `${nomeDoMes(agora.mes, agora.ano)}, até hoje: entrou ${brl.format(agora.entradas / 100)} e saiu ${brl.format(agora.saidas / 100)}.`;
  }

  let graficoMeses = [];

  function mostrarDica(grupo) {
    const m = graficoMeses[Number(grupo.dataset.indice)];
    if (!m) return;
    const dica = $('grafico-dica');
    const resultado = m.entradas - m.saidas;
    dica.replaceChildren(
      el('strong', {}, nomeDoMes(m.mes, m.ano)),
      el('span', {}, el('span', { class: 'amostra entrada', 'aria-hidden': 'true' }), `Entrou ${brl.format(m.entradas / 100)}`),
      el('span', {}, el('span', { class: 'amostra saida', 'aria-hidden': 'true' }), `Saiu ${brl.format(m.saidas / 100)}`),
      el('span', { class: 'dica-resultado' }, `Resultado: ${resultado < 0 ? '−' : resultado > 0 ? '+' : ''}${brl.format(Math.abs(resultado) / 100)}`));
    dica.hidden = false;
    // Posiciona ao lado do mês, sem sair da área do gráfico.
    const caixa = $('grafico').getBoundingClientRect();
    const alvo = grupo.querySelector('.mes-fundo').getBoundingClientRect();
    const esquerda = alvo.left - caixa.left + alvo.width / 2 - dica.offsetWidth / 2;
    dica.style.left = `${Math.max(0, Math.min(esquerda, caixa.width - dica.offsetWidth))}px`;
    $('grafico').querySelectorAll('.mes').forEach((g) => g.classList.toggle('ativo', g === grupo));
  }

  function esconderDica() {
    $('grafico-dica').hidden = true;
    $('grafico').querySelectorAll('.mes.ativo').forEach((g) => g.classList.remove('ativo'));
  }

  $('grafico').addEventListener('pointerover', (e) => { const g = e.target.closest('.mes'); if (g) mostrarDica(g); });
  // No toque, o dedo sai da tela logo depois: a dica fica até tocar fora do gráfico.
  $('grafico').addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') esconderDica(); });
  document.addEventListener('pointerdown', (e) => { if (!$('grafico').contains(e.target)) esconderDica(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') esconderDica(); });
  $('grafico').addEventListener('focusin', (e) => { const g = e.target.closest('.mes'); if (g) mostrarDica(g); });
  $('grafico').addEventListener('focusout', esconderDica);
  // Redesenha quando a largura muda (girar o celular, abrir o painel).
  if ('ResizeObserver' in window) {
    let larguraAnterior = 0;
    new ResizeObserver(([entrada]) => {
      const nova = Math.round(entrada.contentRect.width);
      if (nova && nova !== larguraAnterior) { larguraAnterior = nova; desenharGrafico(); }
    }).observe($('grafico'));
  }

  // ---------- despensa ----------

  const filtro = { texto: '', categoria: '' };

  function situacao(item) {
    if (item.quantidade === 0) return { classe: 'zerado', texto: 'Acabou' };
    if (item.quantidade < item.minimo) return { classe: 'baixo', texto: 'Abaixo do mínimo' };
    if (item.quantidade === item.minimo) return { classe: 'baixo', texto: 'No limite' };
    return { classe: 'ok', texto: 'Estoque suficiente' };
  }

  function desenharDespensa() {
    const busca = filtro.texto.toLocaleLowerCase('pt-BR');
    // Ordena pelo item mais "apertado" primeiro: quem precisa de atenção aparece no topo.
    const itens = store.itens()
      .filter((i) => !filtro.categoria || i.categoria === filtro.categoria)
      .filter((i) => !busca || i.nome.toLocaleLowerCase('pt-BR').includes(busca))
      .sort((a, b) => (a.quantidade / (a.minimo || 1)) - (b.quantidade / (b.minimo || 1)));

    const lista = $('lista-itens');
    lista.replaceChildren(...itens.map((item) => {
      const s = situacao(item);
      // A barra vai até 2,5x o mínimo; o tracinho do mínimo fica sempre em 40%.
      const escala = Math.max(item.minimo * 2.5, item.quantidade, 1);
      const largura = Math.min(100, (item.quantidade / escala) * 100);
      const posMinimo = (item.minimo / escala) * 100;

      let validade = null;
      if (item.validade && item.quantidade > 0) {
        const dias = diasAte(item.validade);
        const texto = dias < 0 ? 'Vencido' : dias === 0 ? 'Vence hoje' : `Vence em ${dias} dia${dias === 1 ? '' : 's'}`;
        validade = el('span', { class: dias <= DIAS_ALERTA_VALIDADE ? 'validade perto' : 'validade' }, texto);
      }

      const barra = el('span', { class: 'barra-cheia' });
      barra.style.setProperty('--largura', largura + '%');
      const marca = el('span', { class: 'barra-minimo' });
      marca.style.setProperty('--pos', posMinimo + '%');

      return el('li', { class: `prateleira-item ${s.classe}` },
        el('div', { class: 'item-topo' },
          el('span', { class: 'item-nome' }, item.nome),
          el('span', { class: 'item-qtd' }, textoDaQuantidade(item.quantidade), el('small', {}, ` ${item.unidade}`))),
        el('div', {
          class: 'barra',
          role: 'img',
          'aria-label': `${item.nome}: ${textoDaQuantidade(item.quantidade, item.unidade)}, mínimo ${textoDaQuantidade(item.minimo, item.unidade)}. ${s.texto}.`,
        }, barra, marca),
        el('div', { class: 'item-rodape' },
          el('span', { class: 'situacao' }, s.texto),
          el('span', {}, `mín. ${textoDaQuantidade(item.minimo, item.unidade)}`),
          validade));
    }));
    $('lista-vazia').hidden = itens.length > 0;
  }

  // ---------- formulário ----------

  const form = $('form-registro');
  const NOVO = '__novo__';

  const textosPorTipo = {
    doacao_item: { pessoa: 'Quem doou?', descricao: 'Observação', descricaoOpcional: true, botao: 'Registrar doação', feito: 'Doação registrada' },
    saida_item: { pessoa: 'Para onde foi?', descricao: 'Motivo', descricaoOpcional: true, botao: 'Registrar saída', feito: 'Saída registrada' },
    entrada_dinheiro: { pessoa: 'De quem veio?', descricao: 'De onde veio o dinheiro?', botao: 'Registrar entrada', feito: 'Entrada registrada' },
    saida_dinheiro: { pessoa: 'Pago a quem?', descricao: 'Com o que foi gasto?', botao: 'Registrar despesa', feito: 'Despesa registrada' },
  };

  const tipoAtual = () => form.elements.tipo.value;

  function preencherItens() {
    const select = $('f-item');
    const anterior = select.value;
    const itens = store.itens();
    const grupos = CATEGORIAS.map((cat) =>
      el('optgroup', { label: cat },
        itens.filter((i) => i.categoria === cat)
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
          .map((i) => el('option', { value: i.codigo }, `${i.nome} (${textoDaQuantidade(i.quantidade, i.unidade)})`))));
    const opcoes = [el('option', { value: '' }, 'Escolha um item'), ...grupos];
    if (tipoAtual() === 'doacao_item') opcoes.push(el('option', { value: NOVO }, 'Cadastrar item novo'));
    select.replaceChildren(...opcoes);
    select.value = [...select.options].some((o) => o.value === anterior) ? anterior : '';
  }

  // Mostra só os campos que fazem sentido para o tipo escolhido.
  // Campos escondidos também ficam desativados, para não irem no envio.
  function ajustarCampos() {
    const tipo = tipoAtual();
    preencherItens();
    const novo = tipo === 'doacao_item' && $('f-item').value === NOVO;
    form.querySelectorAll('[data-tipos]').forEach((bloco) => {
      const visivel = bloco.dataset.tipos.split(' ').includes(tipo) && (bloco.id !== 'novo-item' || novo);
      bloco.hidden = !visivel;
      bloco.querySelectorAll('input, select').forEach((c) => { c.disabled = !visivel; });
    });
    const t = textosPorTipo[tipo];
    // Deixa claro o que pode ficar em branco, para ninguém travar num campo que não é obrigatório.
    $('r-pessoa').replaceChildren(t.pessoa, ' ', el('span', { class: 'opcional' }, '(se quiser)'));
    // Doação de itens ou de dinheiro sem nome fica como "Doador anônimo" (regra no store.js).
    const doacao = tipo === 'entrada_dinheiro' || tipo === 'doacao_item';
    $('f-pessoa-dica').hidden = !doacao;
    $('f-pessoa').placeholder = doacao ? DOADOR_ANONIMO : '';
    $('r-descricao').replaceChildren(t.descricao, t.descricaoOpcional ? ' ' : '', t.descricaoOpcional ? el('span', { class: 'opcional' }, '(se quiser)') : '');
    $('f-enviar').textContent = t.botao;
    const item = store.item($('f-item').value);
    $('f-unidade').textContent = item ? `(${item.unidade})` : '';
    mostrarErro('');
  }

  function mostrarErro(msg, campo) {
    $('erro-form').textContent = msg;
    form.querySelectorAll('[aria-invalid]').forEach((c) => {
      c.removeAttribute('aria-invalid');
      c.removeAttribute('aria-describedby');
    });
    if (campo) {
      campo.setAttribute('aria-invalid', 'true');
      // Faz o leitor de tela ler o motivo do erro quando o foco chega no campo.
      campo.setAttribute('aria-describedby', 'erro-form');
      campo.focus();
    }
  }

  // Aponta qual campo provavelmente causou o erro, para levar o foco até ele.
  function campoDoErro(msg) {
    const mapa = [
      [/quantidade|em estoque|saíram/i, 'f-quantidade'],
      [/valor|saldo/i, 'f-valor'],
      [/item da lista|escolha um item/i, 'f-item'],
      [/nome ao item|já está cadastrado/i, 'f-novo-nome'],
      [/unidade/i, 'f-novo-unidade'],
      [/mínimo/i, 'f-novo-minimo'],
      [/validade|vencido/i, 'f-validade'],
      [/data/i, 'f-data'],
      [/gasto|veio o dinheiro/i, 'f-descricao'],
    ];
    const achado = mapa.find(([re]) => re.test(msg));
    return achado ? $(achado[1]) : null;
  }

  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    // Sessão vencida com a página aberta: volta para a entrada, em vez de dizer "seu perfil não pode".
    if (conferirSessao()) return;
    atualizarData(); // o dia pode ter virado com a tela aberta
    const tipo = tipoAtual();
    const dados = Object.fromEntries(new FormData(form));
    const entrada = {
      tipo,
      data: dados.data,
      pessoa: dados.pessoa,
      descricao: dados.descricao,
      itemId: dados.itemId,
      quantidade: dados.quantidade,
      validade: dados.validade,
      valor: dados.valor,
    };
    if (dados.itemId === NOVO) {
      entrada.itemId = null;
      entrada.novoItem = {
        nome: dados.novoNome,
        categoria: dados.novoCategoria,
        unidade: dados.novoUnidade,
        minimo: dados.novoMinimo,
      };
    }

    const resultado = store.registrar(entrada);
    if (!resultado.ok) {
      mostrarErro(resultado.erro, campoDoErro(resultado.erro));
      return;
    }

    const mov = resultado.movimento;
    const item = mov.itemId ? store.item(mov.itemId) : null;
    const detalhe = item
      ? `${textoDaQuantidade(mov.quantidade, item.unidade)} de ${item.nome}`
      : brl.format(mov.valorCentavos / 100);
    avisar(`${textosPorTipo[tipo].feito}: ${detalhe}.`, pode('desfazer') ? mov.codigo : null);
    registrarAuditoria(textosPorTipo[tipo].feito, detalhe);

    // Limpa os campos de conteúdo, mantendo tipo, item e data para lançamentos em sequência.
    ['f-quantidade', 'f-validade', 'f-valor', 'f-pessoa', 'f-descricao', 'f-novo-nome', 'f-novo-unidade'].forEach((id) => { $(id).value = ''; });
    $('f-novo-minimo').value = '0';
    if (dados.itemId === NOVO) $('f-item').value = '';
    atualizarTudo();
    $('f-quantidade').disabled ? $('f-valor').focus() : $('f-quantidade').focus();
  });

  form.addEventListener('change', (evento) => {
    if (evento.target.name === 'tipo' || evento.target.name === 'itemId') ajustarCampos();
  });

  // ---------- aviso com "Desfazer" ----------

  // 20 s e pausa com mouse/foco em cima: quem lê devagar precisa ter tempo de achar o "Desfazer".
  const TEMPO_AVISO = 20000;
  let temporizador = null;
  let ultimoId = null;

  function fecharAviso() {
    clearTimeout(temporizador);
    $('aviso').classList.remove('visivel');
    $('aviso-desfazer').hidden = true;
    $('aviso-fechar').hidden = true;
    ultimoId = null;
  }

  function agendarFechamento() {
    clearTimeout(temporizador);
    temporizador = setTimeout(fecharAviso, TEMPO_AVISO);
  }

  function avisar(texto, idDesfazer = null) {
    $('aviso-texto').textContent = texto;
    ultimoId = idDesfazer;
    $('aviso-desfazer').hidden = !idDesfazer;
    $('aviso-fechar').hidden = false;
    $('aviso').classList.add('visivel');
    agendarFechamento();
  }

  $('aviso').addEventListener('mouseenter', () => clearTimeout(temporizador));
  $('aviso').addEventListener('focusin', () => clearTimeout(temporizador));
  $('aviso').addEventListener('mouseleave', () => { if ($('aviso').classList.contains('visivel')) agendarFechamento(); });
  $('aviso-fechar').addEventListener('click', fecharAviso);

  $('aviso-desfazer').addEventListener('click', () => {
    if (!ultimoId || conferirSessao()) return;
    const r = store.estornar(ultimoId);
    if (r.ok) registrarAuditoria('Desfez uma movimentação');
    atualizarTudo();
    avisar(r.ok ? 'Movimentação desfeita.' : r.erro);
  });

  // ---------- histórico ----------

  const LIMITE_HISTORICO = 50;

  // Os meses que aparecem no filtro são os que têm algo que esta pessoa pode ver.
  function preencherMeses(visiveis) {
    const select = $('filtro-mes');
    const anterior = select.value;
    const meses = [...new Set(visiveis.map((m) => m.data.slice(0, 7)))].sort().reverse();
    select.replaceChildren(el('option', { value: '' }, 'Todos os meses'),
      ...meses.map((chave) => el('option', { value: chave }, nomeDoMes(Number(chave.slice(5)), Number(chave.slice(0, 4))))));
    select.value = meses.includes(anterior) ? anterior : '';
  }

  function desenharHistorico() {
    if (!pode('historico')) return;
    const area = $('filtro-historico').value;
    const visiveis = store.movimentos().filter((m) => pode(`ver_${TIPOS[m.tipo].area}`));
    preencherMeses(visiveis);
    const mes = $('filtro-mes').value;
    const todos = visiveis
      .filter((m) => !area || TIPOS[m.tipo].area === area)
      .filter((m) => !mes || m.data.startsWith(mes))
      .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm.localeCompare(a.criadoEm));
    const movs = todos.slice(0, LIMITE_HISTORICO);
    // Sem este aviso, a movimentação mais antiga some da tabela e parece ter sido apagada.
    $('historico-limite').hidden = todos.length <= LIMITE_HISTORICO;
    $('historico-limite').textContent = `Mostrando as ${LIMITE_HISTORICO} mais recentes de ${todos.length} movimentações. Escolha um mês para ver as outras.`;

    // Com um mês escolhido, mostra o total dele: é a conta que a prestação de contas pede.
    const nomeMes = mes ? nomeDoMes(Number(mes.slice(5)), Number(mes.slice(0, 4))) : '';
    const partes = [`${todos.length} ${todos.length === 1 ? 'movimentação' : 'movimentações'}${mes ? ` em ${nomeMes}` : ''}`];
    if (mes && pode('ver_financeiro') && area !== 'estoque') {
      const soma = (tipo) => todos.filter((m) => m.tipo === tipo).reduce((t, m) => t + m.valorCentavos, 0);
      partes.push(`entrou ${brl.format(soma('entrada_dinheiro') / 100)}, saiu ${brl.format(soma('saida_dinheiro') / 100)}`);
    }
    $('historico-total').textContent = `${partes.join(': ')}.`;

    const itens = new Map(store.itens().map((i) => [i.codigo, i]));
    $('corpo-historico').replaceChildren(...movs.map((m) => {
      const tipo = TIPOS[m.tipo];
      const sinal = tipo.sinal > 0 ? '+' : '−';
      const item = itens.get(m.itemId);
      const valor = tipo.area === 'estoque'
        ? `${sinal}${textoDaQuantidade(m.quantidade, item?.unidade)}`
        : `${sinal}${brl.format(m.valorCentavos / 100)}`;
      const detalhe = tipo.area === 'estoque'
        ? [item?.nome ?? '(item apagado)', m.descricao].filter(Boolean).join(': ')
        : m.descricao;

      // data-rotulo: no celular a tabela vira cartões, e cada valor ganha o nome da coluna.
      return el('tr', {},
        el('td', { 'data-rotulo': 'Data' }, el('time', { datetime: m.data }, dataCurta(m.data))),
        el('td', { 'data-rotulo': 'Movimento' }, el('span', { class: `etiqueta ${m.tipo}` }, tipo.rotulo)),
        el('td', { 'data-rotulo': 'Detalhe' }, detalhe || '—'),
        el('td', { 'data-rotulo': 'Quem' }, m.pessoa || '—'),
        el('td', { 'data-rotulo': 'Quantidade ou valor', class: `num ${tipo.sinal > 0 ? 'positivo' : 'negativo'}` }, valor),
        el('td', { class: 'acao' }, pode('desfazer') && el('button', {
          type: 'button',
          class: 'botao-fantasma',
          'data-codigo': m.codigo,
          'aria-label': `${pedindoConfirmacao === m.codigo ? 'Confirmar: desfazer' : 'Desfazer'} ${tipo.rotulo}, ${valor}, ${dataCurta(m.data)}`,
        }, pedindoConfirmacao === m.codigo ? 'Confirmar' : 'Desfazer')));
    }));
    $('historico-vazio').hidden = movs.length > 0;
    $('historico-vazio').textContent = visiveis.length
      ? 'Nada encontrado com esses filtros. Troque o mês ou o tipo de movimento.'
      : 'Nada registrado ainda. Use a página Registrar para lançar a primeira movimentação.';
  }

  // Dois toques: o primeiro pede confirmação na própria linha, o segundo desfaz.
  let pedindoConfirmacao = null;

  $('corpo-historico').addEventListener('click', (e) => {
    const botao = e.target.closest('button[data-codigo]');
    if (!botao || conferirSessao()) return;
    const codigo = botao.dataset.codigo;

    if (pedindoConfirmacao !== codigo) {
      pedindoConfirmacao = codigo;
      desenharHistorico();
      [...$('corpo-historico').querySelectorAll('button[data-codigo]')].find((b) => b.dataset.codigo === codigo).focus();
      return;
    }
    pedindoConfirmacao = null;
    const r = store.estornar(codigo);
    if (r.ok) registrarAuditoria('Desfez uma movimentação');
    atualizarTudo();
    avisar(r.ok ? 'Movimentação desfeita.' : r.erro);
  });

  // ---------- eventos gerais ----------

  $('busca').addEventListener('input', (e) => { filtro.texto = e.target.value.trim(); desenharDespensa(); });
  document.querySelectorAll('input[name="categoria"]').forEach((r) =>
    r.addEventListener('change', (e) => { filtro.categoria = e.target.value; desenharDespensa(); }));
  $('filtro-historico').addEventListener('change', desenharHistorico);
  $('filtro-mes').addEventListener('change', desenharHistorico);

  // ---------- apagar tudo ----------

  const CONFIRMACOES = {
    zero: {
      texto: 'Isso apaga tudo o que está neste aparelho, sem volta. Se houver dados reais, baixe as planilhas antes.',
      fazer: () => store.apagarTudo(),
      feito: 'Tudo apagado. Registre a primeira doação para cadastrar os itens da casa.',
    },
    exemplo: {
      texto: 'Isso troca tudo o que está neste aparelho pelos dados de exemplo, sem volta.',
      fazer: () => store.restaurarExemplo(),
      feito: 'Dados de exemplo restaurados.',
    },
  };
  let confirmacao = null;

  function mostrarConfirmacao(chave) {
    confirmacao = chave;
    $('opcoes').open = true;
    $('confirmar-restaurar').hidden = !chave;
    $('restaurar').hidden = Boolean(chave);
    $('comecar-zero').hidden = Boolean(chave);
    if (chave) $('confirmar-texto').textContent = CONFIRMACOES[chave].texto;
    $(chave ? 'restaurar-nao' : 'comecar-zero').focus();
  }

  $('comecar-zero').addEventListener('click', () => mostrarConfirmacao('zero'));
  $('faixa-comecar-zero').addEventListener('click', () => mostrarConfirmacao('zero'));
  $('restaurar').addEventListener('click', () => mostrarConfirmacao('exemplo'));
  $('restaurar-nao').addEventListener('click', () => mostrarConfirmacao(null));
  $('restaurar-sim').addEventListener('click', () => {
    if (conferirSessao()) return;
    const { fazer, feito } = CONFIRMACOES[confirmacao];
    const erro = fazer();
    if (!erro) registrarAuditoria(feito);
    mostrarConfirmacao(null);
    atualizarTudo();
    avisar(erro ?? feito);
  });

  // ---------- backup ----------

  function desenharBackup() {
    const dias = diasDesdeUltimoBackup();
    const quando = dias === null ? 'Ainda não foi feito backup.'
      : dias === 0 ? 'Último backup: hoje.'
        : `Último backup: há ${dias} dia${dias === 1 ? '' : 's'}.`;
    $('backup-quando').textContent = quando;

    const temExemplos = store.temExemplos();
    $('faixa-exemplo').hidden = !temExemplos || !pode('administrar');
    // Exemplos não precisam de backup; dados reais sim, mesmo misturados a eles, e são a única cópia.
    const atrasado = !store.soExemplos() && store.movimentos().length > 0 && (dias === null || dias > DIAS_ENTRE_BACKUPS);
    $('faixa-backup').hidden = !atrasado || !pode('administrar');
    $('faixa-backup-texto').textContent = `${quando} Os dados só existem neste aparelho: baixe as planilhas e guarde fora dele.`;
  }

  async function fazerBackup() {
    if (conferirSessao() || !pode('administrar')) return;
    const r = await baixarTodasAsPlanilhas();
    if (r.ok) registrarAuditoria('Baixou as planilhas');
    desenharBackup();
    avisar(r.ok ? 'Confira na pasta Downloads se chegaram as 3 planilhas e guarde-as fora deste aparelho.' : r.erros.join(' '));
  }

  $('backup-baixar').addEventListener('click', fazerBackup);
  $('faixa-backup-baixar').addEventListener('click', fazerBackup);
  $('backup-restaurar').addEventListener('click', () => $('backup-arquivo').click());
  $('backup-arquivo').addEventListener('change', async (e) => {
    if (conferirSessao() || !pode('administrar')) return;
    const arquivos = [...e.target.files];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!arquivos.length) return;

    // Sem isso, os exemplos ficariam no lugar dos dados reais de mesmo código.
    const r = await restaurarArquivos(arquivos, () => { if (store.soExemplos()) store.apagarTudo(); });
    if (r.ok) registrarAuditoria('Restaurou planilhas');
    atualizarTudo();

    const titulo = r.ok ? `${r.importados} registros restaurados, ${r.ignorados} já existiam.` : 'Nada foi restaurado.';
    const problemas = r.erros.slice(0, 3).join(' ');
    const mais = r.erros.length > 3 ? ` E mais ${r.erros.length - 3} problemas.` : '';
    avisar(`${titulo} ${problemas}${mais}`.trim());
  });

  // Duas abas abertas: quando a outra salva, esta redesenha com o que está gravado.
  aoMudarEmOutraAba(() => { conferirSessao(); atualizarTudo(); });

  let diaMostrado = null;

  function atualizarData() {
    const hoje = dataDeHoje();
    if (hoje === diaMostrado) return;
    // Só acompanha o dia se a pessoa não escolheu outra data à mão.
    if (!$('f-data').value || $('f-data').value === diaMostrado) $('f-data').value = hoje;
    diaMostrado = hoje;
    $('data-hoje').textContent = dataPorExtenso();
    $('f-data').max = hoje;
    atualizarTudo();
  }

  function atualizarTudo() {
    desenharResumo();
    desenharGrafico();
    desenharDespensa();
    ajustarCampos();
    desenharHistorico();
    desenharBackup();
    desenharContas();
    const problemas = problemasDoArmazenamento();
    $('faixa-armazenamento').hidden = !problemas.length;
    $('faixa-armazenamento-texto').textContent = problemas.join(' ');
  }

  // ---------- perfil e conta ----------

  // Sessão vencida ou conta desativada: volta para o login, limpando a tela.
  function conferirSessao() {
    const atual = contaAtual();
    // Outra aba pode ter trocado o perfil: recarrega para o menu e as páginas seguirem o perfil novo.
    if (atual?.codigo === conta?.codigo && atual?.perfil === conta?.perfil) return false;
    location.reload();
    return true;
  }

  // Esconder melhora a tela, mas quem barra de verdade são as regras no store.js e no acesso.js.
  function aplicarPerfil() {
    const verEstoque = pode('ver_estoque');
    const verDinheiro = pode('ver_financeiro');
    const admin = pode('administrar');
    $('conta-resumo').textContent = conta.nome.split(' ')[0];
    $('conta-nome').textContent = conta.nome;
    $('conta-perfil').textContent = PERFIS[conta.perfil].rotulo;
    $('area-admin').hidden = !admin;
    $('kpi-saldo-bloco').hidden = !verDinheiro;
    $('kpi-minimo-bloco').hidden = !verEstoque;
    $('kpi-validade-bloco').hidden = !verEstoque;
    $('grafico-bloco').hidden = !verDinheiro;
    $('resumo').dataset.blocos = String($('resumo').querySelectorAll('.indicador:not([hidden])').length);
    // O saldo leva ao histórico; quem não tem histórico vê o número, mas sem link.
    if (!pode('historico')) $('kpi-saldo-bloco').removeAttribute('href');
    document.querySelectorAll('.lateral nav a[data-pagina]').forEach((a) => { a.hidden = !podeVerPagina(a.dataset.pagina); });
    $('filtro-area-rotulo').hidden = !(verEstoque && verDinheiro);

    const opcoes = [...form.elements.tipo];
    opcoes.forEach((r) => { r.disabled = !pode(r.value); r.closest('label').hidden = r.disabled; });
    opcoes.find((r) => !r.disabled).checked = true;
    form.querySelector('.tipos').dataset.opcoes = String(opcoes.filter((r) => !r.disabled).length);
  }

  // ---------- páginas ----------

  /*
   * Cada página tem o próprio endereço (#/estoque, #/historico...). Assim o botão Voltar do
   * celular funciona, e dá para salvar o atalho de uma página. As permissões ficam no acesso.js.
   */
  function mostrarPagina({ focar = true } = {}) {
    if (conferirSessao()) return;
    const { pagina, pedida } = paginaDoEndereco(location.hash);
    if (pedida) {
      $('sem-permissao-texto').textContent = `A página ${PAGINAS[pedida].rotulo} não faz parte do perfil ${PERFIS[conta.perfil].rotulo}. ` +
        'Se você precisa dela, peça ao administrador.';
    }
    document.querySelectorAll('.pagina').forEach((secao) => { secao.hidden = secao.dataset.pagina !== pagina; });
    document.querySelectorAll('.lateral nav a[data-pagina]').forEach((a) => {
      if (a.dataset.pagina === pagina) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    // No celular o menu rola para o lado: mantém a página aberta à vista.
    document.querySelector('.lateral nav a[aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const titulo = document.querySelector(`.pagina[data-pagina="${pagina}"] h1`);
    document.title = `${pagina === 'inicio' ? 'Visão geral' : titulo.textContent} | Casa Via Matris`;
    if (pagina === 'inicio') desenharGrafico(); // a largura só existe com a página visível
    // Leva o foco ao título: o leitor de tela anuncia a página nova, como num site comum.
    if (focar) { window.scrollTo(0, 0); titulo.focus({ preventScroll: true }); }
  }

  window.addEventListener('hashchange', () => mostrarPagina());

  // "Pular para o conteúdo" leva ao título da página aberta, sem trocar de página.
  document.querySelector('.pular').addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelector('.pagina:not([hidden]) h1')?.focus();
  });

  // Sai sem levar o endereço da página: a próxima pessoa começa na Visão geral, não em "Sem permissão".
  $('conta-sair').addEventListener('click', () => { sair(); location.replace(location.pathname); });
  $('conta-senha').addEventListener('click', () => { $('opcoes').open = false; abrirTrocaDeSenha(); });
  $('conta-codigo').addEventListener('click', () => { if (conferirSessao()) return; $('opcoes').open = false; abrirNovoCodigo(); });
  window.addEventListener('acesso-aviso', (e) => avisar(e.detail));

  // ---------- pessoas com acesso ----------

  function mostrarSenhaGerada(pessoa, senha) {
    $('senha-gerada-texto').textContent = `Senha provisória de ${pessoa}. Entregue pessoalmente. Ela não aparece de novo.`;
    $('senha-gerada-valor').textContent = senha;
    $('senha-gerada').hidden = false;
    $('senha-gerada-fechar').focus();
  }

  function desenharContas() {
    if (!pode('administrar')) return;
    const opcoesPerfil = (atual) => Object.entries(PERFIS).map(([valor, p]) => el('option', { value: valor, selected: valor === atual }, p.rotulo));
    $('lista-contas').replaceChildren(...listarContas().map((c) => el('li', { class: 'conta', 'data-codigo': c.codigo },
      el('div', {},
        el('strong', {}, c.nome),
        el('span', {}, c.email),
        c.bloqueada && el('span', { class: 'etiqueta saida_item' }, 'Bloqueada'),
        c.provisoria && el('span', { class: 'etiqueta doacao_item' }, 'Senha provisória'),
        !c.ativo && el('span', { class: 'etiqueta saida_item' }, 'Desativada'),
        // Quem aceitou os termos e quando: é a prova do aceite, caso a casa precise mostrar.
        c.termosAceitosEm
          ? el('span', { class: 'conta-termos' }, `Aceitou os termos em ${new Date(c.termosAceitosEm).toLocaleDateString('pt-BR')}`)
          : el('span', { class: 'etiqueta saida_item' }, 'Termos ainda não aceitos')),
      el('div', { class: 'conta-acoes' },
        el('label', {}, el('span', { class: 'visualmente-oculto' }, `Perfil de ${c.nome}`), el('select', { 'data-acao': 'perfil' }, opcoesPerfil(c.perfil))),
        c.codigo !== conta.codigo && el('button', { type: 'button', class: 'botao-fantasma', 'data-acao': 'senha' }, 'Gerar senha'),
        c.codigo !== conta.codigo && el('button', { type: 'button', class: 'botao-fantasma', 'data-acao': 'ativo' }, c.ativo ? 'Desativar' : 'Ativar')))));
    $('lista-auditoria').replaceChildren(...lerAuditoria().slice(0, 50).map((l) => el('li', {},
      el('time', { datetime: l.quando }, new Date(l.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })),
      ` ${[l.quem, l.acao, l.detalhe].filter(Boolean).join(': ')}`)));
  }

  // Tabela "o que cada perfil vê", montada das mesmas listas que as regras usam: nunca fica desatualizada.
  function desenharMatriz() {
    const linhas = [
      ['Visão geral', (p) => true],
      ['Saldo, gráfico e histórico do dinheiro', (p) => p.pode.includes('ver_financeiro')],
      ['Registrar entradas e despesas', (p) => p.pode.includes('entrada_dinheiro')],
      ['Estoque e validades', (p) => p.pode.includes('ver_estoque')],
      ['Registrar doações e saídas de itens', (p) => p.pode.includes('doacao_item')],
      ['Histórico', (p) => p.pode.includes('historico')],
      ['Desfazer movimentações', (p) => p.pode.includes('desfazer')],
      ['Acessos, backup e registro de atividades', (p) => p.pode.includes('administrar')],
    ];
    const perfis = Object.values(PERFIS);
    $('matriz-cabeca').replaceChildren(el('tr', {}, el('th', { scope: 'col' }, 'O que'), ...perfis.map((p) => el('th', { scope: 'col' }, p.rotulo))));
    $('matriz-corpo').replaceChildren(...linhas.map(([texto, tem]) => el('tr', {},
      el('th', { scope: 'row' }, texto),
      ...perfis.map((p) => el('td', { class: tem(p) ? 'sim' : 'nao' }, tem(p) ? 'Sim' : 'Não')))),
    el('tr', { class: 'matriz-resumo' }, el('th', { scope: 'row' }, 'Resumo'), ...perfis.map((p) => el('td', {}, p.resumo))));
  }

  $('c-perfil').replaceChildren(...Object.entries(PERFIS).map(([valor, p]) => el('option', { value: valor }, p.rotulo)));
  $('senha-gerada-fechar').addEventListener('click', () => { $('senha-gerada').hidden = true; });

  // Desliga o botão enquanto a senha é calculada (leva segundos em celular antigo): evita o toque duplo.
  async function comBotaoTravado(botao, tarefa) {
    if (botao) botao.disabled = true;
    try { return await tarefa(); } finally { if (botao) botao.disabled = false; }
  }

  $('form-conta').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (conferirSessao()) return;
    const dados = Object.fromEntries(new FormData(e.target));
    const r = await comBotaoTravado(e.target.querySelector('button[type=submit]'), () => criarConta(dados));
    $('erro-conta').textContent = r.ok ? '' : r.erro;
    if (!r.ok) return;
    e.target.reset();
    desenharContas();
    mostrarSenhaGerada(dados.nome, r.senhaProvisoria);
  });

  $('lista-contas').addEventListener('click', async (e) => {
    const acao = e.target.closest('button[data-acao]')?.dataset.acao;
    if (!acao || conferirSessao()) return;
    const codigo = e.target.closest('.conta').dataset.codigo;
    const pessoa = listarContas().find((c) => c.codigo === codigo);
    if (acao === 'senha') {
      const r = await comBotaoTravado(e.target.closest('button'), () => redefinirSenhaDe(codigo));
      desenharContas();
      if (r.ok) mostrarSenhaGerada(pessoa.nome, r.senhaProvisoria); else avisar(r.erro);
      return;
    }
    const r = alterarConta(codigo, { ativo: !pessoa.ativo });
    if (!r.ok) avisar(r.erro);
    desenharContas();
  });

  $('lista-contas').addEventListener('change', (e) => {
    if (e.target.dataset.acao !== 'perfil' || conferirSessao()) return;
    const codigo = e.target.closest('.conta').dataset.codigo;
    const r = alterarConta(codigo, { perfil: e.target.value });
    if (!r.ok) avisar(r.erro);
    // Mudou o próprio perfil: recarrega para o menu e as páginas seguirem o perfil novo.
    if (r.ok && codigo === conta.codigo) { location.reload(); return; }
    desenharContas();
  });

  // Garante o idioma certo para leitores de tela também quando a página é hospedada dentro de outra estrutura.
  document.documentElement.lang = 'pt-BR';
  $('versao').textContent = VERSAO;
  aplicarPerfil();
  if (pode('administrar')) desenharMatriz();
  mostrarPagina({ focar: false });
  atualizarData();

  // O navegador da Samsung gera o próprio pacote do app, e o Play Protect do Android bloqueia
  // esse pacote como "versão antiga". O site não controla isso; pelo Chrome a instalação passa.
  const noNavegadorSamsung = /Android.*SamsungBrowser/.test(navigator.userAgent);
  $('faixa-samsung').hidden = !noNavegadorSamsung || matchMedia('(display-mode: standalone)').matches;
  $('abrir-chrome').href = `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(location.href)};end`;

  // No celular o app volta do segundo plano sem recarregar, às vezes dias depois.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { conferirSessao(); atualizarData(); } });
  // Aparelho que fica ligado o dia todo: a data vira à meia-noite sem ninguém tocar na tela.
  setInterval(atualizarData, 60000);

  pedirArmazenamentoPersistente();
})();
