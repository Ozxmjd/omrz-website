// Scanapp (scan.html): stempelflow, cadeaubonnen en onderdeel S (stempelreeks zonder reload).
// Draait via tests/browser/run.js; zie tests/browser/README.md.
let B, check, pageErrors, consoleErrors, OUT;
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const state = () => fetch(B + '/__state').then(r => r.json());
const NB = ' ';
const UUID = '3f2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b34';
let b;
async function open(tok, vp, extra = {}) {
  const ctx = await b.newContext({ viewport: vp || { width: 820, height: 1180 }, permissions: ['clipboard-read', 'clipboard-write', 'camera'] });
  await ctx.addInitScript(([t, loc]) => { if (!/scan/.test(location.pathname)) return; localStorage.setItem('stamp_token', t); localStorage.setItem('stamp_card_id', t.replace('tok-', '') === 'mgr' ? 'pp' : t.replace('tok-', '')); if (loc) localStorage.setItem('stamp_location_id', loc); }, [tok, extra.loc || null]);
  const p = await ctx.newPage();
  p.on('pageerror', e => pageErrors.push(tok + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !extra.expectErrors) consoleErrors.push(tok + ': ' + m.text()); });
  await p.goto(B + '/scan.html'); await p.waitForTimeout(900);
  return { ctx, p };
}
const txt = (p, s) => p.evaluate(s => (document.querySelector(s) || {}).innerText || '', s);
const vis = (p, s) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, s);
const noH = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const scan = (p, t) => p.evaluate(t => routeScan(t), t);
const keys = async (p, str) => { for (const k of str) await p.click(`#gPad [data-k="${k === '<' ? 'del' : k}"]`); };
const sanne = () => state().then(s => s.gifts.find(g => g.short_code === 'ABCD-EFGH-JK'));

module.exports = async function run(env) {
  ({ B, check, pageErrors, consoleErrors, out: OUT } = env);
  b = env.browser;
  await post('/__reset');

  // ===== A. Ander plan: niets verandert =====
  let { ctx, p } = await open('tok-basic');
  check('A. Basic: geen Stempel/Cadeaubon-keuze', !(await vis(p, '#modeSwitch')));
  await scan(p, 'https://omrzdigital.nl/cadeaubon/longcodeBasic001');
  await p.waitForSelector('#resultStage.on');
  check('A. Basic: elke QR gaat naar de stempelflow (geen cadeaubon-lookup)', !(await vis(p, '#giftStage')) && (await state()).log.lookup.length === 0);
  await ctx.close();

  // ===== A2. Proefperiodes: alleen het pakket telt =====
  for (const [tok, show, label] of [['tok-trial', false, 'Proef op Basic'], ['tok-ptrial', false, 'Proef op Premium'], ['tok-pptrial', true, 'Proef op Premium Plus']]) {
    ({ ctx, p } = await open(tok));
    check(`A2. ${label}: ${show ? 'keuze Stempel/Cadeaubon zichtbaar' : 'alleen stempelscanner'}`, (await vis(p, '#modeSwitch')) === show);
    if (!show) {
      await scan(p, 'https://omrzdigital.nl/cadeaubon/longcodeProef001'); await p.waitForSelector('#resultStage.on');
      check(`A2. ${label}: cadeaubon-link gaat naar de stempelflow`, !(await vis(p, '#giftStage')));
    }
    await ctx.close();
  }
  // Backend weigert alsnog: scanapp valt terug op alleen stempelen
  ({ ctx, p } = await open('tok-pp'));
  await p.route('**/gift-cards/lookup**', r => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'premium_plus_required', error: 'x' }) }));
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForTimeout(300);
  check('A2. premium_plus_required bij lookup → melding en alleen nog stempelscanner', /Premium Plus/.test(await txt(p, '#scanAlert')) && !(await vis(p, '#modeSwitch')));
  await ctx.close();

  // ===== B. Premium Plus eigenaar =====
  ({ ctx, p } = await open('tok-pp'));
  check('B1. Premium Plus: keuze zichtbaar, standaard Stempel', await vis(p, '#modeSwitch') && /active/.test(await p.getAttribute('[data-mode="stamp"]', 'class')));
  await p.screenshot({ path: OUT + '/' + 'gcs-start-820.png' });
  await scan(p, UUID); await p.waitForSelector('#resultStage.on');
  check('B1. Stempelkaart-QR in Stempel-modus → bestaande stempelflow', await vis(p, '#giveBtn') && /Stempel Klant/.test(await txt(p, '#custName')));
  await p.click('#resultStage .btn-ghost');                                  // Annuleren (stempelflow)
  // B2: cadeaubon-link in Stempel-modus → cadeaubonflow
  await scan(p, 'https://omrzdigital.nl/cadeaubon/longcodeSanne123'); await p.waitForSelector('#giftStage.on');
  check('B2. Cadeaubon-link terwijl Stempel actief → cadeaubonflow', true);
  check('B2. Groot: zaaknaam, ontvanger, saldo, status', /Loris Parfum/i.test(await txt(p, '#gShop')) && /Sanne de Vries/.test(await txt(p, '#gTo')) && (await txt(p, '#gBal')) === `€${NB}50,00` && /Actief/.test(await txt(p, '#gBadge')) && /active/.test(await p.getAttribute('#gBadge', 'class')));
  check('B2. Afschrijven uit zolang er geen bedrag is', await p.isDisabled('#gRedeem'));
  const activeColor = await p.evaluate(() => getComputedStyle(document.getElementById('gBadge')).color);
  await keys(p, '30,005<'); // 30,00 — derde decimaal geweigerd, daarna wissen
  check('B3. Pad: "30,00" (max 2 decimalen, wissen werkt)', (await txt(p, '#gAmt')) === '€ 30,0', await txt(p, '#gAmt'));
  await keys(p, '0');
  await p.screenshot({ path: OUT + '/' + 'gcs-gift-820.png', fullPage: true });
  await p.click('#gRedeem');
  check('B3. Bevestiging toont het bedrag', (await txt(p, '#gConfirmAmt')) === `€${NB}30,00` && await vis(p, '#gConfirmBtn'));
  await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on');
  const done = await txt(p, '#giftDoneStage');
  check('B3. Resultaat: Afgeschreven € 30,00 / Nieuw saldo € 20,00 / referentie', (await txt(p, '#gdAmount')) === `€${NB}30,00` && (await txt(p, '#gdBal')) === `€${NB}20,00` && /CB-\d{4}/.test(await txt(p, '#gdRef')));
  check('B3. Kassaregel + geen "Nog te betalen" zonder rekeningbedrag', /Boek op de kassa als betaalmethode Cadeaubon:\s*€\s30,00/.test(done) && !(await vis(p, '#gdRemain')));
  await p.click('#gdCopy'); await p.waitForTimeout(200);
  check('B3. Kopieer bedrag → "30,00" op het klembord', (await p.evaluate(() => navigator.clipboard.readText())) === '30,00');
  await p.screenshot({ path: OUT + '/' + 'gcs-done-820.png', fullPage: true });
  let st = await state(); const r1 = st.log.redeem.slice(-1)[0];
  check('B3. Verzoek: code, amount_cents 3000, uuid-sleutel, geen location_id/bill', r1.code === 'longcodeSanne123' && r1.amount_cents === 3000 && /^[0-9a-f-]{36}$/.test(r1.idempotency_key) && !('location_id' in r1) && !('bill_total_cents' in r1), JSON.stringify(r1));
  await p.click('#gdNext');
  check('B3. Volgende scan → terug naar scannen', await vis(p, '#scanStage') && !(await vis(p, '#giftDoneStage')));

  // B4: rekeningbedrag
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('#giftStage.on');
  await p.click('[data-gtarget="bill"]'); await keys(p, '15');
  check('B4. Rekening € 15 < saldo € 20 → afschrijfbedrag 15,00 voorgevuld', (await txt(p, '#gAmt')) === '€ 15,00', await txt(p, '#gAmt'));
  await keys(p, '<5');  // 15 → 1 → 15? eerst wissen naar "1", dan "15"... maak 25
  await p.click('#gClear'); await p.click('[data-gtarget="bill"]'); await keys(p, '25');
  check('B4. Rekening € 25 > saldo € 20 → volledig saldo 20,00', (await txt(p, '#gAmt')) === '€ 20,00', await txt(p, '#gAmt'));
  await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on');
  check('B4. "Nog te betalen: € 5,00"', (await txt(p, '#gdRemain')) === `Nog te betalen: €${NB}5,00`);
  check('B4. bill_total_cents 2500 meegestuurd', (await state()).log.redeem.slice(-1)[0].bill_total_cents === 2500);
  await p.click('#gdNext');

  // B5: geblokkeerd / verlopen / leeg (korte code intypen)
  await p.click('[data-mode="gift"]');
  check('B5. Cadeaubon-modus: titel en "Code intypen"', /Cadeaubon scannen/.test(await txt(p, '#scanStage .scan-title')) && await vis(p, '#giftCodeToggle') && !(await vis(p, '#manualToggle')));
  await p.click('#giftCodeToggle'); await p.fill('#giftCodeInput', 'blkd0'); await p.type('#giftCodeInput', '00001');
  check('B5. Code wordt automatisch opgemaakt', (await p.inputValue('#giftCodeInput')) === 'BLKD-0000-01', await p.inputValue('#giftCodeInput'));
  await p.click('#giftCodeBtn'); await p.waitForSelector('#giftStage.on');
  check('B5. Geblokkeerd: grote rode melding, geen invoer', /Geblokkeerd/.test(await txt(p, '#gStop')) && !(await vis(p, '#gForm')) && !(await vis(p, '#gPad')));
  await p.screenshot({ path: OUT + '/' + 'gcs-blocked-820.png' });
  check('B5. Badge geblokkeerd: label + eigen kleurklasse', (await txt(p, '#gBadge')) === 'Geblokkeerd' && /blocked/.test(await p.getAttribute('#gBadge', 'class')));
  const scanColors = { blocked: await p.evaluate(() => getComputedStyle(document.getElementById('gBadge')).color) };
  await p.click('#gCancel');
  for (const [code, word, cls] of [['EXPI-0000-03', 'Verlopen', 'expired'], ['PAST-0000-05', 'Verlopen', 'expired'], ['EMPT-0000-02', 'Leeg', 'empty'], ['ABCD-EFGH-JK', 'Leeg', 'empty']]) {
    await p.click('[data-mode="gift"]').catch(() => {}); await scan(p, code); await p.waitForSelector('#giftStage.on');
    check(`B5. ${code}: label "${word}" (${cls}), rode stopmelding, geen invoer`, (await txt(p, '#gBadge')) === word && new RegExp(cls).test(await p.getAttribute('#gBadge', 'class')) && new RegExp(word).test(await txt(p, '#gStop')) && !(await vis(p, '#gForm')));
    scanColors[cls] = await p.evaluate(() => getComputedStyle(document.getElementById('gBadge')).color);
    await p.click('#gCancel');
  }
  scanColors.active = activeColor;   // gemeten bij B2, toen Sannes bon nog actief was
  check('B5. Scanner: vier statussen, vier verschillende kleuren', new Set(Object.values(scanColors)).size === 4, JSON.stringify(scanColors));
  await p.evaluate(() => { document.getElementById('giftCodePanel').hidden = false; }); await p.fill('#giftCodeInput', 'ABC'); await p.click('#giftCodeBtn');
  check('B5. Te korte code → melding', /10 tekens/.test(await txt(p, '#giftCodeAlert')));
  await scan(p, 'ZZZZ-ZZZZ-ZZ'); await p.waitForTimeout(400);
  check('B5. Onbekende code → "bestaat niet of hoort niet bij deze zaak"', /bestaat niet/.test(await txt(p, '#scanAlert')));

  // B6: stempelkaart-QR in Cadeaubon-modus
  await p.click('[data-mode="gift"]').catch(() => {});
  await scan(p, UUID); await p.waitForTimeout(200);
  check('B6. Stempelkaart in Cadeaubon-modus → melding + "Naar stempelen"', /stempelkaart, geen cadeaubon/.test(await txt(p, '#wrongQr')) && await vis(p, '#wrongQrBtn'));
  await p.click('#wrongQrBtn'); await p.waitForSelector('#resultStage.on');
  check('B6. "Naar stempelen" → stempelflow met die klant, modus Stempel', /Stempel Klant/.test(await txt(p, '#custName')) && /active/.test(await p.getAttribute('[data-mode="stamp"]', 'class')));
  await p.click('#resultStage .btn-ghost');
  await ctx.close();

  // ===== C. Idempotency: dubbel tikken en netwerkherstel =====
  const g0 = await post('/__reset');
  ({ ctx, p } = await open('tok-pp'));
  await post('/__cfg', { redeemDelay: 1200 });
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('#giftStage.on');
  await keys(p, '10'); await p.click('#gRedeem');
  await p.evaluate(() => { const b = document.getElementById('gConfirmBtn'); b.click(); b.click(); b.click(); });
  check('C1. Knop uitgeschakeld tijdens verzoek', await p.isDisabled('#gConfirmBtn'));
  await p.waitForSelector('#giftDoneStage.on');
  st = await state();
  check('C1. Drie tikken → één verzoek, één afschrijving (50 → 40)', st.log.redeem.length === 1 && (await sanne()).balance_cents === 4000, st.log.redeem.length + ' verzoek(en)');
  await post('/__cfg', { redeemDelay: 0 });
  await p.click('#gdNext');
  // Netwerkfout: eerste verzoek gaat wel naar de server maar het antwoord komt nooit aan
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('#giftStage.on');
  await keys(p, '5'); await p.click('#gRedeem');
  let first = true;
  await p.route('**/gift-cards/redeem', async route => {
    if (first) { first = false; const r = await route.fetch(); await r.text(); return route.abort('failed'); }  // server verwerkt, antwoord gaat verloren
    return route.continue();
  });
  await p.click('#gConfirmBtn'); await p.waitForTimeout(500);
  check('C2. Netwerkfout → melding "niet dubbel afgeschreven", bevestiging blijft staan', /niet dubbel afgeschreven/.test(await txt(p, '#giftAlert')) && await vis(p, '#gConfirmBtn'));
  await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on');
  st = await state(); const two = st.log.redeem.slice(-2);
  check('C2. Opnieuw = zelfde sleutel; saldo maar één keer verlaagd (40 → 35)', two[0].idempotency_key === two[1].idempotency_key && (await sanne()).balance_cents === 3500 && (await txt(p, '#gdBal')) === `€${NB}35,00`);
  await p.unroute('**/gift-cards/redeem');
  await p.click('#gdNext');
  // Nieuw bedrag na een afgeronde poging = nieuwe sleutel
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('#giftStage.on');
  await keys(p, '1'); await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on');
  st = await state();
  check('C3. Volgende poging krijgt een nieuwe sleutel', st.log.redeem.slice(-1)[0].idempotency_key !== two[1].idempotency_key);
  await p.click('#gdNext');

  // ===== D. Foutcodes =====
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('#giftStage.on');
  await p.route('**/gift-cards/redeem', r => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'insufficient_balance', error: 'x', balance_cents: 500 }) }));
  await keys(p, '20'); await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForTimeout(300);
  check('D1. insufficient_balance → melding met saldo, saldo bijgewerkt', /Er staat nog €\s5,00/.test(await txt(p, '#giftAlert')) && (await txt(p, '#gBal')) === `€${NB}5,00`);
  await p.unroute('**/gift-cards/redeem');
  await p.route('**/gift-cards/redeem', r => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'gift_card_blocked', error: 'x' }) }));
  await p.click('#gFull'); await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForTimeout(300);
  check('D2. gift_card_blocked bij afschrijven → rode melding, invoer weg', /Geblokkeerd/.test(await txt(p, '#gStop')) && !(await vis(p, '#gForm')));
  await p.unroute('**/gift-cards/redeem'); await p.click('#gCancel');
  await post('/__cfg', { rateLimited: true });
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForTimeout(300);
  check('D3. rate_limited → "Te veel pogingen"', /Te veel pogingen/.test(await txt(p, '#scanAlert')));
  await post('/__cfg', { rateLimited: false, notLive: true });
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForTimeout(300);
  check('D4. Backend niet live → rustige melding', /nog niet beschikbaar/.test(await txt(p, '#scanAlert')));
  await scan(p, UUID); await p.waitForSelector('#resultStage.on');
  check('D4. Stempelen werkt gewoon door', await vis(p, '#giveBtn'));
  await post('/__cfg', { notLive: false });
  await ctx.close();

  // ===== E. Manager: location_id =====
  await post('/__reset');
  ({ ctx, p } = await open('tok-mgr', null, { loc: 'L1' }));
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('#giftStage.on');
  await keys(p, '5'); await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on');
  check('E. Manager: location_id van de medewerker meegestuurd', (await state()).log.redeem.slice(-1)[0].location_id === 'L1');
  await ctx.close();

  // ===== F. Echte camera-lus (nep-camera + nep-decoder) =====
  ({ ctx, p } = await open('tok-pp'));
  await p.evaluate(() => { let n = 0; window.jsQR = () => (++n > 3 ? { data: ' https://omrzdigital.nl/cadeaubon/longcodeSanne123 ' } : null); });
  await p.click('#cameraBtn');
  await p.waitForSelector('#giftStage.on', { timeout: 8000 }).catch(() => {});
  check('F. Camera-lus herkent cadeaubon-link en opent de cadeaubonflow', await vis(p, '#giftStage') && /Sanne/.test(await txt(p, '#gTo')));
  check('F. Camera staat uit na de scan', await p.evaluate(() => !scanning));
  await ctx.close();

  // ===== S. Stempelreeks zonder reload (regressie: tweede stempel deed niets) =====
  await require('./stamp-sequence.js').stampSequence(b, check, pageErrors, B);

  // ===== G. Schermformaten =====
  await post('/__reset');
  for (const vp of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    ({ ctx, p } = await open('tok-pp', vp));
    await p.click('[data-mode="gift"]');
    check(`G. ${vp.width}px scanscherm: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcs-start-${vp.width}.png` });
    await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('#giftStage.on');
    await p.click('[data-gtarget="bill"]'); await keys(p, '1234,5');
    check(`G. ${vp.width}px cadeaubon: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcs-gift-${vp.width}.png`, fullPage: true });
    await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on');
    check(`G. ${vp.width}px resultaat: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcs-done-${vp.width}.png`, fullPage: true });
    await ctx.close();
    await post('/__reset');
  }
};
