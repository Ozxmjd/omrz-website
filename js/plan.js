// Pakketten: één bron voor dashboard.html en scan.html, zodat beide de Premium Plus-toegang
// op precies dezelfde manier bepalen. Ook te laden in Node voor tests.
(function (root) {
  'use strict';
  // De backend kan 'premium_plus', 'premium-plus' of 'premiumplus' sturen.
  function normalizePlan(v) {
    const p = String(v == null ? '' : v).toLowerCase().replace(/[^a-z+]/g, '');
    if (p === 'premiumplus' || p === 'premium+' || p === 'plus') return 'premium_plus';
    if (p === 'premium' || p === 'pro') return 'premium';
    return 'basic';
  }
  // Premium Plus volgens het pakket zelf. Een proefperiode telt alleen als het pakket van die
  // proef Premium Plus is (de backend: plan >= premium_plus).
  function isPremiumPlus(plan) { return normalizePlan(plan) === 'premium_plus'; }

  const api = { normalizePlan, isPremiumPlus };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OMRZPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
