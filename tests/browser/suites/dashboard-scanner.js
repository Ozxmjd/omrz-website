// Dashboard, Geef Stempel: keuze Stempelen | Cadeaubon (fase B). Draait via tests/browser/run.js.
let B, check, pageErrors, consoleErrors, OUT;
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const state = () => fetch(B + '/__state').then(r => r.json());
const NB = '\u00a0';
const UUID = '3f2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b34';
const LONG = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
async function open(b, tok, card, extra = {}) {
  const ctx = await b.newContext({ viewport: extra.vp || { width: 1440, height: 1000 }, permissions: ['camera'] });
  await ctx.addInitScript(([t, c, role]) => { if (!/dashboard/.test(location.pathname)) return; localStorage.setItem('omrz_token', t); localStorage.setItem('omrz_card_id', c); localStorage.setItem('omrz_role', role);
    if (role === 'manager') { localStorage.setItem('omrz_location_id', 'L1'); localStorage.setItem('omrz_location_name', 'Centrum'); } }, [tok, card, extra.role || 'owner']);
  await post('/__settings', { card, on: extra.scanner !== false });
  const p = await ctx.newPage();
  p.on('pageerror', e => pageErrors.push(tok + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !extra.expectErrors) consoleErrors.push(tok + ': ' + m.text()); });
  p.calls = [];
  p.on('request', r => { const u = new URL(r.url()); if (/scan\/resolve|stamp\/lookup|gift-cards\/lookup|gift-cards\/redeem/.test(u.pathname)) p.calls.push(r.method() + ' ' + u.pathname); });
  await p.goto(B + '/dashboard.html'); await p.waitForTimeout(900);
  await p.evaluate(() => activateTab('stempel')); await p.waitForTimeout(500);
  return { ctx, p };
}
const txt = (p, s) => p.evaluate(s => (document.querySelector(s) || {}).innerText || '', s);
const vis = (p, s) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, s);
const noH = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const scan = (p, t) => p.evaluate(t => routeDashScan(t), t);
const mode = p => p.evaluate(() => dScanMode);

module.exports = async function run(env) {
  ({ B, check, pageErrors, consoleErrors, out: OUT } = env);
  const b = env.browser;
  await post('/__reset');

  // ===== 1. Zichtbaarheid: alleen Premium Plus + scanner aan =====
  for (const [tok, card, on, show, label] of [['tok-pp', 'pp', true, true, 'Premium Plus, scanner aan'], ['tok-pp', 'pp', false, false, 'Premium Plus, scanner uit'],
    ['tok-basic', 'basic', true, false, 'Basic (instelling aan)'], ['tok-pptrial', 'pptrial', true, true, 'Proef op Premium Plus'], ['tok-ptrial', 'ptrial', true, false, 'Proef op Premium']]) {
    const { ctx, p } = await open(b, tok, card, { scanner: on });
    check(`1. ${label}: keuze ${show ? 'zichtbaar' : 'niet zichtbaar'}`, (await vis(p, '#dModeSeg')) === show && (await mode(p)) === 'stamp');
    await ctx.close();
  }
  {
    const { ctx, p } = await open(b, 'tok-mgr', 'pp', { role: 'manager' });
    check('1. Medewerker (Premium Plus, scanner aan): keuze zichtbaar', await vis(p, '#dModeSeg'));
    await ctx.close();
  }

  // ===== 2. Stempelen blijft zoals het was =====
  let { ctx, p } = await open(b, 'tok-pp', 'pp');
  check('2. Standaard Stempelen, knop "Scan klant QR"', (await mode(p)) === 'stamp' && /Scan klant QR/.test(await txt(p, '#openCamBtn')) && !(await vis(p, '#dGiftEntry')));
  p.calls.length = 0;
  await scan(p, UUID); await p.waitForSelector('#customerView:not([hidden])', { timeout: 4000 }).catch(() => {});
  check('2. Stempelkaart in Stempelen → klantkaart, geen resolve', await vis(p, '#confirmBtn') && !p.calls.some(c => /resolve/.test(c)), p.calls.join('|'));
  await p.click('#cancelBtn');
  await p.screenshot({ path: OUT + '/' + 'dsc-stamp-1440.png' });

  // ===== 3. Cadeaubon-modus: resolve, afschrijven =====
  await p.click('#dModeGift'); await p.waitForTimeout(400);
  check('3. Cadeaubon gekozen: knop "Scan cadeaubon", code intypen zichtbaar, pil verschoven', (await mode(p)) === 'gift' && /Scan cadeaubon/.test(await txt(p, '#openCamBtn')) && await vis(p, '#dGiftEntry')
    && await p.evaluate(() => { const a = document.querySelector('#dModeSeg .mode-pill').getBoundingClientRect(), g = document.getElementById('dModeGift').getBoundingClientRect(); return Math.abs(a.left - g.left) < 6; }));
  check('3. Keuze onthouden op dit apparaat', (await p.evaluate(() => localStorage.getItem('omrz_scan_mode'))) === 'gift');
  await p.screenshot({ path: OUT + '/' + 'dsc-mode-gift-1440.png' });
  p.calls.length = 0;
  await scan(p, 'OMRZCB1:' + LONG); await p.waitForSelector('#giftScanView:not([hidden]) .gr', { timeout: 4000 }).catch(() => {});
  check('3. OMRZCB1:-QR → resolve → bon met saldo, ontvanger, korte code, status', (await txt(p, '#grBal')) === `€${NB}50,00` && /Sanne/.test(await txt(p, '.gr-to')) && /ABCD-EFGH-JK/.test(await txt(p, '.gr-code')) && /Actief/.test(await txt(p, '.gr .gc-badge'))
    && p.calls.join('|') === 'GET /api/stamp/scan/resolve', p.calls.join('|'));
  check('3. Afschrijven uit zolang er geen bedrag is', await p.isDisabled('#grNext'));
  await p.fill('#grAmount', '60');
  check('3. Meer dan het saldo → melding, knop uit', /meer dan het saldo/.test(await txt(p, '#grMsg')) && await p.isDisabled('#grNext'));
  await p.fill('#grAmount', '12,5');
  check('3. Knop toont het bedrag', /€\s12,50 afschrijven/.test(await txt(p, '#grNext')));
  await p.click('#grNext');
  check('3. Bevestiging met bedrag en nieuw saldo', (await txt(p, '#grConfirmAmt')) === `€${NB}12,50` && /37,50/.test(await txt(p, '.gr-confirm')));
  await p.screenshot({ path: OUT + '/' + 'dsc-confirm-1440.png' });
  await p.evaluate(() => { const b = document.getElementById('grConfirm'); b.click(); b.click(); });
  await p.waitForSelector('.gr-done', { timeout: 4000 }).catch(() => {});
  let st = await state(); const rb = st.log.redeem.slice(-1)[0];
  check('3. Dubbel tikken → één afschrijving', st.log.redeem.length === 1);
  check('3. Verzoek: card_id + gift_card_id + bedrag + sleutel, geen code', rb.card_id === 'pp' && rb.gift_card_id && !('code' in rb) && rb.amount_cents === 1250 && /^[0-9a-f-]{36}$/.test(rb.idempotency_key), JSON.stringify(rb));
  check('3. Resultaat: afgeschreven, nieuw saldo, referentie', /€\s12,50 afgeschreven/.test(await txt(p, '.gr-done h4')) && (await txt(p, '#grNewBal')) === `€${NB}37,50` && /^CB-\d{4}$/.test(await txt(p, '#grRef')));
  await p.screenshot({ path: OUT + '/' + 'dsc-done-1440.png' });
  await p.click('[data-gr-close]');
  check('3. Volgende scan → terug naar de scanner, modus Cadeaubon', await vis(p, '#openCamBtn') && !(await vis(p, '#giftScanView')) && (await mode(p)) === 'gift');

  // Korte code intypen
  p.calls.length = 0;
  await p.fill('#dGiftCode', 'abcdefghjk');
  check('3. Code wordt opgemaakt', (await p.inputValue('#dGiftCode')) === 'ABCD-EFGH-JK');
  await p.click('#dGiftCodeBtn'); await p.waitForSelector('.gr', { timeout: 4000 }).catch(() => {});
  check('3. Code intypen → resolve → bon', (await txt(p, '#grBal')) === `€${NB}37,50` && p.calls[0] === 'GET /api/stamp/scan/resolve');
  await p.click('#grFull');
  check('3. "Volledig saldo" vult het saldo in', (await p.inputValue('#grAmount')) === '37,50');
  await p.click('[data-gr-close]');
  await p.fill('#dGiftCode', 'ABC'); await p.click('#dGiftCodeBtn');
  check('3. Te korte code → melding', /10 tekens/.test(await txt(p, '#scanStatus')));

  // Geblokkeerd / leeg / verlopen: blocked_message, geen invoer
  for (const [code, re] of [['BZKD-0000-01', /Deze cadeaubon is geblokkeerd\./], ['EMPT-0000-02', /Deze cadeaubon is leeg\./], ['EXPR-0000-03', /Deze cadeaubon is verlopen\./]]) {
    await scan(p, code); await p.waitForSelector('.gr', { timeout: 4000 }).catch(() => {});
    check(`3. ${code}: blocked_message, geen afschrijfveld`, re.test(await txt(p, '#grStop')) && !(await vis(p, '#grAmount')), await txt(p, '#grStop'));
    if (code === 'BZKD-0000-01') await p.screenshot({ path: OUT + '/' + 'dsc-blocked-1440.png' });
    await p.click('[data-gr-close]');
  }

  // Stempelkaart in cadeaubon-modus → gewoon de stempelflow
  p.calls.length = 0;
  await scan(p, UUID); await p.waitForSelector('#customerView:not([hidden])', { timeout: 4000 }).catch(() => {});
  check('3. Stempelkaart in Cadeaubon → resolve zegt stamp_holder → stempelflow', await vis(p, '#confirmBtn') && p.calls[0] === 'GET /api/stamp/scan/resolve' && p.calls.includes('GET /api/stamp/lookup'), p.calls.join('|'));
  await p.click('#cancelBtn');

  // Foutmeldingen per soort, nooit een ruwe code
  const noCode = t => t && !/_|\b(400|401|403|404|500|503)\b/.test(t);
  for (const [code, re, label] of [['iets-dat-niemand-kent', /hoort niet bij een cadeaubon of een stempelkaart/, 'unknown_code'],
    ['OMRZCB1:ffffffffffffffffffffffffffffffff', /bestaat niet/, 'gift_card_not_found'], ['00000000-9a4d-4e6f-b7c2-1d0e5a9f8b34', /Klant niet gevonden/, 'holder_not_found']]) {
    await scan(p, code); await p.waitForTimeout(400);
    check(`3. ${label} → nette melding`, re.test(await txt(p, '#scanStatus')) && noCode(await txt(p, '#scanStatus')) && !(await vis(p, '#giftScanView')), await txt(p, '#scanStatus'));
  }
  // Netwerkfout bij afschrijven: zelfde sleutel bij opnieuw proberen
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('.gr');
  await p.fill('#grAmount', '5'); await p.click('#grNext');
  let first = true;
  await p.route('**/gift-cards/redeem', async route => { if (first) { first = false; const r = await route.fetch(); await r.text(); return route.abort('failed'); } return route.continue(); });
  await p.click('#grConfirm'); await p.waitForTimeout(500);
  check('3. Netwerkfout → "niet dubbel afgeschreven", bevestiging blijft', /niet dubbel afgeschreven/.test(await txt(p, '#grMsg')) && await vis(p, '#grConfirm'));
  await p.click('#grConfirm'); await p.waitForSelector('.gr-done', { timeout: 4000 }).catch(() => {});
  st = await state(); const two = st.log.redeem.slice(-2);
  check('3. Opnieuw = zelfde sleutel, één keer afgeschreven (37,50 → 32,50)', two[0].idempotency_key === two[1].idempotency_key && (await txt(p, '#grNewBal')) === `€${NB}32,50`);
  await p.unroute('**/gift-cards/redeem');
  await p.click('[data-gr-close]');
  // Onvoldoende saldo (iemand anders schreef net af): saldo bijgewerkt
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('.gr');
  await p.route('**/gift-cards/redeem', r => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'insufficient_balance', error: 'x', balance_cents: 500 }) }));
  await p.fill('#grAmount', '20'); await p.click('#grNext'); await p.click('#grConfirm'); await p.waitForTimeout(400);
  check('3. insufficient_balance → melding met saldo, saldo bijgewerkt', /Er staat nog €\s5,00/.test(await txt(p, '#grMsg')) && (await txt(p, '#grBal')) === `€${NB}5,00`);
  await p.unroute('**/gift-cards/redeem');
  await p.click('[data-gr-close]');
  await p.reload(); await p.waitForTimeout(900); await p.evaluate(() => activateTab('stempel')); await p.waitForTimeout(500);
  check('4. Zelfde apparaat, herladen: Cadeaubon nog gekozen', (await mode(p)) === 'gift' && (await p.getAttribute('#dModeGift', 'aria-selected')) === 'true');
  await ctx.close();

  // ===== 4. Camera netjes wisselen =====
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  check('4. Nieuw apparaat: standaard Stempelen', (await mode(p)) === 'stamp');
  await p.evaluate(() => {
    window.__streams = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const s = await orig(c); window.__streams.push(s); return s; };
    window.jsQR = () => null;
  });
  const live = () => p.evaluate(() => window.__streams.filter(s => s.getTracks().some(t => t.readyState === 'live')).length);
  await p.click('#openCamBtn'); await p.waitForTimeout(800);
  check('4. Camera aan in Stempelen', (await live()) === 1);
  await p.click('#dModeGift'); await p.waitForTimeout(900);
  check('4. Wisselen → oude stream dicht, nieuwe loopt', (await p.evaluate(() => window.__streams.length)) === 2 && (await live()) === 1 && /cadeaubon/i.test(await txt(p, '#scanStatus')));
  await p.evaluate(() => { for (let i = 0; i < 5; i++) document.getElementById(i % 2 ? 'dModeGift' : 'dModeStamp').click(); });
  await p.waitForTimeout(1500);
  check('4. Snel heen en weer → precies één camera aan', (await live()) === 1, 'live: ' + (await live()));
  await p.evaluate(() => activateTab('overzicht')); await p.waitForTimeout(300);
  check('4. Tab verlaten → camera uit', (await live()) === 0);
  await ctx.close();

  // ===== 5. Terugval en plan-slot =====
  for (const [f, label] of [[500, '500'], ['net', 'netwerkfout'], [404, 'route ontbreekt (404)']]) {
    await post('/__reset'); await post('/__cfg', { resolveFail: f });
    ({ ctx, p } = await open(b, 'tok-pp', 'pp', { expectErrors: true }));
    await p.click('#dModeGift'); p.calls.length = 0;
    await scan(p, 'OMRZCB1:' + LONG); await p.waitForSelector('.gr', { timeout: 6000 }).catch(() => {});
    check(`5. Terugval bij ${label}: lokale herkenning → bon via lookup`, (await txt(p, '#grBal')) === `€${NB}50,00` && p.calls.includes('GET /api/stamp/gift-cards/lookup'), p.calls.join('|'));
    await ctx.close();
  }
  await post('/__cfg', { resolveFail: null });
  ({ ctx, p } = await open(b, 'tok-pp', 'pp', { expectErrors: true }));
  await p.click('#dModeGift');
  await p.route('**/scan/resolve**', r => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'premium_plus_required', error: 'x' }) }));
  await scan(p, 'ABCD-EFGH-JK'); await p.waitForTimeout(400);
  check('5. premium_plus_required → melding, keuze weg, terug naar Stempelen', /Premium Plus/.test(await txt(p, '#scanStatus')) && !(await vis(p, '#dModeSeg')) && (await mode(p)) === 'stamp');
  await ctx.close();
  // Scanner uit: geen resolve, bon-QR → "staan uit"
  await post('/__reset');
  ({ ctx, p } = await open(b, 'tok-pp', 'pp', { scanner: false }));
  await scan(p, 'OMRZCB1:' + LONG); await p.waitForTimeout(300);
  check('5. Scanner uit: bon-QR → "Cadeaubonnen staan uit", geen resolve', /staan uit/.test(await txt(p, '#scanStatus')) && !(await state()).log.resolve);
  await ctx.close();

  // ===== 6. Schermformaten =====
  for (const vp of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await post('/__reset');
    ({ ctx, p } = await open(b, 'tok-pp', 'pp', { vp }));
    await p.click('#dModeGift'); await p.waitForTimeout(400);
    check(`6. ${vp.width}px scanner: geen horizontale scroll, knoppen ≥ 44px`, await noH(p) && await p.evaluate(() => ['dModeStamp', 'dModeGift'].every(id => document.getElementById(id).getBoundingClientRect().height >= 44)));
    await p.screenshot({ path: OUT + '/' + `dsc-gift-${vp.width}.png` });
    await scan(p, 'ABCD-EFGH-JK'); await p.waitForSelector('.gr');
    await p.fill('#grAmount', '1234,5');
    check(`6. ${vp.width}px bon: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `dsc-bon-${vp.width}.png`, fullPage: true });
    await ctx.close();
  }
  // Licht thema
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await p.click('#dModeGift'); await p.waitForTimeout(400); await scan(p, 'BZKD-0000-01'); await p.waitForSelector('.gr');
  await p.screenshot({ path: OUT + '/' + 'dsc-light-blocked-1440.png' });
  check('6. Licht thema: stopmelding leesbaar (donkerrood)', await p.evaluate(() => getComputedStyle(document.getElementById('grStop')).color) === 'rgb(185, 28, 28)');
  await ctx.close();
};
