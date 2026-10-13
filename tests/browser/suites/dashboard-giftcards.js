// Dashboard, pagina Cadeaubonnen. Draait via tests/browser/run.js.
let B, check, pageErrors, consoleErrors, OUT;
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const state = () => fetch(B + '/__state').then(r => r.json());
const NB = ' ';
async function open(b, tok, card, vp, extra = {}) {
  const ctx = await b.newContext({ viewport: vp || { width: 1440, height: 1000 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...(extra.tz ? { timezoneId: extra.tz } : {}) });
  await ctx.addInitScript(([t, c, role]) => { if (!/dashboard/.test(location.pathname)) return; localStorage.setItem('omrz_token', t); localStorage.setItem('omrz_card_id', c); localStorage.setItem('omrz_role', role);
    if (role === 'manager') { localStorage.setItem('omrz_location_id', 'L1'); localStorage.setItem('omrz_location_name', 'Centrum'); } }, [tok, card, extra.role || 'owner']);
  const p = await ctx.newPage();
  p.on('pageerror', e => pageErrors.push(tok + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !extra.expectErrors) consoleErrors.push(tok + ': ' + m.text()); });
  // Bevestigingsvensters onthouden; p.dismissNext = true weigert het volgende.
  p.dialogs = [];
  p.on('dialog', d => { p.dialogs.push(d.message()); if (p.dismissNext) { p.dismissNext = false; d.dismiss(); } else d.accept(); });
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
  {
    // Backend stuurt het nummer als transaction.reference_number: precies dat moet in beeld staan.
    const st = await state(); const issue = st.txs.filter(t => t.type === 'issue').slice(-1)[0];
    const shown = await p.$$eval('.gc-success .gc-fact', fs => (fs.find(f => /Referentienummer/.test(f.innerText)) || {}).innerText || '');
    check('2. Referentienummer uit transaction.reference_number in beeld (niet "—")', shown.includes(issue.reference_number) && !/—/.test(shown), shown.replace(/\s+/g, ' '));
  }
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

  // ===== 9. Schakelaar "Cadeaubon-scanner voor uw medewerkers" =====
  await post('/__reset');
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.waitForSelector('.gc-row'); await p.waitForFunction(() => !document.getElementById('gcScannerSwitch').disabled);
  check('9. Schakelaar bovenaan de pagina, standaard uit', await vis(p, '#gcScannerSwitch') && !(await p.isChecked('#gcScannerSwitch'))
    && await p.evaluate(() => document.querySelector('.gc-setting').getBoundingClientRect().top < document.querySelector('.gc-top').getBoundingClientRect().top)
    && /Cadeaubon-scanner voor uw medewerkers/.test(await txt(p, '.gc-setting')));
  await p.click('#gcScannerSwitch');
  await p.waitForFunction(() => /Aan\./.test(document.getElementById('gcScannerNote').textContent));
  let st9 = await state();
  const put1 = st9.log.settingsPut.slice(-1)[0];
  check('9. Aanzetten → PUT body exact {"card_id":"pp","enabled":true} (echte boolean), Content-Type application/json',
    put1.raw === '{"card_id":"pp","enabled":true}' && put1.body.enabled === true && typeof put1.body.enabled === 'boolean' && /^application\/json/.test(put1.contentType || ''), JSON.stringify(put1));
  check('9. Aanzetten → schakelaar aan + bevestiging over het blok "Cadeaubon scannen"', true
    && /Cadeaubon scannen/.test(await txt(p, '#gcScannerNote')) && await p.isChecked('#gcScannerSwitch') && p.dialogs.length === 0);
  const open9 = (await state()).gifts.filter(g => g.card_id === 'pp' && g.status === 'active').reduce((n, g) => n + g.balance_cents, 0);
  const euro = '€' + NB + (open9 / 100).toFixed(2).replace('.', ',');
  const want9 = `Er staat nog ${euro} aan tegoed open. Uitzetten verbergt de scanner voor uw medewerkers. Bestaande bonnen blijven geldig en kunnen weer worden ingewisseld zodra u de scanner aanzet.`;
  p.dismissNext = true;
  await p.click('#gcScannerSwitch'); await p.waitForTimeout(400);
  check('9. Uitzetten met open tegoed → exacte waarschuwing; Annuleren laat hem aan, geen PUT', p.dialogs.slice(-1)[0] === want9 && await p.isChecked('#gcScannerSwitch') && (await state()).log.settingsPut.length === 1, p.dialogs.slice(-1)[0]);
  await p.click('#gcScannerSwitch');
  await p.waitForFunction(() => /Uit\./.test(document.getElementById('gcScannerNote').textContent));
  const put2 = (await state()).log.settingsPut.slice(-1)[0];
  check('9. Bevestigen → PUT body exact {"card_id":"pp","enabled":false}, schakelaar uit', put2.raw === '{"card_id":"pp","enabled":false}' && typeof put2.body.enabled === 'boolean' && !(await p.isChecked('#gcScannerSwitch')), put2.raw);
  // Mislukt opslaan → terugzetten + melding
  await post('/__cfg', { settingsFail: 'putFail' });
  await p.click('#gcScannerSwitch'); await p.waitForFunction(() => /Niet opgeslagen/.test(document.getElementById('gcScannerNote').textContent));
  check('9. Opslaan mislukt → schakelaar terug (uit) + melding', !(await p.isChecked('#gcScannerSwitch')) && /Opslaan mislukt op de server/.test(await txt(p, '#gcScannerNote')) && !(await p.isDisabled('#gcScannerSwitch')));
  await post('/__cfg', { settingsFail: null });
  // Na herladen: de server is leidend
  await post('/__settings', { card: 'pp', on: true });
  await p.reload(); await p.waitForTimeout(800); await p.evaluate(() => activateTab('cadeaubonnen'));
  await p.waitForFunction(() => !document.getElementById('gcScannerSwitch').disabled);
  check('9. Stand komt van de server (aan na herladen)', await p.isChecked('#gcScannerSwitch'));
  await ctx.close();
  // Geen open tegoed → geen waarschuwing
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.route('**/api/stamp/gift-cards?*', async r => { const res = await r.fetch(); const j = await res.json(); j.totals = { outstanding_cents: 0, active_count: 0 }; r.fulfill({ response: res, json: j }); });
  await p.evaluate(() => loadGiftList(true)); await p.waitForTimeout(400);
  await p.waitForFunction(() => !document.getElementById('gcScannerSwitch').disabled);
  await p.click('#gcScannerSwitch');
  await p.waitForFunction(() => /Uit\./.test(document.getElementById('gcScannerNote').textContent));
  check('9. Uitzetten zonder open tegoed → geen waarschuwing, direct uit', p.dialogs.length === 0 && !(await p.isChecked('#gcScannerSwitch')));
  await ctx.close();
  // Ophalen mislukt → uit en niet te bedienen, met melding
  for (const [f, re, label] of [[500, /Instelling niet geladen/, 'serverfout'], [404, /nog niet beschikbaar/, '404'], ['migration', /nog niet beschikbaar/, 'migration_missing']]) {
    await post('/__cfg', { settingsFail: f });
    ({ ctx, p } = await open(b, 'tok-pp', 'pp', null, { expectErrors: true }));
    await p.waitForSelector('.gc-row'); await p.waitForTimeout(300);
    check(`9. Ophalen ${label} → schakelaar uit en vergrendeld, melding`, !(await p.isChecked('#gcScannerSwitch')) && await p.isDisabled('#gcScannerSwitch') && re.test(await txt(p, '#gcScannerNote')), await txt(p, '#gcScannerNote'));
    await ctx.close();
  }
  await post('/__cfg', { settingsFail: null });

  // ===== 10. Nieuwe cadeaubon: koper, ontvanger, verzending =====
  await post('/__reset');
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.waitForSelector('.gc-row');
  const newForm = async () => { await p.click('[data-gc-new]'); await p.waitForSelector('#gcNewForm'); };
  const note = () => txt(p, '#gcNewNote');
  const creates = async () => (await state()).log.create.length;
  await newForm();
  const legends = await p.$$eval('#gcNewForm legend', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  check('10. Formulier: blokken Koper (optioneel), Ontvanger (optioneel), Verzending; standaard "Geen e-mail"',
    JSON.stringify(legends) === JSON.stringify(['Koper (optioneel)', 'Ontvanger (optioneel)', 'Verzending']) && await p.isChecked('input[name="gcDelivery"][value="none"]')
    && !(await vis(p, '#gcRecReq')) && !(await vis(p, '#gcBuyerReq')), JSON.stringify(legends));
  await p.click('[data-gc-quick="2500"]');
  await p.check('input[name="gcDelivery"][value="recipient"]');
  check('10. "Direct naar de ontvanger" → vooraf: e-mail ontvanger verplicht', await vis(p, '#gcRecReq') && !(await vis(p, '#gcBuyerReq')));
  let c0 = await creates();
  await p.click('#gcNewBtn');
  check('10. Zonder e-mail ontvanger: nette melding, niets verstuurd, focus op het veld', /e-mailadres van de ontvanger in/.test(await note()) && await creates() === c0 && await p.evaluate(() => document.activeElement.id) === 'gcRecEmail');
  await p.check('input[name="gcDelivery"][value="buyer"]');
  check('10. "Ik stuur hem zelf door" → vooraf: e-mail koper verplicht', await vis(p, '#gcBuyerReq') && !(await vis(p, '#gcRecReq')));
  await p.click('#gcNewBtn');
  check('10. Zonder e-mail koper: nette melding', /e-mailadres van de koper in/.test(await note()) && await creates() === c0);
  await p.check('input[name="gcDelivery"][value="none"]'); await p.fill('#gcBuyerEmail', 'geen-mail'); await p.click('#gcNewBtn');
  check('10. Ongeldig e-mailadres koper', /e-mailadres van de koper klopt niet/.test(await note()));
  await p.fill('#gcBuyerEmail', ''); await p.fill('#gcRecEmail', 'x@'); await p.click('#gcNewBtn');
  check('10. Ongeldig e-mailadres ontvanger', /e-mailadres van de ontvanger klopt niet/.test(await note()));
  await p.fill('#gcRecEmail', '');
  // Foutcodes van de server vertaald
  for (const [code, re] of [['invalid_delivery_mode', /Kies hoe de cadeaubon verstuurd wordt/], ['buyer_email_required', /e-mailadres van de koper in/], ['recipient_email_required', /e-mailadres van de ontvanger in/],
    ['invalid_buyer_email', /koper klopt niet/], ['invalid_recipient_email', /ontvanger klopt niet/]]) {
    await p.route('**/api/stamp/gift-cards', r => r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, code, error: 'x' }) }) : r.continue());
    await p.click('#gcNewBtn'); await p.waitForTimeout(250);
    check(`10. Server ${code} → Nederlandse melding`, re.test(await note()), await note());
    await p.unroute('**/api/stamp/gift-cards');
  }
  // Server invalid_expires_at (bijv. als de klok van het apparaat afwijkt)
  await p.route('**/api/stamp/gift-cards', r => r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'invalid_expires_at', error: 'x' }) }) : r.continue());
  await p.click('#gcNewBtn'); await p.waitForTimeout(250);
  check('10. Server invalid_expires_at → nette melding', /vervaldatum klopt niet of ligt in het verleden/.test(await note()), await note());
  await p.unroute('**/api/stamp/gift-cards');
  // Ontvangerblok leeg, geen e-mail
  await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
  let body = (await state()).log.create.slice(-1)[0];
  check('10. Leeg ontvangerblok + geen e-mail: body zonder koper/ontvanger, delivery_mode none, met sleutel',
    JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['amount_cents', 'card_id', 'delivery_mode', 'idempotency_key']) && body.delivery_mode === 'none' && /^[0-9a-f-]{36}$/.test(body.idempotency_key), JSON.stringify(body));
  check('10. Resultaat: "geen e-mail verstuurd", link en kassa-instructie blijven', /geen e-mail verstuurd/.test(await txt(p, '.gc-success')) && /Boek op de kassa/.test(await txt(p, '.gc-success')));
  await p.click('[data-gc-close]');
  // Direct naar de ontvanger, mail lukt
  await newForm(); await p.click('[data-gc-quick="5000"]');
  await p.fill('#gcBuyerName', 'Kees'); await p.fill('#gcBuyerEmail', 'kees@example.nl');
  await p.fill('#gcRecName', 'Mila'); await p.fill('#gcRecEmail', 'mila@example.nl'); await p.fill('#gcMessage', 'Fijne dag!');
  await p.check('input[name="gcDelivery"][value="recipient"]');
  await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
  body = (await state()).log.create.slice(-1)[0];
  check('10. Body met koper, ontvanger, bericht en delivery_mode recipient', body.buyer_name === 'Kees' && body.buyer_email === 'kees@example.nl' && body.recipient_name === 'Mila'
    && body.recipient_email === 'mila@example.nl' && body.message === 'Fijne dag!' && body.delivery_mode === 'recipient' && body.amount_cents === 5000, JSON.stringify(body));
  check('10. Mail gelukt → "Mail verstuurd naar de ontvanger (mila@example.nl)"', /Mail verstuurd naar de ontvanger \(mila@example\.nl\)/.test(await txt(p, '.gc-mails')));
  await p.click('[data-gc-close]');
  // Mail mislukt: bon bestaat wel, Opnieuw versturen
  await post('/__cfg', { mailFail: 'recipient' });
  await newForm(); await p.click('[data-gc-quick="1000"]'); await p.fill('#gcRecEmail', 'stuk@example.nl'); await p.check('input[name="gcDelivery"][value="recipient"]');
  c0 = (await state()).gifts.length;
  await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
  check('10. Mail mislukt → "Bon is aangemaakt, mail is niet verstuurd" + knop Opnieuw versturen; bon bestaat', /Bon is aangemaakt, mail is niet verstuurd/.test(await txt(p, '.gc-mails'))
    && await vis(p, '[data-gc-resend-now="recipient"]') && (await state()).gifts.length === c0 + 1 && /Korte code/.test(await txt(p, '.gc-success')));
  await p.screenshot({ path: OUT + '/gcd-mailfail-1440.png' });
  await post('/__cfg', { mailFail: null });
  await p.click('[data-gc-resend-now="recipient"]'); await p.waitForTimeout(400);
  const waitNote = await p.$eval('[data-gc-mailrow="recipient"] [data-gc-resend-note]', e => ({ t: e.textContent, c: e.className }));
  check('10. Direct opnieuw → 429: "Net al verstuurd, probeer over X seconden", geen rode fout', /^Net al verstuurd, probeer over \d+ seconden\.$/.test(waitNote.t) && !/error/.test(waitNote.c), JSON.stringify(waitNote));
  await post('/__cfg', { resendWait: 0 });
  await p.click('[data-gc-resend-now="recipient"]'); await p.waitForTimeout(400);
  check('10. Later opnieuw → verstuurd', /Opnieuw verstuurd naar de ontvanger/.test(await txt(p, '.gc-mails')) && JSON.stringify((await state()).log.resend.slice(-1)[0]) === '{"target":"recipient"}');
  await p.click('[data-gc-close]');
  await post('/__cfg', { resendWait: 60 });
  // Koper-mail mislukt
  await post('/__cfg', { mailFail: 'buyer' });
  await newForm(); await p.click('[data-gc-quick="1000"]'); await p.fill('#gcBuyerEmail', 'koper@example.nl'); await p.check('input[name="gcDelivery"][value="buyer"]');
  await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
  check('10. "Ik stuur hem zelf door", mail koper mislukt → melding met knop voor de koper', /niet verstuurd/.test(await txt(p, '.gc-mails')) && /koper/.test(await txt(p, '.gc-mails')) && await vis(p, '[data-gc-resend-now="buyer"]'));
  await p.click('[data-gc-close]'); await post('/__cfg', { mailFail: null });
  // Netwerkfout bij aanmaken: opnieuw = zelfde sleutel, één bon
  await newForm(); await p.click('[data-gc-quick="2500"]');
  let firstTry = true;
  await p.route('**/api/stamp/gift-cards', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    if (firstTry) { firstTry = false; const res = await r.fetch(); await res.text(); return r.abort('failed'); }
    return r.continue();
  });
  c0 = (await state()).gifts.length;
  await p.click('#gcNewBtn'); await p.waitForTimeout(500);
  await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
  const two = (await state()).log.create.slice(-2);
  check('10. Netwerkfout bij aanmaken: opnieuw versturen gebruikt dezelfde sleutel, er is maar één bon', two[0].idempotency_key === two[1].idempotency_key && (await state()).gifts.length === c0 + 1);
  await p.unroute('**/api/stamp/gift-cards'); await p.click('[data-gc-close]');
  await ctx.close();

  // ===== 11. Detail: verzendstatus, link kopiëren, opnieuw versturen =====
  await post('/__reset');
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.waitForSelector('.gc-row');
  // Een bon met geslaagde ontvanger-mail en mislukte koper-mail
  await post('/__cfg', { mailFail: 'buyer' });
  await p.click('[data-gc-new]'); await p.click('[data-gc-quick="2500"]');
  await p.fill('#gcRecName', 'Rosa'); await p.fill('#gcRecEmail', 'rosa@example.nl'); await p.fill('#gcBuyerEmail', 'oud@example.nl');
  await p.check('input[name="gcDelivery"][value="buyer"]'); await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success'); await p.click('[data-gc-close]');
  await post('/__cfg', { mailFail: null });
  const rosa = (await state()).gifts.find(g => g.recipient_name === 'Rosa');
  await p.evaluate(id => openGiftDetail(id), rosa.id); await p.waitForSelector('.gc-detail');
  const ms = await txt(p, '.gc-mailstat');
  check('11. Verzendstatus (geneste gift_card.mail): ontvanger "Nog niet verstuurd", koper "Mislukt (tijdstip laatste poging): fout"',
    /Mail ontvanger\s*Nog niet verstuurd/.test(ms) && /Mail koper\s*Mislukt \(\d+ \w+\.? 20\d\d, \d\d:\d\d\): .*Mailserver weigerde/.test(ms), ms.replace(/\s+/g, ' '));
  check('11. Koper en e-mail koper in de gegevens', /E-mail koper\s*oud@example\.nl/.test(await txt(p, '.gc-detail .cd-rows')));
  await p.click('.gc-detail [data-gc-copy]'); await p.waitForTimeout(150);
  check('11. "Link kopiëren" kopieert de deelbare link', (await p.evaluate(() => navigator.clipboard.readText())) === rosa.share_url && /Gekopieerd/.test(await txt(p, '.gc-detail [data-gc-copy]')));
  await p.click('[data-gc-resend-open]');
  check('11. Opnieuw versturen: ontvanger voorgeselecteerd met haar adres', await p.isChecked('input[name="gcResendTarget"][value="recipient"]') && (await p.inputValue('#gcResendEmail')) === 'rosa@example.nl');
  await p.check('input[name="gcResendTarget"][value="buyer"]');
  check('11. Koper kiezen vult het koper-adres', (await p.inputValue('#gcResendEmail')) === 'oud@example.nl');
  await p.fill('#gcResendEmail', 'nieuw@example.nl'); await post('/__cfg', { resendWait: 0 });
  await p.click('#gcResendBtn');
  await p.waitForFunction(() => /Opnieuw verstuurd/.test(document.getElementById('gcDetailNote').textContent));
  check('11. "Opnieuw verstuurd naar de koper (nieuw@example.nl)": adres uit mail.email, nooit het doel', /Opnieuw verstuurd naar de koper \(nieuw@example\.nl\)/.test(await txt(p, '#gcDetailNote'))
    && !/\((recipient|buyer)\)/.test(await txt(p, '#gcDetailNote')), await txt(p, '#gcDetailNote'));
  check('11. Gecorrigeerd adres → body {target:"buyer", email:"nieuw@example.nl"}, status bijgewerkt', JSON.stringify((await state()).log.resend.slice(-1)[0]) === '{"target":"buyer","email":"nieuw@example.nl"}'
    && /Mail koper\s*Verstuurd op/.test(await txt(p, '.gc-mailstat')) && /nieuw@example\.nl/.test(await txt(p, '.gc-detail .cd-rows')));
  await p.click('[data-gc-resend-open]');
  // De melding van de vorige keer staat er nog: wacht op het nieuwe verzoek én de nieuwe weergave.
  const nResend = (await state()).log.resend.length;
  await p.evaluate(() => { document.getElementById('gcDetailNote').textContent = ''; });
  await p.click('#gcResendBtn');
  await p.waitForFunction(() => /Opnieuw verstuurd/.test((document.getElementById('gcDetailNote') || {}).textContent || ''));
  check('11. Ongewijzigd adres → alleen {target}', (await state()).log.resend.length === nResend + 1 && JSON.stringify((await state()).log.resend.slice(-1)[0]) === '{"target":"recipient"}');
  await post('/__cfg', { resendWait: 60 });
  await p.click('[data-gc-resend-open]'); await p.click('#gcResendBtn'); await p.waitForTimeout(400);
  const rn = await p.$eval('#gcResendNote', e => ({ t: e.textContent, c: e.className }));
  check('11. 429 resend_too_soon → "Net al verstuurd, probeer over X seconden", geen rode fout', /^Net al verstuurd, probeer over \d+ seconden\.$/.test(rn.t) && !/error/.test(rn.c), JSON.stringify(rn));
  await p.click('#modalClose');
  // Server-code invalid_target bij opnieuw versturen
  await p.evaluate(id => openGiftDetail(id), rosa.id); await p.waitForSelector('.gc-detail');
  await p.route('**/resend', r => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'invalid_target', error: 'x' }) }));
  await p.click('[data-gc-resend-open]'); await p.click('#gcResendBtn'); await p.waitForTimeout(300);
  check('11. Server invalid_target → nette melding', /naar de ontvanger of naar de koper/.test(await txt(p, '#gcResendNote')), await txt(p, '#gcResendNote'));
  await p.unroute('**/resend'); await p.click('#modalClose');
  // Bon zonder e-mailadressen: no_email_for_target
  const sanne = (await state()).gifts.find(g => g.short_code === 'ABCD-EFGH-JK');
  await p.evaluate(id => openGiftDetail(id), sanne.id); await p.waitForSelector('.gc-detail');
  await p.click('[data-gc-resend-open]'); await p.click('#gcResendBtn'); await p.waitForTimeout(400);
  check('11. Geen adres bekend → "geen e-mailadres bekend"', /geen e-mailadres bekend/.test(await txt(p, '#gcResendNote')) && /error/.test(await p.getAttribute('#gcResendNote', 'class')));
  await p.click('#modalClose');
  // Geblokkeerde bon
  const daan = (await state()).gifts.find(g => g.short_code === 'BLKD-0000-01');
  await p.evaluate(id => openGiftDetail(id), daan.id); await p.waitForSelector('.gc-detail');
  check('11. Geblokkeerd: uitleg dat de pas in de Wallet blijft staan en dat toont', /De pas blijft in de Wallet van de klant staan en toont dat de bon geblokkeerd is/.test(await txt(p, '.gc-passnote')));
  await p.click('[data-gc-resend-open]'); await p.fill('#gcResendEmail', 'daan@example.nl'); await p.click('#gcResendBtn'); await p.waitForTimeout(400);
  check('11. 409 gift_card_blocked → nette melding', /geblokkeerd/.test(await txt(p, '#gcResendNote')));
  await p.click('#modalClose');
  // Blokkeren: bevestiging noemt de Wallet, nergens "verdwijnt"
  await p.evaluate(id => openGiftDetail(id), sanne.id); await p.waitForSelector('.gc-detail');
  await p.click('[data-gc-block="block"]'); await p.waitForFunction(() => /geblokkeerd ✓/.test(document.getElementById('gcDetailNote').textContent));
  check('11. Blokkeer-bevestiging: pas blijft in de Wallet; nergens "verdwijnt"', /pas blijft in de Wallet van de klant staan/.test(p.dialogs.slice(-1)[0])
    && !/verdwijn|van de telefoon/i.test(p.dialogs.join(' ') + await txt(p, '#gcWrap') + await txt(p, '.gc-detail')));
  await p.screenshot({ path: OUT + '/gcd-detail-mail-1440.png' });
  await ctx.close();

  // ===== 12. Ontwerp =====
  await post('/__reset');
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.waitForSelector('.gc-row');
  await p.click('[data-gc-view="design"]'); await p.waitForSelector('#gcDesignFrame');
  const chips = await p.$$eval('.gc-drow .gc-dchip', c => c.map(x => x.textContent));
  check('12. Zes velden, allemaal "Van stempelkaart"', chips.length === 6 && chips.every(t => t === 'Van stempelkaart'), chips.join('|'));
  check('12. Voorbeeld = iframe op preview_url van de server', (await p.getAttribute('#gcDesignFrame', 'src')) === B + '/__preview?card=pp&v=1');
  check('12. Waarschuwing bij achtergrond: Apple-pas alleen strip of niets, publieke pagina en Google Wallet volledig',
    /Apple Wallet-pas.*alleen als smalle strip.*of helemaal niet.*publieke cadeaubonpagina en in Google Wallet.*volledig/.test(await txt(p, '[data-gc-drow="background_url"] .gc-dwarn')));
  await p.click('#gcDesignSave'); await p.waitForTimeout(200);
  check('12. Niets gewijzigd → geen PUT', /niets gewijzigd/.test(await txt(p, '#gcDesignNote')) && (await state()).log.designPut.length === 0);
  await p.fill('[data-gc-dinput="pass_color"]', '#123456');
  check('12. Kleur wijzigen → "Eigen instelling" + knop "Overnemen van stempelkaart"', /Eigen instelling/.test(await txt(p, '[data-gc-drow="pass_color"]')) && await vis(p, '[data-gc-inherit="pass_color"]'));
  await p.uncheck('[data-gc-dinput="show_name"]');
  await p.click('#gcDesignSave'); await p.waitForFunction(() => /opgeslagen/.test((document.getElementById('gcDesignNote') || {}).textContent || ''));
  check('12. Opslaan → PUT met alleen de wijzigingen', JSON.stringify((await state()).log.designPut.slice(-1)[0]) === '{"card_id":"pp","pass_color":"#123456","show_name":false}', JSON.stringify((await state()).log.designPut.slice(-1)[0]));
  check('12. Voorbeeld ververst (nieuwe preview_url) en toont de nieuwe kleur', (await p.getAttribute('#gcDesignFrame', 'src')) === B + '/__preview?card=pp&v=2'
    && await p.frameLocator('#gcDesignFrame').locator('body').evaluate(b => getComputedStyle(b).backgroundColor) === 'rgb(18, 52, 86)');
  await p.click('[data-gc-inherit="pass_color"]');
  check('12. "Overnemen van stempelkaart" → wordt overgenomen na opslaan', /overgenomen van de stempelkaart na opslaan/.test(await txt(p, '[data-gc-drow="pass_color"]')));
  await p.click('#gcDesignSave'); await p.waitForFunction(() => /opgeslagen/.test((document.getElementById('gcDesignNote') || {}).textContent || ''));
  check('12. PUT met null = weer overnemen; daarna "Van stempelkaart"', JSON.stringify((await state()).log.designPut.slice(-1)[0]) === '{"card_id":"pp","pass_color":null}'
    && /Van stempelkaart/.test(await txt(p, '[data-gc-drow="pass_color"]')));
  const puts = (await state()).log.designPut.length;
  await p.fill('[data-gc-dinput="text_color"]', 'rood'); await p.click('#gcDesignSave'); await p.waitForTimeout(200);
  check('12. Ongeldige kleur → melding vooraf, geen PUT', /Tekstkleur: Deze kleur klopt niet/.test(await txt(p, '#gcDesignNote')) && (await state()).log.designPut.length === puts);
  await p.fill('[data-gc-dinput="text_color"]', '#ffffff');
  await p.fill('[data-gc-dinput="logo_url"]', 'http://onveilig.nl/logo.png'); await p.click('#gcDesignSave'); await p.waitForTimeout(200);
  check('12. Link zonder https → melding vooraf', /Logo: Deze link klopt niet/.test(await txt(p, '#gcDesignNote')));
  await p.fill('[data-gc-dinput="logo_url"]', 'https://cdn.example.nl/logo.png');
  for (const code of ['invalid_url', 'invalid_color']) {
    await p.route('**/api/stamp/gift-cards/design', r => r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, code, error: 'x' }) }) : r.continue());
    await p.click('#gcDesignSave'); await p.waitForTimeout(250);
    check(`12. Server ${code} → nette melding`, new RegExp('Niet opgeslagen: Deze ' + (code === 'invalid_url' ? 'link' : 'kleur') + ' klopt niet').test(await txt(p, '#gcDesignNote')), await txt(p, '#gcDesignNote'));
    await p.unroute('**/api/stamp/gift-cards/design');
  }
  await p.screenshot({ path: OUT + '/gcd-design-1440.png', fullPage: true });
  await ctx.close();
  for (const vp of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    ({ ctx, p } = await open(b, 'tok-pp', 'pp', vp));
    await p.waitForSelector('.gc-row');
    await p.click('[data-gc-view="design"]'); await p.waitForSelector('#gcDesignFrame');
    check(`12. ${vp.width}px ontwerp: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + `/gcd-design-${vp.width}.png`, fullPage: true });
    await p.click('[data-gc-view="list"]'); await p.click('[data-gc-new]'); await p.waitForSelector('#gcNewForm');
    check(`12. ${vp.width}px nieuw formulier: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + `/gcd-newform-${vp.width}.png`, fullPage: true });
    await ctx.close();
  }

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
