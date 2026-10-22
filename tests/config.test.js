// Host-keuze voor de API (js/config.js) en herkenning van onze domeinen (js/giftcards.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/config.js');
const G = require('../js/giftcards.js');

test('config: API-basis per domein, onbekend = api.omrzdigital.nl', () => {
  // oneplume.nl gebruikt voorlopig de oude API (api.oneplume.nl bestaat nog niet).
  for (const h of ['oneplume.nl', 'www.oneplume.nl', 'ONEPLUME.NL', 'oneplume.nl.', 'www.oneplume.nl:443']) {
    assert.equal(C.apiBaseFor(h), 'https://api.omrzdigital.nl', h);
  }
  for (const h of ['omrzdigital.nl', 'www.omrzdigital.nl', 'localhost', 'omrz-website.vercel.app', '', null, undefined, 'oneplume.nl.evil.com', 'evil-oneplume.nl']) {
    assert.equal(C.apiBaseFor(h), C.DEFAULT_API_BASE, String(h));
  }
  assert.equal(C.DEFAULT_API_BASE, 'https://api.omrzdigital.nl');
  assert.ok(/^https:\/\//.test(C.API_BASE), 'in Node zonder location: de standaard');
  assert.equal(C.apiBaseFor('toString'), C.DEFAULT_API_BASE, 'geen erfenis van Object.prototype');
});

test('giftcards: bonlinks op omrzdigital.nl én oneplume.nl (en subdomeinen) herkend', () => {
  const LONG = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  for (const host of ['omrzdigital.nl', 'api.omrzdigital.nl', 'oneplume.nl', 'api.oneplume.nl', 'www.oneplume.nl']) {
    assert.deepEqual(G.classifyScan(`https://${host}/cadeaubon/${LONG}`), { kind: 'gift', code: LONG }, host);
  }
  for (const host of ['evil-oneplume.nl', 'oneplume.nl.evil.com', 'example.com']) {
    assert.equal(G.classifyScan(`https://${host}/cadeaubon/${LONG}`).kind, 'stamp', host);
  }
});
