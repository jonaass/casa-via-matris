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

  const { criarStore, TIPOS, CATEGORIAS, DIAS_ALERTA_VALIDADE } = window.ViaMatris;
  const store = criarStore({ permitir: pode });
  const conta = contaAtual();

  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
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

    $('kpi-doacoes').textContent = r.doacoesItens + r.doacoesDinheiro;
    $('kpi-doacoes-nota').textContent = `${r.doacoesItens} de itens, ${r.doacoesDinheiro} em dinheiro`;
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
    if (!ultimoId) return;
    const r = store.estornar(ultimoId);
    if (r.ok) registrarAuditoria('Desfez uma movimentação');
    atualizarTudo();
    avisar(r.ok ? 'Movimentação desfeita.' : r.erro);
  });

  // ---------- histórico ----------

  const LIMITE_HISTORICO = 50;

  function desenharHistorico() {
    const area = $('filtro-historico').value;
    const todos = store.movimentos()
      .filter((m) => pode(`ver_${TIPOS[m.tipo].area}`))
      .filter((m) => !area || TIPOS[m.tipo].area === area)
      .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm.localeCompare(a.criadoEm));
    const movs = todos.slice(0, LIMITE_HISTORICO);
    // Sem este aviso, a movimentação mais antiga some da tabela e parece ter sido apagada.
    $('historico-limite').hidden = todos.length <= LIMITE_HISTORICO;
    $('historico-limite').textContent = `Mostrando as ${LIMITE_HISTORICO} mais recentes de ${todos.length} movimentações.`;

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

      return el('tr', {},
        el('td', {}, el('time', { datetime: m.data }, dataCurta(m.data))),
        el('td', {}, el('span', { class: `etiqueta ${m.tipo}` }, tipo.rotulo)),
        el('td', {}, detalhe || '—'),
        el('td', {}, m.pessoa || '—'),
        el('td', { class: `num ${tipo.sinal > 0 ? 'positivo' : 'negativo'}` }, valor),
        el('td', { class: 'acao' }, pode('desfazer') && el('button', {
          type: 'button',
          class: 'botao-fantasma',
          'data-codigo': m.codigo,
          'aria-label': `${pedindoConfirmacao === m.codigo ? 'Confirmar: desfazer' : 'Desfazer'} ${tipo.rotulo}, ${valor}, ${dataCurta(m.data)}`,
        }, pedindoConfirmacao === m.codigo ? 'Confirmar' : 'Desfazer')));
    }));
    $('historico-vazio').hidden = movs.length > 0;
  }

  // Dois toques: o primeiro pede confirmação na própria linha, o segundo desfaz.
  let pedindoConfirmacao = null;

  $('corpo-historico').addEventListener('click', (e) => {
    const botao = e.target.closest('button[data-codigo]');
    if (!botao) return;
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
    if (!pode('administrar')) return;
    const r = await baixarTodasAsPlanilhas();
    if (r.ok) registrarAuditoria('Baixou as planilhas');
    desenharBackup();
    avisar(r.ok ? 'Confira na pasta Downloads se chegaram as 3 planilhas e guarde-as fora deste aparelho.' : r.erros.join(' '));
  }

  $('backup-baixar').addEventListener('click', fazerBackup);
  $('faixa-backup-baixar').addEventListener('click', fazerBackup);
  $('backup-restaurar').addEventListener('click', () => $('backup-arquivo').click());
  $('backup-arquivo').addEventListener('change', async (e) => {
    if (!pode('administrar')) return;
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
    desenharDespensa();
    ajustarCampos();
    desenharHistorico();
    desenharBackup();
    desenharContas();
  }

  // ---------- perfil e conta ----------

  // Sessão vencida ou conta desativada: volta para o login, limpando a tela.
  function conferirSessao() {
    if (contaAtual()?.codigo !== conta?.codigo) location.reload();
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
    $('resumo').dataset.blocos = String($('resumo').querySelectorAll('.indicador:not([hidden])').length);
    $('despensa').hidden = !verEstoque;
    $('historico').hidden = !pode('historico');
    $('usuarios').hidden = !admin;
    $('link-usuarios').hidden = !admin;
    document.querySelector('.grade').classList.toggle('so-registro', !verEstoque);
    document.querySelector('.lateral nav a[href="#despensa"]').hidden = !verEstoque;
    document.querySelector('.lateral nav a[href="#historico"]').hidden = !pode('historico');
    $('filtro-historico').closest('label').hidden = !(verEstoque && verDinheiro);

    const opcoes = [...form.elements.tipo];
    opcoes.forEach((r) => { r.disabled = !pode(r.value); r.closest('label').hidden = r.disabled; });
    opcoes.find((r) => !r.disabled).checked = true;
    $('f-enviar').closest('form').querySelector('.tipos').dataset.opcoes = String(opcoes.filter((r) => !r.disabled).length);
  }

  $('conta-sair').addEventListener('click', () => { sair(); location.reload(); });
  $('conta-senha').addEventListener('click', () => { $('opcoes').open = false; abrirTrocaDeSenha(); });
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
        !c.ativo && el('span', { class: 'etiqueta saida_item' }, 'Desativada')),
      el('div', { class: 'conta-acoes' },
        el('label', {}, el('span', { class: 'visualmente-oculto' }, `Perfil de ${c.nome}`), el('select', { 'data-acao': 'perfil' }, opcoesPerfil(c.perfil))),
        c.codigo !== conta.codigo && el('button', { type: 'button', class: 'botao-fantasma', 'data-acao': 'senha' }, 'Gerar senha'),
        c.codigo !== conta.codigo && el('button', { type: 'button', class: 'botao-fantasma', 'data-acao': 'ativo' }, c.ativo ? 'Desativar' : 'Ativar')))));
    $('lista-auditoria').replaceChildren(...lerAuditoria().slice(0, 50).map((l) => el('li', {},
      el('time', { datetime: l.quando }, new Date(l.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })),
      ` ${[l.quem, l.acao, l.detalhe].filter(Boolean).join(': ')}`)));
  }

  $('c-perfil').replaceChildren(...Object.entries(PERFIS).map(([valor, p]) => el('option', { value: valor }, p.rotulo)));
  $('senha-gerada-fechar').addEventListener('click', () => { $('senha-gerada').hidden = true; });

  $('form-conta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(e.target));
    const r = await criarConta(dados);
    $('erro-conta').textContent = r.ok ? '' : r.erro;
    if (!r.ok) return;
    e.target.reset();
    desenharContas();
    mostrarSenhaGerada(dados.nome, r.senhaProvisoria);
  });

  $('lista-contas').addEventListener('click', async (e) => {
    const acao = e.target.closest('button[data-acao]')?.dataset.acao;
    if (!acao) return;
    const codigo = e.target.closest('.conta').dataset.codigo;
    const pessoa = listarContas().find((c) => c.codigo === codigo);
    if (acao === 'senha') {
      const r = await redefinirSenhaDe(codigo);
      desenharContas();
      if (r.ok) mostrarSenhaGerada(pessoa.nome, r.senhaProvisoria); else avisar(r.erro);
      return;
    }
    const r = alterarConta(codigo, { ativo: !pessoa.ativo });
    if (!r.ok) avisar(r.erro);
    desenharContas();
  });

  $('lista-contas').addEventListener('change', (e) => {
    if (e.target.dataset.acao !== 'perfil') return;
    const r = alterarConta(e.target.closest('.conta').dataset.codigo, { perfil: e.target.value });
    if (!r.ok) avisar(r.erro);
    desenharContas();
  });

  // Garante o idioma certo para leitores de tela também quando a página é hospedada dentro de outra estrutura.
  document.documentElement.lang = 'pt-BR';
  $('versao').textContent = VERSAO;
  aplicarPerfil();
  atualizarData();

  // O navegador da Samsung gera o próprio pacote do app, e o Play Protect do Android bloqueia
  // esse pacote como "versão antiga". O site não controla isso; pelo Chrome a instalação passa.
  const noNavegadorSamsung = /Android.*SamsungBrowser/.test(navigator.userAgent);
  $('faixa-samsung').hidden = !noNavegadorSamsung || matchMedia('(display-mode: standalone)').matches;
  $('abrir-chrome').href = `intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(location.href)};end`;

  // No celular o app volta do segundo plano sem recarregar, às vezes dias depois.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { conferirSessao(); atualizarData(); } });

  pedirArmazenamentoPersistente();
})();
