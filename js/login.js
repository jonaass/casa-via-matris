/*
 * login.js — a tela de acesso. As regras ficam no acesso.js.
 *
 * O app.js só é carregado depois da entrada: sem sessão, nada do painel é desenhado.
 * Sair recarrega a página, o que limpa tudo o que estava na tela.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const form = $('form-acesso');
  const TEMPO_ENTRADA = 900;

  const MODOS = {
    primeiro: {
      titulo: 'Crie a conta do administrador',
      apoio: 'É o primeiro acesso neste aparelho. Com esta conta, você cadastra as outras pessoas da equipe.',
      campos: ['nome', 'email', 'nova', 'confirmar', 'termos'],
      botao: 'Criar conta',
    },
    entrar: {
      titulo: 'Boas-vindas',
      apoio: 'Entre para ver como está a casa hoje.',
      campos: ['email', 'senha', 'opcoes'],
      botao: 'Entrar',
    },
    // Dois caminhos: a equipe não tem código e só precisa saber a quem pedir; o administrador usa o código.
    esqueci: {
      titulo: 'Recuperar o acesso',
      apoio: 'Se você é da equipe, peça ao administrador uma senha provisória (ele gera na página Acessos, em "Gerar senha"). ' +
        'Se você é o administrador, use o código de recuperação que anotou ao criar a conta.',
      campos: [],
      botao: 'Sou o administrador e tenho o código',
      voltar: 'Voltar para a entrada',
    },
    recuperar: {
      titulo: 'Recuperar com o código',
      apoio: 'Informe o seu e-mail, o código de recuperação e uma senha nova. Depois, você recebe um código novo para guardar.',
      campos: ['email', 'codigo', 'nova', 'confirmar'],
      botao: 'Trocar senha',
      voltar: 'Voltar para a entrada',
    },
    provisoria: {
      titulo: 'Crie a sua senha',
      apoio: 'A senha que você recebeu vale só para o primeiro acesso.',
      campos: ['nova', 'confirmar', 'termos'],
      botao: 'Salvar senha e entrar',
      voltar: 'Voltar para a entrada',
    },
    trocar: {
      titulo: 'Trocar senha',
      apoio: 'Confirme a senha atual e escolha uma nova.',
      campos: ['senha', 'nova', 'confirmar'],
      botao: 'Salvar nova senha',
      voltar: 'Cancelar',
    },
    termos: {
      titulo: 'Termos de uso e privacidade',
      apoio: 'Antes de continuar, leia os termos. Eles explicam onde os dados ficam, o que não pode ser registrado e quem responde por quê.',
      campos: ['termos'],
      botao: 'Aceitar e entrar',
      voltar: 'Voltar para a entrada',
    },
    codigo: {
      titulo: 'Novo código de recuperação',
      apoio: 'Confirme a sua senha. O código antigo deixa de valer, e o novo aparece uma vez só.',
      campos: ['senha'],
      botao: 'Gerar código',
      voltar: 'Cancelar',
    },
  };

  let modo = 'entrar';
  let provisoria = null; // e-mail e senha digitados, guardados até a nova senha ser criada ou os termos aceitos

  function mostrarErro(msg) {
    $('acesso-erro').textContent = msg;
    if (!msg) return;
    const miolo = $('acesso-miolo');
    miolo.classList.remove('treme');
    void miolo.offsetWidth; // reinicia a animação, mesmo com o mesmo erro duas vezes
    miolo.classList.add('treme');
  }

  function irPara(novo) {
    modo = novo;
    const m = MODOS[novo];
    $('acesso-titulo').textContent = m.titulo;
    // Com o servidor da casa, o código só troca a senha do aparelho: avisa antes, não depois.
    const avisoServidor = novo === 'recuperar' && typeof modoServidor === 'function' && modoServidor()
      ? ' Atenção: o código troca só a senha deste aparelho. Antes, peça a quem cuida do servidor da casa para pôr lá a mesma senha nova; senão o servidor não deixa entrar.'
      : '';
    $('acesso-apoio').textContent = m.apoio + avisoServidor;
    $('a-enviar').textContent = m.botao;
    $('a-voltar').hidden = !m.voltar;
    $('a-voltar').textContent = m.voltar ?? '';
    $('acesso-guardar').hidden = true;
    form.hidden = false;
    form.querySelectorAll('[data-campo]').forEach((bloco) => {
      const visivel = m.campos.includes(bloco.dataset.campo);
      bloco.hidden = !visivel;
      bloco.querySelectorAll('input').forEach((c) => { c.disabled = !visivel; });
    });
    $('a-aceite').checked = false; // o aceite é sempre um gesto novo, nunca vem marcado
    form.querySelectorAll('input:not([type=checkbox])').forEach((c) => {
      if (c.id !== 'a-email' || novo === 'primeiro') c.value = '';
      c.type = c.dataset.senha === undefined ? c.type : 'password';
    });
    form.querySelectorAll('.olho').forEach((b) => { b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'Mostrar senha'); });
    mostrarErro('');
    (form.querySelector('input:not(:disabled):not([type=checkbox])') ?? $('a-enviar')).focus();
  }

  // Mostra o código de recuperação uma vez só; ele não fica guardado de forma legível.
  function mostrarCodigo(codigo, depois) {
    form.hidden = true;
    $('a-voltar').hidden = true;
    $('acesso-titulo').textContent = 'Guarde o código de recuperação';
    $('acesso-apoio').textContent = 'Ele é a única forma de recuperar a conta do administrador se a senha for esquecida. Anote em papel e guarde em lugar seguro. Ele não aparece de novo.';
    $('acesso-codigo').textContent = codigo;
    $('acesso-guardar').hidden = false;
    $('a-guardei').onclick = depois;
    $('a-guardei').focus();
  }

  /*
   * Antes de abrir o painel, traz os dados do banco quando o site roda pelo servidor (servidor.js).
   * Sem servidor (GitHub Pages, arquivo local, sem internet), segue direto com os dados do aparelho.
   * credenciais: e-mail e senha que a pessoa acabou de digitar, para entrar também no servidor.
   */
  async function abrirApp(credenciais = null) {
    const atual = contaAtual();
    const puxado = await puxarDoServidor(credenciais, (credenciais && credenciais.email) || (atual && atual.email));
    if (!puxado.ok) {
      // O servidor manda: se ele recusou, não abre o painel com dados velhos.
      sair(false);
      document.querySelector('.app').hidden = true;
      $('tela-acesso').hidden = false;
      desenharRecados();
      irPara('entrar');
      mostrarErro(puxado.erro);
      return;
    }
    const tela = $('tela-acesso');
    const fim = () => {
      tela.hidden = true;
      tela.classList.remove('entrando');
      document.querySelector('.app').hidden = false;
      if (!document.getElementById('script-app')) {
        const s = document.createElement('script');
        s.id = 'script-app';
        s.src = 'js/app.js';
        document.body.append(s);
      }
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { fim(); return; }
    tela.classList.add('entrando');
    setTimeout(fim, TEMPO_ENTRADA);
  }

  async function enviar() {
    const v = Object.fromEntries(new FormData(form));
    const precisaNova = MODOS[modo].campos.includes('nova');
    if (precisaNova && v.nova !== v.confirmar) { mostrarErro('As duas senhas não são iguais.'); $('a-confirmar').focus(); return; }
    const aceitou = $('a-aceite').checked;
    if (MODOS[modo].campos.includes('termos') && !aceitou) {
      mostrarErro('Para continuar, marque que leu e aceita os Termos de uso e o Aviso de privacidade.');
      $('a-aceite').focus();
      return;
    }

    if (modo === 'primeiro') {
      const r = await criarAdministrador({ nome: v.nome, email: v.email, senha: v.nova, aceitouTermos: aceitou });
      if (!r.ok) return mostrarErro(r.erro);
      return mostrarCodigo(r.codigoRecuperacao, () => abrirApp({ email: v.email, senha: v.nova, manter: true }));
    }
    if (modo === 'entrar') {
      const manter = Boolean(v.manter);
      const r = await entrar(v.email, v.senha, manter);
      if (!r.ok) { $('a-senha').value = ''; $('a-senha').focus(); return mostrarErro(r.erro); }
      if (r.trocarSenha || r.aceitarTermos) {
        provisoria = { email: v.email, senha: v.senha, manter };
        return irPara(r.trocarSenha ? 'provisoria' : 'termos');
      }
      return abrirApp({ email: v.email, senha: v.senha, manter });
    }
    if (modo === 'provisoria') {
      // Primeiro confere se o servidor aceita a provisória: se não, nada é trocado e a pessoa não fica presa.
      const noServidor = await conferirNoServidor(provisoria.email, provisoria.senha);
      if (!noServidor.ok) return mostrarErro(noServidor.erro);
      const r = await trocarSenha(provisoria.email, provisoria.senha, v.nova, provisoria.manter, aceitou);
      if (!r.ok) return mostrarErro(r.erro);
      // No servidor, entra com a provisória e troca lá também, para as duas senhas continuarem iguais.
      const credenciais = { email: provisoria.email, senha: provisoria.senha, novaSenha: v.nova, manter: provisoria.manter };
      provisoria = null;
      return abrirApp(credenciais);
    }
    if (modo === 'termos') {
      const r = await aceitarTermos(provisoria.email, provisoria.senha, provisoria.manter, aceitou);
      if (!r.ok) return mostrarErro(r.erro);
      const credenciais = { email: provisoria.email, senha: provisoria.senha, manter: provisoria.manter };
      provisoria = null;
      return abrirApp(credenciais);
    }
    if (modo === 'esqueci') return irPara('recuperar');
    if (modo === 'recuperar') {
      const r = await recuperarSenha(v.email, v.codigo, v.nova);
      if (!r.ok) return mostrarErro(r.erro);
      // Conta de antes dos termos: depois de anotar o código, ainda precisa aceitar.
      const email = v.email;
      const senha = v.nova;
      return mostrarCodigo(r.codigoRecuperacao, () => {
        if (contaAtual()) return abrirApp({ email, senha });
        provisoria = { email, senha, manter: false };
        return irPara('termos');
      });
    }
    // Sessão vencida com esta tela aberta: volta para a entrada, em vez de um erro sem saída.
    if (!contaAtual()) { location.reload(); return; }
    if (modo === 'codigo') {
      const r = await novoCodigoDeRecuperacao(v.senha);
      if (!r.ok) { $('a-senha').value = ''; return mostrarErro(r.erro); }
      return mostrarCodigo(r.codigoRecuperacao, () => voltarAoApp('Código de recuperação trocado.'));
    }
    const email = contaAtual().email;
    const r = await trocarSenha(email, v.senha, v.nova);
    // Aqui não há campo de e-mail: "E-mail ou senha incorretos" confundiria.
    if (!r.ok) return mostrarErro(r.erro === 'E-mail ou senha incorretos.' ? 'A senha atual está incorreta.' : r.erro);
    // Com os dados vindo do banco, troca no servidor também. Se ele recusar, volta a senha do aparelho,
    // para as duas continuarem iguais.
    const noServidor = await trocarSenhaNoServidor(v.senha, v.nova);
    if (!noServidor.ok) {
      await trocarSenha(email, v.nova, v.senha);
      return mostrarErro(noServidor.erro);
    }
    voltarAoApp('Senha trocada.');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = $('a-enviar');
    if (botao.disabled) return;
    botao.disabled = true;
    const texto = botao.textContent;
    botao.textContent = 'Aguarde…';
    try {
      await enviar();
    } catch (erro) {
      console.warn(erro);
      mostrarErro('Não foi possível concluir. Tente de novo.');
    }
    botao.disabled = false;
    if (botao.textContent === 'Aguarde…') botao.textContent = texto;
  });

  form.addEventListener('click', (e) => {
    const olho = e.target.closest('.olho');
    if (!olho) return;
    const campo = olho.parentElement.querySelector('input');
    const mostrar = campo.type === 'password';
    campo.type = mostrar ? 'text' : 'password';
    olho.setAttribute('aria-pressed', String(mostrar));
    olho.setAttribute('aria-label', mostrar ? 'Esconder senha' : 'Mostrar senha');
  });

  $('a-esqueci').addEventListener('click', () => irPara('esqueci'));
  $('a-voltar').addEventListener('click', () => {
    if (modo === 'trocar' || modo === 'codigo') voltarAoApp();
    else { provisoria = null; irPara('entrar'); }
  });

  function voltarAoApp(aviso) {
    $('tela-acesso').hidden = true;
    document.querySelector('.app').hidden = false;
    if (aviso) window.dispatchEvent(new CustomEvent('acesso-aviso', { detail: aviso }));
  }

  const abrirTelaDaConta = (qual) => () => {
    document.querySelector('.app').hidden = true;
    $('tela-acesso').hidden = false;
    irPara(qual);
  };
  window.abrirTrocaDeSenha = abrirTelaDaConta('trocar');
  window.abrirNovoCodigo = abrirTelaDaConta('codigo');

  function desenharRecados() {
    $('recados').replaceChildren(...recadosDaCasa().map(({ titulo, texto }) => {
      const cartao = document.createElement('div');
      cartao.className = 'vidro';
      const forte = document.createElement('strong');
      forte.textContent = titulo;
      const linha = document.createElement('span');
      linha.textContent = texto;
      cartao.append(forte, linha);
      return cartao;
    }));
  }

  // ---------- início ----------

  // Dentro de outro site (iframe), alguém poderia induzir cliques em "Começar do zero" ou "Desativar".
  // A CSP por <meta> não consegue barrar isso, e o GitHub Pages não manda o cabeçalho que barraria.
  if (window.top !== window.self) {
    document.body.textContent = 'Abra o sistema da Casa Via Matris pelo endereço oficial, fora de outros sites.';
    return;
  }

  // Na tela de entrada, "Pular para o conteúdo" leva ao formulário (o painel ainda está escondido).
  document.querySelector('.pular').addEventListener('click', (e) => {
    if (!document.querySelector('.app').hidden) return;
    e.preventDefault();
    $('acesso-titulo').tabIndex = -1;
    $('acesso-titulo').focus();
  });

  // Fica aqui, e não no app.js, para a tela de acesso também abrir sem internet antes do primeiro login.
  // Falha em silêncio onde service worker não é permitido (arquivo local).
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { });

  if (contaAtual()) {
    abrirApp();
    return;
  }
  // Ninguém logado nesta aba. Não apaga a cópia do banco aqui: outra aba pode estar aberta com uma sessão
  // só dela (sem "Manter conectado"). Quem entra só recebe a cópia se ela for dele (servidor.js).
  if (typeof terminarSaidaPendente === 'function') terminarSaidaPendente();
  try { desenharRecados(); } catch (e) { console.warn(e); } // recados nunca podem impedir a entrada
  $('tela-acesso').hidden = false;
  let guarda = false;
  try { guarda = Boolean(globalThis.localStorage); } catch (e) { /* cookies bloqueados */ }
  if (!guarda) {
    form.hidden = true;
    $('acesso-titulo').textContent = 'Libere o armazenamento';
    $('acesso-apoio').textContent = problemasDoArmazenamento()[0];
    return;
  }
  if (!globalThis.crypto?.subtle) {
    form.hidden = true;
    $('acesso-titulo').textContent = 'Abra pelo endereço seguro';
    $('acesso-apoio').textContent = 'Este navegador só permite entrar por um endereço https. Abra o site pelo link oficial.';
    return;
  }
  irPara(temContas() ? 'entrar' : 'primeiro');
})();
