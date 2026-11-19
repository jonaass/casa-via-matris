// Desde a 1.7.0, doação pede quem doou (ou "Doação anônima" marcada) e despesa pede para quem foi.
// Os testes antigos lançam sem isso; este embrulho completa o que falta, para eles continuarem testando
// o que testavam. As regras novas são testadas sem ele (veja "quem doou e para quem foi" no store.test.js).
function completar(e) {
  if (!e || e.pessoa) return e;
  if (e.tipo === 'doacao_item' || e.tipo === 'entrada_dinheiro') return e.anonimo === undefined ? { ...e, anonimo: true } : e;
  if (e.tipo === 'saida_dinheiro') return { ...e, pessoa: 'Mercado' };
  return e;
}

module.exports = (criarStore) => (opcoes) => {
  const s = criarStore(opcoes);
  const registrar = s.registrar;
  s.registrar = (entrada) => registrar(completar(entrada));
  return s;
};
module.exports.completar = completar;
