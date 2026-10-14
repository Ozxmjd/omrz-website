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
  const card = tok.replace('tok-', '') === 'mgr' ? 'pp' : tok.replace('tok-', '');
  await post('/__settings', { card, on: extra.scanner !== false });
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
// In de cadeaubonflow komen via het blok "Cadeaubon scannen" (vervangt de vroegere bovenste knoppen).
const giftMode = p => p.evaluate(() => { if (scanMode !== 'gift') document.getElementById('giftBlockBtn').click(); });
const sanne = () => state().then(s => s.gifts.find(g => g.short_code === 'ABCDEFGHJK'));

module.exports = async function run(env) {
  ({ B, check, pageErrors, consoleErrors, out: OUT } = env);
  b = env.browser;
  await post('/__reset');

  // ===== A. Ander plan: niets verandert =====
  let { ctx, p } = await open('tok-basic');
  check('A. Basic: geen blok Cadeaubon scannen (ook al staat de instelling aan)', !(await vis(p, '#giftBlock')));
  await scan(p, 'https://omrzdigital.nl/cadeaubon/ba500000000000000000000000000004'); await p.waitForTimeout(200);
  check('A. Basic: cadeaubon-link → "Cadeaubonnen staan uit voor deze zaak", geen lookup', /Cadeaubonnen staan uit voor deze zaak/.test(await txt(p, '#scanAlert')) && !(await vis(p, '#giftStage')) && !(await vis(p, '#resultStage')) && (await state()).log.lookup.length === 0);
  await ctx.close();

  // ===== A2. Proefperiodes: alleen het pakket telt =====
  for (const [tok, show, label] of [['tok-trial', false, 'Proef op Basic'], ['tok-ptrial', false, 'Proef op Premium'], ['tok-pptrial', true, 'Proef op Premium Plus']]) {
    ({ ctx, p } = await open(tok));
    check(`A2. ${label} (instelling aan): ${show ? 'blok Cadeaubon scannen zichtbaar' : 'geen blok, alleen stempelscanner'}`, (await vis(p, '#giftBlock')) === show);
    if (!show) {
      await scan(p, 'https://omrzdigital.nl/cadeaubon/d6000000000000000000000000000006'); await p.waitForTimeout(200);
      check(`A2. ${label}: cadeaubon-link → "staan uit", geen cadeaubonflow`, /staan uit/.test(await txt(p, '#scanAlert')) && !(await vis(p, '#giftStage')));
    }
    await ctx.close();
  }
  // Backend weigert alsnog: scanapp valt terug op alleen stempelen
  ({ ctx, p } = await open('tok-pp'));
  await p.route('**/scan/resolve**', r => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'premium_plus_required', error: 'x' }) }));
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForTimeout(300);
  check('A2. premium_plus_required bij lookup → melding en blok weg', /Premium Plus/.test(await txt(p, '#scanAlert')) && !(await vis(p, '#giftBlock')));
  await ctx.close();

  // ===== B. Premium Plus eigenaar =====
  ({ ctx, p } = await open('tok-pp'));
  check('B1. Premium Plus + instelling aan: stempelscanner bovenaan, blok Cadeaubon scannen eronder', await vis(p, '#giftBlock') && await vis(p, '#cameraBtn')
    && await p.evaluate(() => document.getElementById('giftBlock').getBoundingClientRect().top > document.getElementById('cameraOpenWrap').getBoundingClientRect().bottom)
    && /Klaar om te scannen/.test(await txt(p, '#scanStage .scan-title')));
  await p.screenshot({ path: OUT + '/' + 'gcs-start-820.png' });
  await scan(p, UUID); await p.waitForSelector('#resultStage.on');
  check('B1. Stempelkaart-QR in Stempel-modus → bestaande stempelflow', await vis(p, '#giveBtn') && /Stempel Klant/.test(await txt(p, '#custName')));
  await p.click('#resultStage .btn-ghost');                                  // Annuleren (stempelflow)
  // B2: cadeaubon-link in Stempel-modus → cadeaubonflow
  await scan(p, 'https://omrzdigital.nl/cadeaubon/a1b2c3d4e5f60718293a4b5c6d7e8f90'); await p.waitForSelector('#giftStage.on');
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
  check('B3. Verzoek: code, amount_cents 3000, uuid-sleutel, geen location_id/bill', r1.code === 'https://omrzdigital.nl/cadeaubon/a1b2c3d4e5f60718293a4b5c6d7e8f90' && r1.gift_card_id && r1.card_id === 'pp' && r1.amount_cents === 3000 && /^[0-9a-f-]{36}$/.test(r1.idempotency_key) && !('location_id' in r1) && !('bill_total_cents' in r1), JSON.stringify(r1));
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
  await giftMode(p);
  check('B5. Cadeaubon-modus: titel en "Code intypen"', /Cadeaubon scannen/.test(await txt(p, '#scanStage .scan-title')) && await vis(p, '#giftCodeToggle') && !(await vis(p, '#manualToggle')));
  await p.click('#giftCodeToggle'); await p.fill('#giftCodeInput', 'bzkd0'); await p.type('#giftCodeInput', '00001');
  check('B5. Code wordt automatisch opgemaakt', (await p.inputValue('#giftCodeInput')) === 'BZKD-0000-01', await p.inputValue('#giftCodeInput'));
  await p.click('#giftCodeBtn'); await p.waitForSelector('#giftStage.on');
  check('B5. Geblokkeerd: grote rode melding, geen invoer', /Geblokkeerd/.test(await txt(p, '#gStop')) && !(await vis(p, '#gForm')) && !(await vis(p, '#gPad')));
  await p.screenshot({ path: OUT + '/' + 'gcs-blocked-820.png' });
  check('B5. Badge geblokkeerd: label + eigen kleurklasse', (await txt(p, '#gBadge')) === 'Geblokkeerd' && /blocked/.test(await p.getAttribute('#gBadge', 'class')));
  const scanColors = { blocked: await p.evaluate(() => getComputedStyle(document.getElementById('gBadge')).color) };
  await p.click('#gCancel');
  for (const [code, word, cls] of [['EXPR-0000-03', 'Verlopen', 'expired'], ['PAST-0000-05', 'Verlopen', 'expired'], ['EMPT-0000-02', 'Leeg', 'empty'], ['ABCD-EFGH-JK', 'Leeg', 'empty']]) {
    await giftMode(p); await scan(p, code); await p.waitForSelector('#giftStage.on');
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
  await giftMode(p);
  await scan(p, UUID); await p.waitForTimeout(200);
  check('B6. Stempelkaart in Cadeaubon-modus → melding + "Naar stempelen"', /stempelkaart, geen cadeaubon/.test(await txt(p, '#wrongQr')) && await vis(p, '#wrongQrBtn'));
  await p.click('#wrongQrBtn'); await p.waitForSelector('#resultStage.on');
  check('B6. "Naar stempelen" → stempelflow met die klant, modus Stempel', /Stempel Klant/.test(await txt(p, '#custName')) && (await p.evaluate(() => scanMode)) === 'stamp');
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
  await p.evaluate(() => { let n = 0; window.jsQR = () => (++n > 3 ? { data: ' https://omrzdigital.nl/cadeaubon/a1b2c3d4e5f60718293a4b5c6d7e8f90 ' } : null); });
  await p.click('#cameraBtn');
  await p.waitForSelector('#giftStage.on', { timeout: 8000 }).catch(() => {});
  check('F. Camera-lus herkent cadeaubon-link en opent de cadeaubonflow', await vis(p, '#giftStage') && /Sanne/.test(await txt(p, '#gTo')));
  check('F. Camera staat uit na de scan', await p.evaluate(() => !scanning));
  await ctx.close();

  // ===== K. Instelling "Cadeaubon-scanner voor medewerkers" =====
  await post('/__reset');
  ({ ctx, p } = await open('tok-pp', null, { scanner: false }));
  check('K1. Standaard uit: geen blok, stempelscanner zoals altijd', !(await vis(p, '#giftBlock')) && await vis(p, '#cameraBtn'));
  let lk = (await state()).log.lookup.length;
  await scan(p, 'https://omrzdigital.nl/cadeaubon/a1b2c3d4e5f60718293a4b5c6d7e8f90'); await p.waitForTimeout(200);
  check('K1. Uit + cadeaubon-link: "Cadeaubonnen staan uit voor deze zaak", verder niets', (await txt(p, '#scanAlert')) === 'Cadeaubonnen staan uit voor deze zaak.' && (await state()).log.lookup.length === lk && !(await vis(p, '#giftStage')) && !(await vis(p, '#resultStage')) && await p.evaluate(() => !scanning));
  await scan(p, UUID); await p.waitForSelector('#resultStage.on');
  check('K1. Uit: stempelkaart-QR gewoon naar de stempelflow', await vis(p, '#giveBtn'));
  await p.click('#resultStage .btn-ghost');
  await p.evaluate(() => { window.__zelfdePagina = true; });
  await post('/__settings', { card: 'pp', on: true });
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(500);
  check('K4. Aangezet door eigenaar → blok verschijnt bij terugkeer (visibilitychange), zonder reload', await vis(p, '#giftBlock') && await p.evaluate(() => window.__zelfdePagina === true));
  await post('/__settings', { card: 'pp', on: false });
  await p.waitForTimeout(1600);
  await p.evaluate(() => window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(500);
  check('K4. Uitgezet door eigenaar → blok weg bij terugkeer (focus), zonder reload', !(await vis(p, '#giftBlock')) && await p.evaluate(() => window.__zelfdePagina === true));
  await ctx.close();
  ({ ctx, p } = await open('tok-pp'));
  await p.click('#giftBlockBtn'); await p.waitForTimeout(300);
  check('K2. Blok → cadeaubon-scanmodus (titel, code intypen), blok verborgen', /Cadeaubon scannen/.test(await txt(p, '#scanStage .scan-title')) && await vis(p, '#giftCodeToggle') && !(await vis(p, '#giftBlock')) && !(await vis(p, '#manualToggle')));
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('#giftStage.on');
  check('K2. Cadeaubon gescand → bestaande cadeaubonflow (saldo)', /50,00/.test(await txt(p, '#gBal')));
  await p.click('#gCancel'); await p.click('#giftBack');
  check('K2. "Terug naar stempelen" → stempelscanner met blok eronder', /Klaar om te scannen/.test(await txt(p, '#scanStage .scan-title')) && await vis(p, '#giftBlock'));
  await ctx.close();
  for (const [f, label] of [[500, 'serverfout'], [404, '404 (endpoint bestaat nog niet)'], ['migration', 'migration_missing']]) {
    await post('/__cfg', { settingsFail: f });
    ({ ctx, p } = await open('tok-pp', null, { expectErrors: true }));
    check(`K3. Instelling aan maar ophalen geeft ${label} → geen blok`, !(await vis(p, '#giftBlock')) && await vis(p, '#cameraBtn'));
    await ctx.close();
  }
  await post('/__cfg', { settingsFail: null });
  for (const on of [true, false]) {
    ({ ctx, p } = await open('tok-mgr', null, { loc: 'L1', scanner: on }));
    check(`K5. Medewerker, instelling ${on ? 'aan' : 'uit'} → ${on ? 'blok zichtbaar' : 'geen blok'}`, (await vis(p, '#giftBlock')) === on);
    await ctx.close();
  }

  // ===== S. Stempelreeks zonder reload (regressie: tweede stempel deed niets) =====
  await require('./stamp-sequence.js').stampSequence(b, check, pageErrors, B);
  // Dezelfde reeks met de cadeaubon-scanner aan: het blok mag de stempelflow niet raken.
  await require('./stamp-sequence.js').stampSequence(b, check, pageErrors, B, { scannerOn: true });

  // ===== R. Fase A: echte QR-vormen en afschrijven zoals de backend het wil =====
  {
    const LONG = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';           // Sanne; zo staat het in elke cadeaubon-QR
    await post('/__reset');
    ({ ctx, p } = await open('tok-pp'));
    const stampLookups = []; p.on('request', r => { if (/\/api\/stamp\/lookup\?/.test(r.url())) stampLookups.push(r.url()); });
    for (const [label, qr] of [['lange code (32 hex)', LONG], ['lange code in hoofdletters', LONG.toUpperCase()], ['volledige url api.omrzdigital.nl', 'https://api.omrzdigital.nl/cadeaubon/' + LONG],
      ['url omrzdigital.nl', 'https://omrzdigital.nl/cadeaubon/' + LONG]]) {
      await giftMode(p); await scan(p, qr); await p.waitForTimeout(300);
      check(`R1. Cadeaubon-modus, ${label} → cadeaubonflow, nooit "stempelkaart"`, await vis(p, '#giftStage') && !(await vis(p, '#wrongQr')) && /50,00/.test(await txt(p, '#gBal')), (await txt(p, '#scanAlert')) || (await txt(p, '#wrongQr')));
      await p.click('#gCancel'); await p.evaluate(() => setScanMode('stamp'));
      await scan(p, qr); await p.waitForTimeout(300);
      check(`R1. Stempel-modus, ${label} → cadeaubonflow, geen stempel-lookup`, await vis(p, '#giftStage') && stampLookups.length === 0);
      await p.click('#gCancel');
    }
    check('R1. Backend beslist via /scan/resolve; geen aparte lookup nodig', (await state()).log.resolve >= 8 && (await state()).log.lookup.length === 0, 'resolve ' + (await state()).log.resolve + ', lookup ' + (await state()).log.lookup.length);
    await giftMode(p); await scan(p, '3f2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b34'); await p.waitForTimeout(200);
    check('R1. Stempelkaart (UUID) in cadeaubon-modus → "Dit is een stempelkaart"', await vis(p, '#wrongQr') && !(await vis(p, '#giftStage')));
    await p.click('#giftBack');
    // Afschrijven: card_id en gift_card_id mee, resultaat uit transaction
    await scan(p, LONG); await p.waitForSelector('#giftStage.on');
    await keys(p, '12'); await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on', { timeout: 4000 }).catch(() => {});
    const rb = (await state()).log.redeem.slice(-1)[0];
    const sg = await sanne();
    check('R2. Afschrijven stuurt card_id, gift_card_id, code en sleutel mee', rb.card_id === 'pp' && rb.gift_card_id === sg.id && rb.code === LONG && /^[0-9a-f-]{36}$/.test(rb.idempotency_key), JSON.stringify(rb));
    check('R2. Resultaat uit transaction: afgeschreven € 12,00, nieuw saldo € 38,00, referentie', await vis(p, '#giftDoneStage') && (await txt(p, '#gdAmount')) === `€${NB}12,00`
      && (await txt(p, '#gdBal')) === `€${NB}38,00` && /^CB-\d{4}$/.test(await txt(p, '#gdRef')), [await txt(p, '#gdBal'), await txt(p, '#gdRef')].join(' / '));
    await p.click('#gdNext');
    // Rekeningbedrag: "Nog te betalen" zelf uitgerekend (de backend geeft het niet)
    await scan(p, LONG); await p.waitForSelector('#giftStage.on');
    await p.click('[data-gtarget="bill"]'); await keys(p, '45'); await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on');
    check('R2. Rekening € 45 bij saldo € 38 → afgeschreven € 38,00, "Nog te betalen: € 7,00"', (await txt(p, '#gdAmount')) === `€${NB}38,00` && (await txt(p, '#gdRemain')) === `Nog te betalen: €${NB}7,00`);
    await p.click('#gdNext');
    await ctx.close();
    // De echte camera-lus met de lange code
    await post('/__reset');
    ({ ctx, p } = await open('tok-pp'));
    await p.evaluate(LONG => { let n = 0; window.jsQR = () => (++n > 3 ? { data: LONG } : null); }, LONG);
    await p.click('#cameraBtn');
    await p.waitForSelector('#giftStage.on', { timeout: 8000 }).catch(() => {});
    check('R1. Camera-lus met de lange code uit de Wallet-pas → cadeaubonflow', await vis(p, '#giftStage') && /Sanne/.test(await txt(p, '#gTo')));
    await ctx.close();
    // De nep-API dwingt card_id af, net als de backend
    const r = await fetch(B + '/api/stamp/gift-cards/redeem', { method: 'POST', headers: { Authorization: 'Bearer tok-pp', 'Content-Type': 'application/json' }, body: JSON.stringify({ code: LONG, amount_cents: 100, idempotency_key: 'x-1' }) });
    const j = await r.json();
    check('R2. Nep-API weigert een code zonder card_id, net als de backend', r.status === 400 && j.code === 'card_id_required' && j.error === 'card_id is verplicht bij een code');
  }

  // ===== R3. /scan/resolve (backend e101948): QR met voorvoegsel, splitsen op kind, terugval =====
  {
    const LONG = 'a1b2c3d4e5f60718293a4b5c6d7e8f90', QR = 'OMRZCB1:' + LONG, UUID2 = '7a2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b35';
    await post('/__reset');
    ({ ctx, p } = await open('tok-pp'));
    const calls = []; p.on('request', r => { const u = r.url(); if (/scan\/resolve|stamp\/lookup|gift-cards\/lookup/.test(u)) calls.push(new URL(u).pathname + ' ' + new URL(u).searchParams.get('code')); });
    await scan(p, QR); await p.waitForSelector('#giftStage.on', { timeout: 4000 }).catch(() => {});
    check('R3. Stempel-modus, QR "OMRZCB1:<code>" → resolve zegt gift_card → cadeaubonflow zonder lookup', await vis(p, '#giftStage') && calls.join('|') === '/api/stamp/scan/resolve ' + QR, calls.join('|'));
    await p.click('#gCancel'); calls.length = 0;
    await giftMode(p); await scan(p, QR); await p.waitForTimeout(300);
    check('R3. Cadeaubon-modus, zelfde QR → cadeaubonflow', await vis(p, '#giftStage') && !(await vis(p, '#wrongQr')));
    await keys(p, '5'); await p.click('#gRedeem'); await p.click('#gConfirmBtn'); await p.waitForSelector('#giftDoneStage.on');
    const rb = (await state()).log.redeem.slice(-1)[0];
    check('R3. Afschrijven na resolve: gift_card_id, card_id en de gescande code', rb.gift_card_id && rb.card_id === 'pp' && rb.code === QR, JSON.stringify(rb));
    await p.click('#gdNext'); calls.length = 0;
    await p.evaluate(() => setScanMode('stamp'));
    await scan(p, UUID2); await p.waitForSelector('#resultStage.on', { timeout: 4000 }).catch(() => {});
    check('R3. Stempelkaart → resolve zegt stamp_holder → bestaande stempelflow (lookup)', await vis(p, '#giveBtn') && calls[0] === '/api/stamp/scan/resolve ' + UUID2 && calls.some(c => c.startsWith('/api/stamp/lookup')), calls.join('|'));
    await p.click('#giveBtn'); await p.waitForSelector('#successStage.on', { timeout: 3000 }).catch(() => {});
    check('R3. Stempelen werkt daarna gewoon', await vis(p, '#successStage'));
    await p.click('#nextCustomerBtn');
    await giftMode(p); await scan(p, 'iets-dat-niemand-kent'); await p.waitForTimeout(300);
    check('R3. Cadeaubon-modus, onbekende code → "hoort niet bij een cadeaubon of een stempelkaart"', /hoort niet bij een cadeaubon of een stempelkaart/.test(await txt(p, '#scanAlert')) && !(await vis(p, '#giftStage')));
    await p.click('#giftBack');
    await giftMode(p); await scan(p, 'OMRZCB1:ffffffffffffffffffffffffffffffff'); await p.waitForTimeout(300);
    check('R3. Onbekende bon → nette melding, geen stempelkaart-melding', /bestaat niet of hoort niet bij deze zaak/.test(await txt(p, '#scanAlert')) && !(await vis(p, '#wrongQr')));
    await p.click('#giftBack');
    // Code intypen gaat ook via resolve
    await giftMode(p); calls.length = 0;
    await p.evaluate(() => { document.getElementById('giftCodePanel').hidden = false; });
    await p.fill('#giftCodeInput', 'abcdefghjk'); await p.click('#giftCodeBtn'); await p.waitForSelector('#giftStage.on', { timeout: 4000 }).catch(() => {});
    check('R3. Code intypen → resolve → cadeaubonflow', await vis(p, '#giftStage') && calls[0] === '/api/stamp/scan/resolve ABCD-EFGH-JK', calls.join('|'));
    await p.click('#gCancel');
    await ctx.close();
    // Terugval: resolve ontbreekt, faalt of is onbereikbaar
    for (const [f, label] of [[404, 'route bestaat niet (404)'], [500, 'serverfout'], ['net', 'netwerkfout']]) {
      await post('/__reset'); await post('/__cfg', { resolveFail: f });
      ({ ctx, p } = await open('tok-pp', null, { expectErrors: true }));
      await scan(p, QR); await p.waitForSelector('#giftStage.on', { timeout: 6000 }).catch(() => {});
      const okGift = await vis(p, '#giftStage');
      if (okGift) await p.click('#gCancel');
      await scan(p, UUID2); await p.waitForSelector('#resultStage.on', { timeout: 6000 }).catch(() => {});
      check(`R3. Terugval bij ${label}: bon-QR → cadeaubonflow (via lookup), stempelkaart → stempelflow`, okGift && await vis(p, '#giveBtn'));
      await ctx.close();
    }
    await post('/__cfg', { resolveFail: null });
    // Zaak zonder cadeaubonnen: nooit resolve, stempelen precies als altijd
    await post('/__reset');
    ({ ctx, p } = await open('tok-basic'));
    await scan(p, UUID2); await p.waitForSelector('#resultStage.on');
    await p.click('#giveBtn'); await p.waitForSelector('#successStage.on');
    await p.click('#nextCustomerBtn'); await scan(p, QR); await p.waitForTimeout(200);
    check('R3. Basic: geen enkele resolve-aanroep; stempelen werkt; bon-QR → "Cadeaubonnen staan uit"', !(await state()).log.resolve && /Cadeaubonnen staan uit/.test(await txt(p, '#scanAlert')));
    await ctx.close();
  }

  // ===== G. Schermformaten =====
  await post('/__reset');
  for (const vp of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    ({ ctx, p } = await open('tok-pp', vp));
    await giftMode(p);
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
