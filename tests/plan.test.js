// Draaien: node --test tests/plan.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/plan.js');

test('normalizePlan: varianten uit de backend', () => {
  for (const v of ['premium_plus', 'premium-plus', 'PremiumPlus', 'premium+', 'plus']) assert.equal(P.normalizePlan(v), 'premium_plus', v);
  for (const v of ['premium', 'Premium', 'pro']) assert.equal(P.normalizePlan(v), 'premium', v);
  for (const v of ['basic', '', null, undefined, 'iets']) assert.equal(P.normalizePlan(v), 'basic', String(v));
});

test('isPremiumPlus: alleen het pakket telt', () => {
  assert.equal(P.isPremiumPlus('premium_plus'), true);
  assert.equal(P.isPremiumPlus('premium'), false);   // ook als het een proef op Premium is
  assert.equal(P.isPremiumPlus('basic'), false);
  assert.equal(P.isPremiumPlus(null), false);
});
