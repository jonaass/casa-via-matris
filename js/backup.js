/*
 * backup.js — Miguel
 *
 * Planilhas de backup, uma por coleção:
 *   via-matris-estoque-AAAA-MM-DD.csv   → os itens da despensa (coleção "itens")
 *   via-matris-doacoes-AAAA-MM-DD.csv   → doações que chegaram e itens que saíram ("doacoes")
 *   via-matris-dinheiro-AAAA-MM-DD.csv  → entradas e despesas ("dinheiro")
 * Formato CSV separado por ponto e vírgula, que o Excel e o Google Planilhas
 * em português abrem direto, com acentos certos.
 *
 * Na planilha os valores ficam como a pessoa lê: data "29/10/2026", valor "50,99", tipo "Despesa".
 * No celular continuam como o dados.js guarda: "2026-10-29", 5099 (centavos), "saida_dinheiro".
 *
 * Para restaurar tudo, importe primeiro o estoque: as doações apontam para os itens dele.
 *
 * Precisa, carregados antes: utilitarios.js, dados.js e store.js
 * (deste usa textoParaCentavos, centavosParaTexto, gerarCodigo e QUANTIDADE_MAXIMA).
 */
(function () {
  'use strict';

  /*
   * Colunas de cada planilha, na ordem em que aparecem.
   *   campo:  nome do campo no registro (igual ao do front e das Regras)
   *   titulo: cabeçalho da coluna na planilha
   *   tipo:   "texto", "data", "centavos" ou "numero"
   *   obrigatorio: a linha é recusada se vier vazio
   *   aceitaZero:  para "numero"; sem isso, só aceita maior que zero
   *   opcoes: { valorGuardado: "Como aparece na planilha" }. Na importação vale qualquer um dos dois,
   *           sem ligar para maiúscula ou acento.
   *   soLeitura: coluna que só ajuda quem lê a planilha (vem de outra coleção); a importação ignora
   *   max: tamanho máximo do texto (os mesmos limites do formulário)
   *   ateHoje: para "data"; recusa data no futuro, como o formulário
   */
  const COLUNAS = {
    itens: [
      { campo: 'codigo', titulo: 'Código', tipo: 'texto', max: 40 },
      { campo: 'nome', titulo: 'Item', tipo: 'texto', obrigatorio: true, max: 60 },
      {
        campo: 'categoria', titulo: 'Categoria', tipo: 'texto', obrigatorio: true,
        opcoes: { Alimentos: 'Alimentos', Higiene: 'Higiene', Limpeza: 'Limpeza' }
      },
      { campo: 'unidade', titulo: 'Unidade', tipo: 'texto', obrigatorio: true, max: 10 },
      { campo: 'quantidade', titulo: 'Quantidade em estoque', tipo: 'numero', obrigatorio: true, aceitaZero: true },
      { campo: 'minimo', titulo: 'Estoque mínimo', tipo: 'numero', aceitaZero: true },
      { campo: 'validade', titulo: 'Validade mais próxima', tipo: 'data' },
    ],
    doacoes: [
      { campo: 'codigo', titulo: 'Código', tipo: 'texto', max: 40 },
      { campo: 'data', titulo: 'Data', tipo: 'data', obrigatorio: true, ateHoje: true },
      {
        campo: 'tipo', titulo: 'Movimento', tipo: 'texto', obrigatorio: true,
        opcoes: { doacao_item: 'Doação', saida_item: 'Saída' }
      },
      { campo: 'itemId', titulo: 'Código do item', tipo: 'texto', max: 40 },
      { campo: 'nomeDoItem', titulo: 'Item', tipo: 'texto', soLeitura: true },
      { campo: 'quantidade', titulo: 'Quantidade', tipo: 'numero', obrigatorio: true },
      { campo: 'unidadeDoItem', titulo: 'Unidade', tipo: 'texto', soLeitura: true },
      { campo: 'pessoa', titulo: 'Quem doou / para onde foi', tipo: 'texto', max: 80 },
      { campo: 'descricao', titulo: 'Observação', tipo: 'texto', max: 120 },
    ],
    dinheiro: [
      { campo: 'codigo', titulo: 'Código', tipo: 'texto', max: 40 },
      { campo: 'data', titulo: 'Data', tipo: 'data', obrigatorio: true, ateHoje: true },
      {
        campo: 'tipo', titulo: 'Movimento', tipo: 'texto', obrigatorio: true,
        opcoes: { entrada_dinheiro: 'Entrada', saida_dinheiro: 'Despesa' }
      },
      { campo: 'valorCentavos', titulo: 'Valor (R$)', tipo: 'centavos', obrigatorio: true },
      { campo: 'descricao', titulo: 'Descrição', tipo: 'texto', obrigatorio: true, max: 120 },
      { campo: 'pessoa', titulo: 'Quem', tipo: 'texto', max: 80 },
    ],
  };

  // Nome que aparece no arquivo e nas mensagens.
  const NOMES = { itens: 'estoque', doacoes: 'doacoes', dinheiro: 'dinheiro' };
  const NOMES_LEGIVEIS = { itens: 'estoque', doacoes: 'doações', dinheiro: 'dinheiro' };
  // Ordem certa para baixar e restaurar: o estoque vem antes das doações.
  const ORDEM = ['itens', 'doacoes', 'dinheiro'];

  const SEPARADOR = ';';
  const BOM = '﻿'; // avisa o Excel que o arquivo é UTF-8; sem ele os acentos viram "Ã§"
  const TAMANHO_MAXIMO_ARQUIVO = 5 * 1024 * 1024; // o localStorage guarda cerca de 5 MB; maior que isso nem cabe

  function colunasDe(colecao) {
    const colunas = COLUNAS[colecao];
    if (!colunas) throw new Error(`Coleção desconhecida: "${colecao}". Use ${ORDEM.map((c) => `"${c}"`).join(', ')}.`);
    return colunas;
  }

  // "Descrição " → "descricao": compara cabeçalhos e opções sem ligar para acento, maiúscula ou espaço.
  function simplificar(texto) {
    return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // ---------- gerar ----------

  /*
   * Um texto começando com = + - @ seria lido pelo Excel como fórmula
   * (ex.: um doador chamado "=HIPERLINK(...)"). O apóstrofo na frente faz virar texto.
   */
  function protegerFormula(texto) {
    return /^[=+\-@\t\r]/.test(texto) ? "'" + texto : texto;
  }

  function celulaCsv(texto) {
    const s = protegerFormula(String(texto));
    // A vírgula seguida de fórmula também vai entre aspas: num Excel que separa colunas por
    // vírgula, o que vem depois dela viraria outra célula, e a fórmula seria executada.
    return /[";\r\n]|^\s|\s$|,\s*[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function valorParaCelula(coluna, valor) {
    if (valor == null || valor === '') return '';
    if (coluna.opcoes) return coluna.opcoes[valor] ?? String(valor);
    if (coluna.tipo === 'data') return dataParaTexto(valor);
    if (coluna.tipo === 'centavos') return centavosParaTexto(valor);
    if (coluna.tipo === 'numero') return String(valor).replace('.', ',');
    return String(valor);
  }

  /** Texto da planilha (CSV) com todos os registros da coleção. */
  function gerarPlanilha(colecao) {
    const colunas = colunasDe(colecao);
    let registros = lerTudo(colecao);

    if (colecao === 'itens') {
      registros.sort((a, b) => String(a.categoria).localeCompare(String(b.categoria)) ||
        String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    } else {
      registros.sort((a, b) => String(a.data).localeCompare(String(b.data)) ||
        String(a.criadoEm ?? '').localeCompare(String(b.criadoEm ?? '')));
    }
    if (colecao === 'doacoes') {
      // Nome e unidade vêm do estoque, só para a planilha ficar legível.
      const itens = new Map(lerTudo('itens').map((i) => [i.codigo, i]));
      registros = registros.map((r) => ({
        ...r,
        nomeDoItem: itens.get(r.itemId)?.nome ?? '(item apagado)',
        unidadeDoItem: itens.get(r.itemId)?.unidade ?? '',
      }));
    }

    const linhas = [colunas.map((c) => celulaCsv(c.titulo)).join(SEPARADOR)];
    for (const r of registros) {
      linhas.push(colunas.map((c) => celulaCsv(valorParaCelula(c, r[c.campo]))).join(SEPARADOR));
    }
    return linhas.join('\r\n') + '\r\n';
  }

  /*
   * Entrega o arquivo para a pessoa salvar, com o download normal do navegador.
   */
  async function entregarArquivo(nomeDoArquivo, texto) {
    const arquivo = new Blob([texto], { type: 'text/csv;charset=utf-8' });
    const endereco = URL.createObjectURL(arquivo);
    const link = document.createElement('a');
    link.href = endereco;
    link.download = nomeDoArquivo;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(endereco), 60000);
  }

  /**
   * Baixa a planilha da coleção para o celular (pasta Downloads) e anota a data do backup.
   * Devolve uma Promise: { ok: true, nomeDoArquivo } ou { ok: false, erros: [...] }.
   *   const r = await baixarPlanilha('dinheiro');
   */
  /*
   * Baixar e restaurar planilhas é só do administrador: elas juntam estoque e dinheiro.
   * A tela já esconde os botões, mas a regra vale aqui também. O typeof deixa os testes
   * deste arquivo rodarem sem o acesso.js.
   */
  const SO_ADMIN = 'Só o administrador pode baixar ou restaurar planilhas.';
  const negado = () => typeof globalThis.pode === 'function' && !globalThis.pode('administrar');

  async function baixarPlanilha(colecao) {
    if (negado()) return { ok: false, erros: [SO_ADMIN] };
    colunasDe(colecao);
    const nomeDoArquivo = `via-matris-${NOMES[colecao]}-${dataDeHoje()}.csv`;
    try {
      await entregarArquivo(nomeDoArquivo, BOM + gerarPlanilha(colecao));
    } catch (e) {
      console.error(e);
      return { ok: false, erros: [`Não foi possível baixar a planilha de ${NOMES_LEGIVEIS[colecao]}. Tente de novo.`] };
    }
    const ultimoBackup = { ...(lerConfig().ultimoBackup || {}), [colecao]: dataDeHoje() };
    salvarConfig({ ultimoBackup });
    return { ok: true, nomeDoArquivo };
  }

  /**
   * Baixa as três planilhas, uma depois da outra (estoque, doações, dinheiro).
   * Para um botão "Fazer backup" só. Devolve { ok, arquivos: [...], erros: [...] }.
   */
  async function baixarTodasAsPlanilhas() {
    const resultado = { ok: true, arquivos: [], erros: [] };
    for (const colecao of ORDEM) {
      // Downloads em sequência imediata fazem o navegador bloquear do segundo em diante.
      if (resultado.arquivos.length) await new Promise((pronto) => setTimeout(pronto, 500));
      const r = await baixarPlanilha(colecao);
      if (r.ok) resultado.arquivos.push(r.nomeDoArquivo);
      else { resultado.ok = false; resultado.erros.push(...r.erros); }
    }
    return resultado;
  }

  // ---------- importar ----------

  /** Lê um CSV em linhas e células. Entende aspas, ";" ou "," ou tab como separador e quebras de linha dentro de aspas. */
  function lerCsv(texto) {
    const s = String(texto ?? '').replace(new RegExp('^' + BOM), '');
    const primeiraLinha = s.split(/\r?\n/, 1)[0];
    const separador = [';', '\t', ','].find((c) => primeiraLinha.includes(c)) || ';';

    const linhas = [];
    let linha = [];
    let celula = '';
    let entreAspas = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (entreAspas) {
        if (c === '"' && s[i + 1] === '"') { celula += '"'; i++; }
        else if (c === '"') entreAspas = false;
        else celula += c;
      } else if (c === '"') entreAspas = true;
      else if (c === separador) { linha.push(celula); celula = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        linha.push(celula); linhas.push(linha); linha = []; celula = '';
      } else celula += c;
    }
    if (celula !== '' || linha.length) { linha.push(celula); linhas.push(linha); }
    return linhas;
  }

  // "1.234,5" → 1234.5 e "2.5" → 2.5. Devolve NaN se não for número.
  function textoParaNumero(texto) {
    let s = texto.replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return /^\d+(\.\d+)?$/.test(s) ? Math.round(Number(s) * 1000) / 1000 : NaN;
  }

  // Converte uma célula para o formato guardado. Devolve { valor } ou { erro }.
  function celulaParaValor(coluna, celula) {
    const texto = celula.trim().replace(/^'(?=[=+\-@\t\r])/, '');
    if (texto === '') return coluna.obrigatorio ? { erro: `Falta preencher ${coluna.titulo}` } : { valor: '' };

    if (coluna.opcoes) {
      const certa = Object.entries(coluna.opcoes)
        .find(([guardado, rotulo]) => simplificar(guardado) === simplificar(texto) || simplificar(rotulo) === simplificar(texto));
      return certa
        ? { valor: certa[0] }
        : { erro: `${coluna.titulo} "${texto}" não existe (use: ${Object.values(coluna.opcoes).join(', ')})` };
    }
    if (coluna.tipo === 'data') {
      const data = textoParaData(texto);
      if (!data) return { erro: `${coluna.titulo} inválida ("${texto}"), use DD/MM/AAAA` };
      return coluna.ateHoje && data > dataDeHoje() ? { erro: `${coluna.titulo} no futuro ("${texto}")` } : { valor: data };
    }
    if (coluna.tipo === 'centavos') {
      const centavos = textoParaCentavos(texto);
      return Number.isSafeInteger(centavos) && centavos > 0
        ? { valor: centavos }
        : { erro: `${coluna.titulo} inválido ("${texto}"), use por exemplo 150,00` };
    }
    if (coluna.tipo === 'numero') {
      const numero = textoParaNumero(texto);
      const minimoOk = coluna.aceitaZero ? numero >= 0 : numero > 0;
      return Number.isFinite(numero) && minimoOk && numero <= QUANTIDADE_MAXIMA
        ? { valor: numero }
        : { erro: `${coluna.titulo} inválido(a) ("${texto}")` };
    }
    if (coluna.max && texto.length > coluna.max) {
      return { erro: `${coluna.titulo} passa de ${coluna.max} caracteres` };
    }
    return { valor: texto };
  }

  /*
   * Doações apontam para um item do estoque. Acha pelo "Código do item";
   * sem ele (planilha feita à mão, ou o aparelho já tem o item com outro código), acha pelo nome.
   */
  function ligarAoItem(registro, nomeNaPlanilha, itens) {
    if (registro.itemId && itens.some((i) => i.codigo === registro.itemId)) return null;

    const nome = simplificar(nomeNaPlanilha);
    const achado = nome && itens.find((i) => simplificar(i.nome) === nome);
    if (!achado) {
      if (registro.itemId) return `o item de código "${registro.itemId}" não está no estoque. Importe antes a planilha de estoque`;
      return nomeNaPlanilha
        ? `o item "${nomeNaPlanilha.trim()}" não está no estoque. Importe antes a planilha de estoque`
        : 'Falta preencher Código do item ou Item';
    }
    registro.itemId = achado.codigo;
    return null;
  }

  /**
   * Traz para o app os registros de uma planilha (o texto do arquivo CSV).
   * Registros com código que já existe no celular são ignorados, então importar
   * o mesmo backup duas vezes não duplica nada.
   *
   * Devolve { ok, importados, ignorados, erros }:
   *   ok: false só quando o arquivo inteiro não serve (vazio ou de outra coleção);
   *   importados/ignorados: quantos registros entraram / já existiam;
   *   erros: mensagens das linhas recusadas, ex.: "Linha 5: Data inválida...".
   *
   * Para ler o arquivo escolhido: const texto = await input.files[0].text();
   */
  function importarPlanilha(colecao, texto) {
    const colunas = colunasDe(colecao);
    const resultado = { ok: false, importados: 0, ignorados: 0, erros: [] };
    if (negado()) { resultado.erros.push(SO_ADMIN); return resultado; }

    const linhas = lerCsv(texto);
    if (linhas.length === 0) {
      resultado.erros.push('O arquivo está vazio.');
      return resultado;
    }

    // Descobre em que posição está cada coluna, pelo título (ou pelo nome do campo).
    const cabecalho = linhas[0].map(simplificar);
    const posicao = {};
    for (const c of colunas) {
      const i = cabecalho.findIndex((h) => h === simplificar(c.titulo) || h === simplificar(c.campo));
      if (i >= 0) posicao[c.campo] = i;
    }
    const faltando = colunas.filter((c) => c.obrigatorio && !(c.campo in posicao)).map((c) => c.titulo);
    if (faltando.length) {
      resultado.erros.push(`Esta não é a planilha de ${NOMES_LEGIVEIS[colecao]}. ` +
        `Faltam as colunas: ${faltando.join(', ')}. Confira se escolheu o arquivo certo.`);
      return resultado;
    }

    resultado.ok = true;
    const codigosExistentes = new Set(lerTudo(colecao).map((r) => r.codigo));
    const itens = colecao === 'doacoes' ? lerTudo('itens') : null;
    // O app não deixa ter dois itens com o mesmo nome; numa planilha feita à mão, sem Código,
    // o nome é o que identifica o item.
    const nomesExistentes = colecao === 'itens' ? new Set(lerTudo('itens').map((i) => simplificar(i.nome))) : null;
    const novos = [];

    for (let n = 1; n < linhas.length; n++) {
      const celulas = linhas[n];
      if (celulas.every((c) => c.trim() === '')) continue; // linha em branco

      const registro = {};
      const problemas = [];
      for (const c of colunas) {
        if (c.soLeitura || !(c.campo in posicao)) continue;
        const { valor, erro } = celulaParaValor(c, celulas[posicao[c.campo]] ?? '');
        if (erro) problemas.push(erro);
        else if (valor !== '') registro[c.campo] = valor;
      }
      if (itens) {
        const nome = 'nomeDoItem' in posicao ? celulas[posicao.nomeDoItem] ?? '' : '';
        const problema = ligarAoItem(registro, nome, itens);
        if (problema) problemas.push(problema);
      }
      if (problemas.length) {
        resultado.erros.push(`Linha ${n + 1}: ${problemas.join('; ')}.`);
        continue;
      }

      if (!registro.codigo) registro.codigo = gerarCodigo();
      if (codigosExistentes.has(registro.codigo)) {
        resultado.ignorados++;
        continue;
      }
      if (nomesExistentes && nomesExistentes.has(simplificar(registro.nome))) {
        resultado.ignorados++;
        continue;
      }
      if (colecao !== 'itens') registro.criadoEm = new Date().toISOString();
      if (colecao === 'itens' && !('minimo' in registro)) registro.minimo = 0;
      if (colecao === 'itens' && !registro.validade) registro.validade = null;

      novos.push(registro);
      codigosExistentes.add(registro.codigo);
      if (nomesExistentes) nomesExistentes.add(simplificar(registro.nome));
    }

    // Grava tudo de uma vez: ou a planilha entra inteira, ou nada muda.
    if (novos.length) {
      const salvo = substituirColecao(colecao, [...lerTudo(colecao), ...novos]);
      if (!salvo.ok) {
        resultado.ok = false;
        resultado.erros.push(`Nada foi importado desta planilha. ${salvo.erros.join(' ')}`);
        return resultado;
      }
      resultado.importados = novos.length;
    }
    return resultado;
  }

  /*
   * Excel em português salva "CSV" em Windows-1252, não em UTF-8. Lido como UTF-8, "Descrição"
   * vira lixo e a planilha é recusada. Por isso tenta UTF-8 e, se os bytes não forem válidos, usa o outro.
   */
  async function lerArquivo(arquivo) {
    const bytes = await arquivo.arrayBuffer();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  // Reconhece a planilha pelo cabeçalho, para funcionar mesmo com o arquivo renomeado.
  function descobrirColecao(texto) {
    const cabecalho = (lerCsv(texto)[0] ?? []).map(simplificar);
    return ORDEM.find((c) => colunasDe(c).filter((col) => col.obrigatorio)
      .every((col) => cabecalho.includes(simplificar(col.titulo)) || cabecalho.includes(simplificar(col.campo)))) ?? null;
  }

  /**
   * Restaura os arquivos escolhidos (um ou os três juntos), sempre na ordem certa:
   * o estoque antes das doações. Devolve { ok, importados, ignorados, erros }.
   * antesDeGravar: chamada uma vez, só depois de achar ao menos uma planilha válida.
   */
  async function restaurarArquivos(arquivos, antesDeGravar) {
    const resultado = { ok: false, importados: 0, ignorados: 0, erros: [] };
    if (negado()) { resultado.erros.push(SO_ADMIN); return resultado; }
    const planilhas = [];
    for (const arquivo of arquivos) {
      if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO) {
        resultado.erros.push(`${arquivo.name} é grande demais para ser uma planilha do app.`);
        continue;
      }
      const texto = await lerArquivo(arquivo);
      const colecao = descobrirColecao(texto);
      if (colecao) planilhas.push({ colecao, texto });
      else resultado.erros.push(`${arquivo.name} não é uma planilha do app.`);
    }
    if (!planilhas.length) return resultado;

    if (antesDeGravar) antesDeGravar();
    planilhas.sort((a, b) => ORDEM.indexOf(a.colecao) - ORDEM.indexOf(b.colecao));
    for (const { colecao, texto } of planilhas) {
      const r = importarPlanilha(colecao, texto);
      resultado.ok = resultado.ok || r.ok;
      resultado.importados += r.importados;
      resultado.ignorados += r.ignorados;
      resultado.erros.push(...r.erros);
    }
    return resultado;
  }

  /**
   * Quantos dias faz desde o último backup.
   *   diasDesdeUltimoBackup("dinheiro") → só daquela planilha;
   *   diasDesdeUltimoBackup() → a mais atrasada das três.
   * Devolve null se ainda não houve backup (a tela pode avisar "nunca fez backup").
   */
  function diasDesdeUltimoBackup(colecao) {
    if (colecao) colunasDe(colecao);
    const datas = lerConfig().ultimoBackup || {};
    const lista = colecao ? [datas[colecao]] : ORDEM.map((c) => datas[c]);
    if (lista.some((d) => !d)) return null;
    return 0 - Math.min(...lista.map(diasAte)); // "0 -" e não "-": evita devolver -0
  }

  // Só estes nomes ficam visíveis para os outros arquivos.
  Object.assign(globalThis, {
    gerarPlanilha, baixarPlanilha, baixarTodasAsPlanilhas, importarPlanilha, restaurarArquivos, diasDesdeUltimoBackup,
  });
})();
