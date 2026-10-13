// Dashboard, pagina Cadeaubonnen. Draait via tests/browser/run.js.
let B, check, pageErrors, consoleErrors, OUT;
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const state = () => fetch(B + '/__state').then(r => r.json());
const NB = ' ';
async function open(b, tok, card, vp, extra = {}) {
  const ctx = await b.newContext({ viewport: vp || { width: 1440, height: 1000 }, acceptDownloads: true, ...(extra.tz ? { timezoneId: extra.tz } : {}) });
  await ctx.addInitScript(([t, c, role]) => { if (!/dashboard/.test(location.pathname)) return; localStorage.setItem('omrz_token', t); localStorage.setItem('omrz_card_id', c); localStorage.setItem('omrz_role', role);
    if (role === 'manager') { localStorage.setItem('omrz_location_id', 'L1'); localStorage.setItem('omrz_location_name', 'Centrum'); } }, [tok, card, extra.role || 'owner']);
  const p = await ctx.newPage();
  p.on('pageerror', e => pageErrors.push(tok + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !extra.expectErrors) consoleErrors.push(tok + ': ' + m.text()); });
  p.on('dialog', d => d.accept());
  if (extra.log) p.on('request', r => { if (/gift-cards/.test(r.url())) extra.log.push(r.url()); });
  await p.goto(B + '/dashboard.html'); await p.waitForTimeout(900);
  await p.evaluate(() => activateTab('cadeaubonnen'));
  return { ctx, p };
}
const txt = (p, s) => p.evaluate(s => (document.querySelector(s) || {}).innerText || '', s);
const vis = (p, s) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, s);
const noH = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

module.exports = async function run(env) {
  ({ B, check, pageErrors, consoleErrors, out: OUT } = env);
  const b = env.browser;
  await post('/__reset');
  // ===== 1. Premium Plus eigenaar: overzicht en lijst =====
  let { ctx, p } = await open(b, 'tok-pp', 'pp');
  await p.waitForSelector('.gc-row');
  check('1. Openstaand tegoed uit totals', (await txt(p, '#gcOutstanding')) === `€${NB}65,00`, await txt(p, '#gcOutstanding'));
  check('1. Actieve bonnen uit totals', (await txt(p, '#gcActive')) === '2');
  const badges = await p.$$eval('.gc-row', rs => Object.fromEntries(rs.map(r => [r.querySelector('.gc-code').textContent, [r.querySelector('.gc-badge').className.replace('gc-badge ', ''), r.querySelector('.gc-badge').textContent]])));
  const sortObj = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  check('1. Lijst: eigen label en kleurklasse per status', sortObj(badges) === sortObj({
    'PAST-0000-05': ['expired', 'Verlopen'], 'EMPT-0000-02': ['empty', 'Leeg'], 'BLKD-0000-01': ['blocked', 'Geblokkeerd'],
    'ABCD-EFGH-JK': ['active', 'Actief'], 'EXPI-0000-03': ['expired', 'Verlopen'] }), JSON.stringify(badges));
  const colors = await p.$$eval('.gc-badge', bs => [...new Set(bs.map(b => b.className + '|' + getComputedStyle(b).color))]);
  check('1. Vier statussen, vier verschillende kleuren', new Set(colors.map(c => c.split('|')[1])).size === 4, colors.join(' '));
  check('1. Status "active" met verstreken vervaldatum → Verlopen (voorrang)', badges['PAST-0000-05'][0] === 'expired');
  check('1. Rij toont saldo, oorspronkelijk bedrag, ontvanger, korte code, datum', await p.evaluate(() => { const r = [...document.querySelectorAll('.gc-row')].find(x => /Sanne/.test(x.innerText)); return /€\s50,00/.test(r.innerText) && /van €\s50,00/.test(r.innerText) && /ABCD-EFGH-JK/.test(r.innerText) && /20\d\d/.test(r.innerText); }));
  await p.click('.gc-row >> text=Peter Verstreken'); await p.waitForSelector('.gc-detail');
  check('1. Detail: zelfde label en kleur (Verlopen)', /Verlopen/.test(await txt(p, '.gc-hero')) && await p.evaluate(() => !!document.querySelector('.gc-hero .gc-badge.expired')));
  await p.click('#modalClose');
  await p.fill('#gcSearch', 'abcd'); await p.waitForTimeout(600);
  check('1. Zoeken op korte code', (await p.$$('.gc-row')).length === 1);
  await p.fill('#gcSearch', 'sanne'); await p.waitForTimeout(600);
  check('1. Zoeken op naam', (await p.$$('.gc-row')).length === 1);
  await p.fill('#gcSearch', 'zzz'); await p.waitForTimeout(600);
  check('1. Lege staat bij geen resultaten', /Geen cadeaubonnen gevonden/.test(await txt(p, '#gcListBox')));
  await p.fill('#gcSearch', ''); await p.selectOption('#gcStatusFilter', 'blocked'); await p.waitForTimeout(500);
  check('1. Statusfilter geblokkeerd', (await p.$$('.gc-row')).length === 1 && /Daan/.test(await txt(p, '#gcListBox')));
  await p.selectOption('#gcStatusFilter', ''); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/' + 'gcd-list-1440.png', fullPage: true });

  // ===== 2. Nieuwe cadeaubon =====
  await p.click('[data-gc-new]'); await p.waitForSelector('#gcNewForm');
  await p.click('#gcNewBtn');
  check('2. Zonder bedrag: nette melding', /geldig bedrag/.test(await txt(p, '#gcNewNote')));
  await p.fill('#gcAmount', '30,505'); await p.click('#gcNewBtn');
  check('2. 3 decimalen geweigerd', /geldig bedrag/.test(await txt(p, '#gcNewNote')));
  await p.click('[data-gc-quick="2500"]');
  check('2. Snelkeuze €25 vult "25,00" en is actief', (await p.inputValue('#gcAmount')) === '25,00' && await p.evaluate(() => document.querySelector('[data-gc-quick="2500"]').classList.contains('active')));
  await p.fill('#gcRecEmail', 'geen-email'); await p.click('#gcNewBtn');
  check('2. Ongeldig e-mailadres geweigerd', /e-mailadres/.test(await txt(p, '#gcNewNote')));
  await p.fill('#gcRecEmail', 'mila@example.nl'); await p.fill('#gcRecName', 'Mila'); await p.fill('#gcMessage', 'Fijne verjaardag!');
  await p.screenshot({ path: OUT + '/' + 'gcd-new-1440.png' });
  await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
  const st1 = await state(); const sent = st1.log.create[st1.log.create.length - 1];
  check('2. Verstuurd: amount_cents 2500 + optionele velden', sent.amount_cents === 2500 && sent.recipient_name === 'Mila' && sent.recipient_email === 'mila@example.nl' && sent.message === 'Fijne verjaardag!' && !('expires_at' in sent) && sent.card_id === 'pp', JSON.stringify(sent));
  const succ = await txt(p, '.gc-success');
  check('2. Succes: kassa-instructie, korte code, referentie', /Boek op de kassa als verkoop cadeaubon:\s*€\s25,00/.test(succ) && /CB-\d{4}/.test(succ) && /[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{2}/.test(succ));
  const link = await p.inputValue('.gc-success .gc-link input');
  check('2. Deelbare link getoond', /^https:\/\/omrzdigital\.nl\/cadeaubon\//.test(link), link);
  const wa = await p.getAttribute('.gc-success a[href^="https://wa.me/"]', 'href');
  check('2. WhatsApp-knop met voorgevulde tekst + link', decodeURIComponent(wa).includes(link) && /cadeaubon van €\s25,00 gekregen bij Loris Parfum/.test(decodeURIComponent(wa)));
  check('2. QR-code van de link gerenderd', await p.evaluate(() => !!document.querySelector('#gcQr img, #gcQr canvas')));
  await p.screenshot({ path: OUT + '/' + 'gcd-success-1440.png' });
  await p.click('[data-gc-close]'); await p.waitForTimeout(500);
  check('2. Lijst en totaal ververst (6 bonnen, openstaand € 90,00)', (await p.$$('.gc-row')).length === 6 && (await txt(p, '#gcOutstanding')) === `€${NB}90,00`, await txt(p, '#gcOutstanding'));
  // vervaldatum in het verleden en geldige
  await p.click('[data-gc-new]'); await p.waitForSelector('#gcNewForm');
  await p.fill('#gcAmount', '12,5'); await p.evaluate(() => { document.getElementById('gcExpires').value = '2020-01-01'; });
  await p.click('#gcNewBtn');
  check('2. Vervaldatum in het verleden geweigerd', /toekomst/.test(await txt(p, '#gcNewNote')));
  await p.evaluate(() => { document.getElementById('gcExpires').value = '2027-03-31'; });
  await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
  const s2 = (await state()).log.create.slice(-1)[0];
  check('2. Eigen bedrag 12,5 → 1250 cent, expires_at = 31-3-2027 23:59:59 Amsterdam', s2.amount_cents === 1250 && s2.expires_at === '2027-03-31T21:59:59.000Z', s2.expires_at);
  await p.click('[data-gc-close]');
  {
    // Zelfde datum vanaf een apparaat in New York: nog steeds het einde van de dag in Amsterdam.
    const ny = await open(b, 'tok-pp', 'pp', null, { tz: 'America/New_York' });
    await ny.p.waitForSelector('.gc-row');
    for (const [day, want] of [['2027-03-31', '2027-03-31T21:59:59.000Z'], ['2027-01-15', '2027-01-15T22:59:59.000Z']]) {
      await ny.p.click('[data-gc-new]'); await ny.p.waitForSelector('#gcNewForm');
      await ny.p.fill('#gcAmount', '10'); await ny.p.evaluate(d => { document.getElementById('gcExpires').value = d; }, day);
      await ny.p.click('#gcNewBtn'); await ny.p.waitForSelector('.gc-success');
      const got = (await state()).log.create.slice(-1)[0].expires_at;
      check(`2. Browser in New York, vervaldatum ${day} → ${want}`, got === want, got);
      await ny.p.click('[data-gc-close]');
    }
    await ny.ctx.close();
  }

  // ===== 3. Detail en eigenaar-acties =====
  await p.waitForTimeout(400);
  await p.click('.gc-row >> text=Sanne de Vries'); await p.waitForSelector('.gc-detail');
  check('3. Detail: saldo, transacties (uitgifte)', /€\s50,00/.test(await txt(p, '.gc-hero')) && /Uitgifte/.test(await txt(p, '.gc-table')));
  check('3. Eigenaar ziet Corrigeren en Blokkeren', await vis(p, '[data-gc-adjust-open]') && await vis(p, '[data-gc-block]'));
  await p.click('[data-gc-adjust-open]');
  await p.fill('#gcAdjAmt', '5'); await p.click('#gcAdjBtn');
  check('3. Correctie zonder notitie geweigerd', /notitie is verplicht/.test(await txt(p, '#gcDetailNote')));
  await p.selectOption('#gcAdjSign', '-1'); await p.fill('#gcAdjNote', 'Kassaverschil'); await p.click('#gcAdjBtn');
  await p.waitForFunction(() => /gecorrigeerd/.test(document.getElementById('gcDetailNote').textContent));
  check('3. Correctie −€5: saldo € 45,00 + regel Correctie', /€\s45,00/.test(await txt(p, '.gc-hero')) && /Correctie/.test(await txt(p, '.gc-table')));
  await p.click('[data-gc-block="block"]');
  await p.waitForFunction(() => /geblokkeerd ✓/.test(document.getElementById('gcDetailNote').textContent));
  check('3. Blokkeren → badge Geblokkeerd, knop Deblokkeren', /Geblokkeerd/.test(await txt(p, '.gc-hero')) && await vis(p, '[data-gc-block="unblock"]'));
  await p.click('[data-gc-block="unblock"]');
  await p.waitForFunction(() => /gedeblokkeerd ✓/.test(document.getElementById('gcDetailNote').textContent));
  check('3. Deblokkeren → weer Actief', /Actief/.test(await txt(p, '.gc-hero')));
  await p.screenshot({ path: OUT + '/' + 'gcd-detail-1440.png' });
  await p.click('#modalClose');
  // Terugdraaien op de lege bon (afschrijving van €10)
  await p.click('.gc-row >> text=Zonder naam'); await p.waitForSelector('.gc-detail');
  // Er zijn er mogelijk twee "Zonder naam"; zoek de lege bon
  const g = (await state()).gifts.find(x => x.short_code === 'EMPT-0000-02');
  await p.evaluate(id => openGiftDetail(id), g.id); await p.waitForSelector('[data-gc-reverse]');
  const revId = await p.getAttribute('[data-gc-reverse]', 'data-gc-reverse');
  await p.click('[data-gc-reverse]');
  await p.waitForFunction(() => /teruggedraaid ✓/.test(document.getElementById('gcDetailNote').textContent));
  check('3. Terugdraaien (met bevestiging): saldo terug op € 10,00', /€\s10,00/.test(await txt(p, '.gc-hero')) && /Teruggedraaid/.test(await txt(p, '.gc-table')));
  check('3. Teruggedraaide afschrijving: "Teruggedraaid" i.p.v. de knop', !(await p.$(`[data-gc-reverse="${revId}"]`)) && (await p.$$('.gc-reversed')).length === 1);
  await p.click('#modalClose'); await p.evaluate(id => openGiftDetail(id), g.id); await p.waitForSelector('.gc-detail');
  check('3. Ook na opnieuw openen: geen Terugdraaien-knop meer', (await p.$$('[data-gc-reverse]')).length === 0 && (await p.$$('.gc-reversed')).length === 1);
  await p.screenshot({ path: OUT + '/' + 'gcd-reversed-1440.png' });
  // already_reversed: dezelfde transactie nogmaals
  await p.evaluate(id => reverseGiftTx(id, -1000, document.createElement('button')), revId);
  await p.waitForFunction(() => /al teruggedraaid/.test(document.getElementById('gcDetailNote').textContent));
  check('3. already_reversed → Nederlandse melding', true);
  await p.click('#modalClose');

  // ===== 4. Rapport =====
  await p.click('[data-gc-view="report"]'); await p.waitForSelector('#gcReportBox .stat-grid');
  const now = new Date(); const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  check('4. Standaard deze maand', (await p.inputValue('#gcRepFrom')) === first && (await p.inputValue('#gcRepTo')) === now.toISOString().slice(0, 10) || (await p.inputValue('#gcRepFrom')) === first, await p.inputValue('#gcRepFrom') + ' t/m ' + await p.inputValue('#gcRepTo'));
  const rep = await txt(p, '#gcReportBox');
  check('4. Vijf totaalkaarten', ['Verkocht', 'Ingewisseld', 'Teruggedraaid', 'Netto ingewisseld', 'Openstaand'].every(w => rep.includes(w)));
  check('4. Dagtabel + uitleg voor boekhouder', (await p.$$('#gcReportBox tbody tr')).length >= 1 && rep.includes('Verkocht en ingewisseld staan apart, handig voor uw boekhouder.'));
  check('4. Vestigingsfilter (2 vestigingen)', await vis(p, '#gcRepLoc'));
  await p.screenshot({ path: OUT + '/' + 'gcd-report-1440.png', fullPage: true });
  const reqP = p.waitForRequest(r => r.url().includes('format=csv'));
  const dlP = p.waitForEvent('download');
  await p.click('[data-gc-csv]');
  const [req, dl] = await Promise.all([reqP, dlP]);
  check('4. Download CSV met Authorization-header en juiste bestandsnaam', /Bearer tok-pp/.test(req.headers()['authorization'] || '') && /^cadeaubonnen-.*\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await p.evaluate(() => { document.getElementById('gcRepFrom').value = '2026-12-01'; document.getElementById('gcRepFrom').dispatchEvent(new Event('change')); });
  check('4. Van na Tot → melding', /geldig datumbereik/.test(await txt(p, '#gcReportBox')));
  await ctx.close();

  // ===== 5. Manager: pagina Cadeaubonnen bestaat niet =====
  const mgrLog = [];
  ({ ctx, p } = await open(b, 'tok-mgr', 'pp', null, { role: 'manager', log: mgrLog }));
  await p.waitForTimeout(500);
  check('5. Manager: geen menu-item Cadeaubonnen', await p.evaluate(() => { const l = document.getElementById('navCadeaubonnen'); return !l || l.hidden || l.getBoundingClientRect().width === 0; }));
  check('5. Manager: activateTab opent de pagina niet', await p.evaluate(() => !document.getElementById('panel-cadeaubonnen').classList.contains('active')) && !(await vis(p, '#gcWrap')));
  await p.evaluate(() => loadGiftCards()); await p.waitForTimeout(300);
  check('5. Manager: ook direct aanroepen toont niets (geen Nieuwe cadeaubon of Rapport)', (await p.$$('[data-gc-new], [data-gc-view], #gcReportView')).length === 0);
  check('5. Manager: geen enkele cadeaubon-aanroep', mgrLog.length === 0, mgrLog.length + ' aanroepen');
  await ctx.close();

  // ===== 6. Basic plan: slot =====
  ({ ctx, p } = await open(b, 'tok-basic', 'basic'));
  await p.waitForTimeout(500);
  check('6. Basic: vergrendelde staat met upgrade-knop', /Premium Plus functie/.test(await txt(p, '#gcWrap')) && await vis(p, '#gcWrap [data-plan-upgrade]') && (await state()).log.create.every(c => c.card_id !== 'basic'));
  check('6. Basic: slotje in het menu', await p.evaluate(() => document.getElementById('navCadeaubonnen').classList.contains('locked')));
  await p.click('#gcWrap [data-plan-upgrade]'); await p.waitForTimeout(300);
  check('6. Upgrade-knop opent bestaande abonnement-flow', await p.evaluate(() => !document.getElementById('subModal').hidden));
  await p.screenshot({ path: OUT + '/' + 'gcd-lock-1440.png' });
  await ctx.close();
  // Proefperiode: alleen het pakket van de proef telt
  for (const [tok, card, locked, label] of [['tok-trial', 'trial', true, 'Proef op Basic'], ['tok-ptrial', 'ptrial', true, 'Proef op Premium'], ['tok-pptrial', 'pptrial', false, 'Proef op Premium Plus']]) {
    const log = [];
    ({ ctx, p } = await open(b, tok, card, null, { log }));
    await p.waitForTimeout(900);
    const isLocked = /Premium Plus functie/.test(await txt(p, '#gcWrap'));
    const navLocked = await p.evaluate(() => document.getElementById('navCadeaubonnen').classList.contains('locked'));
    check(`6. ${label}: ${locked ? 'vergrendeld met upgrade-knop, slotje in menu' : 'niet vergrendeld, bonnen zichtbaar'}`,
      locked ? (isLocked && navLocked && await vis(p, '#gcWrap [data-plan-upgrade]')) : (!isLocked && !navLocked && await vis(p, '[data-gc-new]') && (await p.$$('.gc-row')).length === 1));
    await ctx.close();
  }
  // Backend weigert (premium_plus_required) terwijl het pakket nog onbekend is → toch het slot
  {
    const c2 = await b.newContext({ viewport: { width: 1440, height: 1000 } });
    await c2.addInitScript(() => { if (!/dashboard/.test(location.pathname)) return; localStorage.setItem('omrz_token', 'tok-ptrial'); localStorage.setItem('omrz_card_id', 'ptrial'); });
    const p2 = await c2.newPage();
    await p2.route('**/api/stamp/subscription', r => r.fulfill({ status: 500, body: '{}' }));   // pakket blijft onbekend
    await p2.goto(B + '/dashboard.html'); await p2.waitForTimeout(800);
    await p2.evaluate(() => activateTab('cadeaubonnen')); await p2.waitForTimeout(700);
    check('6. Pakket onbekend + backend premium_plus_required → vergrendeld', /Premium Plus functie/.test(await txt(p2, '#gcWrap')));
    await c2.close();
  }

  // ===== 7. Backend niet live + overige foutcodes =====
  await post('/__cfg', { notLive: true });
  ({ ctx, p } = await open(b, 'tok-pp', 'pp', null, { expectErrors: true }));
  await p.waitForSelector('#gcWrap .empty-state');
  check('7. 404 zonder code: rustige melding', /nog niet beschikbaar/.test(await txt(p, '#gcWrap')));
  await p.evaluate(() => activateTab('overzicht')); await p.waitForTimeout(500);
  check('7. Rest van het dashboard werkt (overzicht laadt)', /3/.test(await txt(p, '#statCustomers')));
  await post('/__cfg', { notLive: false, rateLimited: true });
  await p.evaluate(() => activateTab('cadeaubonnen')); await p.click('[data-gc-retry]'); await p.waitForTimeout(600);
  // shell bestaat nog niet → loadGiftCards; lijst geeft rate_limited
  check('7. rate_limited → "Te veel pogingen"', /Te veel pogingen/.test(await txt(p, '#gcWrap')), (await txt(p, '#gcWrap')).slice(0, 80));
  await post('/__cfg', { rateLimited: false });
  await ctx.close();

  // ===== 8. Schermformaten =====
  for (const vp of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    ({ ctx, p } = await open(b, 'tok-pp', 'pp', vp));
    await p.waitForSelector('.gc-row');
    check(`8. ${vp.width}px lijst: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcd-list-${vp.width}.png`, fullPage: true });
    await p.click('.gc-row >> text=Sanne de Vries'); await p.waitForSelector('.gc-detail');
    check(`8. ${vp.width}px detail: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcd-detail-${vp.width}.png` });
    await p.click('#modalClose');
    await p.click('[data-gc-new]'); await p.click('[data-gc-quick="5000"]'); await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
    check(`8. ${vp.width}px succesblok: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcd-success-${vp.width}.png`, fullPage: true });
    await p.click('[data-gc-close]');
    await p.click('[data-gc-view="report"]'); await p.waitForSelector('#gcReportBox .stat-grid');
    check(`8. ${vp.width}px rapport: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcd-report-${vp.width}.png`, fullPage: true });
    await ctx.close();
  }
};
