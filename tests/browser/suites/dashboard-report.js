// Dashboard, Cadeaubonnen → Rapport (fase C). Draait via tests/browser/run.js.
let B, check, pageErrors, consoleErrors, OUT;
const fs = require('fs');
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const api = (path, body) => fetch(B + path, { method: 'POST', headers: { Authorization: 'Bearer tok-pp', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const state = () => fetch(B + '/__state').then(r => r.json());
const NB = ' ';
async function open(b, extra = {}) {
  const ctx = await b.newContext({ viewport: extra.vp || { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(() => { if (!/dashboard/.test(location.pathname)) return; localStorage.setItem('omrz_token', 'tok-pp'); localStorage.setItem('omrz_card_id', 'pp'); localStorage.setItem('omrz_role', 'owner'); });
  const p = await ctx.newPage();
  p.on('pageerror', e => pageErrors.push('report: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !extra.expectErrors) consoleErrors.push('report: ' + m.text()); });
  p.reports = [];
  p.on('request', r => { if (/gift-cards\/report/.test(r.url())) p.reports.push(Object.fromEntries(new URL(r.url()).searchParams)); });
  await p.goto(B + '/dashboard.html'); await p.waitForTimeout(900);
  if (extra.theme) await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), extra.theme);
  await p.evaluate(() => activateTab('cadeaubonnen'));
  await p.click('[data-gc-view="report"]');
  await p.waitForSelector(extra.waitFor || '#gcRepStats', { timeout: 5000 }).catch(() => {});
  return { ctx, p };
}
const txt = (p, s) => p.evaluate(s => (document.querySelector(s) || {}).innerText || '', s);
const vis = (p, s) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, s);
const noH = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const card = (p, label) => p.evaluate(l => { const c = [...document.querySelectorAll('#gcRepStats .stat')].find(x => x.querySelector('.s-top').innerText.startsWith(l)); return c ? { val: c.querySelector('.s-val').innerText, sub: c.querySelector('.s-sub').innerText, life: !!c.querySelector('.gc-life'), tip: (c.querySelector('.gc-life') || {}).title || '' } : null; }, label);
const preset = async (p, k) => { await p.click(`[data-gc-preset="${k}"]`); await p.waitForTimeout(150); await p.waitForSelector('#gcRepStats', { timeout: 5000 }).catch(() => {}); };

module.exports = async function run(env) {
  ({ B, check, pageErrors, consoleErrors, out: OUT } = env);
  const b = env.browser;
  await post('/__reset');

  // ===== 1. Standaard: 30 dagen =====
  let { ctx, p } = await open(b);
  // De bonnenlijst vraagt ook een rapport op (preset 7d) voor het openstaand tegoed; de tab zelf vraagt 30d.
  const firstRep = p.reports.find(r => r.preset !== '7d') || {};
  check('1. Rapporttab: verzoek met preset=30d, card_id, geen from/to', firstRep.preset === '30d' && firstRep.card_id === 'pp' && !('from' in firstRep), JSON.stringify(p.reports));
  check('1. Periodeknop 30 dagen actief, periode in woorden', (await p.getAttribute('[data-gc-preset="30d"]', 'aria-selected')) === 'true' && /– .* · 30 dagen$/.test(await txt(p, '#gcRepRange')), await txt(p, '#gcRepRange'));
  let c = await card(p, 'Uitgegeven');
  check('1. Uitgegeven € 100,00, 4 bonnen', c && c.val === `€${NB}100,00` && /4 bonnen in deze periode/.test(c.sub), JSON.stringify(c));
  c = await card(p, 'Afgeschreven');
  check('1. Afgeschreven € 10,00, 1 afschrijving', c && c.val === `€${NB}10,00` && /^1 afschrijving$/.test(c.sub), JSON.stringify(c));
  c = await card(p, 'Openstaand');
  check('1. Openstaand € 50,00 met markering "hele looptijd" + tooltip', c && c.val === `€${NB}50,00` && c.life && /ongeacht de gekozen periode/.test(c.tip), JSON.stringify(c));
  c = await card(p, 'Actieve bonnen');
  check('1. Actieve bonnen 1 (hele looptijd)', c && c.val === '1' && c.life);
  c = await card(p, 'Gemiddelde bonwaarde');
  check('1. Gemiddelde bonwaarde € 25,00 (periode, geen markering)', c && c.val === `€${NB}25,00` && !c.life);
  c = await card(p, 'Binnenkort verlopen');
  check('1. Binnenkort verlopen € 0,00, 0 bonnen binnen 30 dagen (hele looptijd)', c && c.val === `€${NB}0,00` && /0 bonnen binnen 30 dagen/.test(c.sub) && c.life);
  check('1. Voetnoot legt uit dat die cijfers over alle bonnen gaan', /gaan over alle bonnen, niet alleen over de gekozen periode/.test(await txt(p, '.gc-rep-note')));
  check('1. Bedragen met tabular-nums', await p.evaluate(() => getComputedStyle(document.querySelector('#gcRepStats .s-val')).fontVariantNumeric.includes('tabular-nums')));
  // Donut
  const st = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.gc-status-list li')].map(li => [li.dataset.status, [li.querySelector('.n').innerText, li.querySelector('.eur').innerText]])));
  check('1. Per status: actief 1, leeg 1, geblokkeerd 1, verlopen 2 met saldo', JSON.stringify(st) === JSON.stringify({ active: ['1', `€${NB}50,00`], empty: ['1', `€${NB}0,00`], blocked: ['1', `€${NB}25,00`], expired: ['2', `€${NB}45,00`] }), JSON.stringify(st));
  check('1. Donut: midden 5 bonnen, vier bogen', /5\s*bonnen/.test(await p.evaluate(() => document.querySelector('.gc-donut').textContent)) && (await p.$$('.gc-donut circle:not(.dn-track)')).length === 4);
  // Grafiek per dag: elke dag van de periode, gaten gevuld
  const dayGroups = await p.$$eval('#gcRepDays .gc-day', g => g.map(x => x.dataset.day));
  check('1. Grafiek: 30 dagen, ook dagen zonder beweging', dayGroups.length === 30 && new Set(dayGroups).size === 30, dayGroups.length);
  const bars = await p.$$eval('#gcRepDays rect.b-issued, #gcRepDays rect.b-redeemed', r => r.length);
  check('1. Staafjes alleen op dagen met beweging (4 uitgifte + 1 afschrijving)', bars === 5, bars);
  const tips = await p.$$eval('#gcRepDays .gc-day title', t => t.map(x => x.textContent));
  check('1. Tooltip per dag met bedragen en aantallen', tips.some(t => /uitgegeven €\s50,00 \(1\)/.test(t)) && tips.every(t => /afgeschreven/.test(t)));
  // Per vestiging
  check('1. Per vestiging: Centrum € 10,00, 1', /Centrum\s+€\s10,00\s+1/.test(await txt(p, '#gcRepLocs tbody')), await txt(p, '#gcRepLocs tbody'));
  check('1. Zonder lijst laatste transacties: geen sectie, geen melding', !(await vis(p, '#gcRepRecent')) && !/transacties/i.test(await txt(p, '#gcReportBox')));
  check('1. Geen btw-kolommen of -teksten', !/btw/i.test(await txt(p, '#gcReportView')));
  check('1. Nergens een kale streep', !/(^|\s)—(\s|$)/.test(await txt(p, '#gcReportView')));
  await p.screenshot({ path: OUT + '/' + 'gcr-30d-1440.png', fullPage: true });

  // Eigenaar schrijft af zonder vestiging → rij "Zonder vestiging (eigenaar)"
  const sanne = (await state()).gifts.find(g => g.short_code === 'ABCDEFGHJK');
  await api('/api/stamp/gift-cards/redeem', { card_id: 'pp', gift_card_id: sanne.id, amount_cents: 1500, idempotency_key: 'rep-1' });
  await preset(p, '7d');
  check('2. 7 dagen: preset=7d, uitgegeven € 85,00 (3 bonnen)', p.reports.slice(-1)[0].preset === '7d' && (await card(p, 'Uitgegeven')).val === `€${NB}85,00` && /3 bonnen/.test((await card(p, 'Uitgegeven')).sub));
  check('2. 7 dagen: 7 dagen in de grafiek', (await p.$$('#gcRepDays .gc-day')).length === 7);
  check('2. Afschrijving zonder vestiging → "Zonder vestiging (eigenaar)", grootste bovenaan', /^Zonder vestiging \(eigenaar\)\s+€\s15,00\s+1/.test(await txt(p, '#gcRepLocs tbody')) && /Centrum/.test(await txt(p, '#gcRepLocs tbody')), await txt(p, '#gcRepLocs tbody'));
  check('2. Openstaand volgt het saldo (hele looptijd): € 35,00', (await card(p, 'Openstaand')).val === `€${NB}35,00`);
  await preset(p, '90d');
  check('2. 90 dagen: preset=90d, 5 bonnen, staafjes per dag', p.reports.slice(-1)[0].preset === '90d' && /5 bonnen/.test((await card(p, 'Uitgegeven')).sub)
    && (await p.$$('#gcRepDays rect.b-issued')).length === 5 && (await p.$$('#gcRepDays .gc-day')).length === 90);
  await p.screenshot({ path: OUT + '/' + 'gcr-90d-1440.png', fullPage: true });
  await preset(p, 'ytd');
  check('2. Dit jaar: preset=ytd, periode vanaf 1 januari, lijngrafiek (te veel dagen voor staafjes)', p.reports.slice(-1)[0].preset === 'ytd' && /^1 jan\.? \d{4} –/.test(await txt(p, '#gcRepRange')) && (await p.$$('#gcRepDays polyline')).length === 2, await txt(p, '#gcRepRange'));
  // Aangepast
  await p.click('[data-gc-preset="custom"]'); await p.waitForSelector('#gcRepStats');
  const cq = p.reports.slice(-1)[0];
  check('2. Aangepast: datumvelden zichtbaar, verzoek met preset=custom + from/to', await vis(p, '#gcRepFrom') && cq.preset === 'custom' && /^\d{4}-\d{2}-01$/.test(cq.from) && /^\d{4}-\d{2}-\d{2}$/.test(cq.to), JSON.stringify(cq));
  const today = new Date().toISOString().slice(0, 10), weekAgo = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  await p.evaluate(([a, z]) => { const f = document.getElementById('gcRepFrom'), t = document.getElementById('gcRepTo'); f.value = a; t.value = z; t.dispatchEvent(new Event('change')); }, [today, weekAgo]);
  await p.waitForTimeout(400);
  check('2. Omgekeerde datums: backend zet ze recht, velden volgen', (await p.inputValue('#gcRepFrom')) === weekAgo && (await p.inputValue('#gcRepTo')) === today && /· 7 dagen$/.test(await txt(p, '#gcRepRange')), await p.inputValue('#gcRepFrom') + ' / ' + await p.inputValue('#gcRepTo'));
  await p.evaluate(() => { const f = document.getElementById('gcRepFrom'); f.value = ''; f.dispatchEvent(new Event('change')); });
  check('2. Datum leeg → rustige vraag, geen verzoek, CSV uit', /Kies een begin- en einddatum/.test(await txt(p, '#gcReportBox')) && await p.isDisabled('[data-gc-csv]'));
  await preset(p, '30d');

  // ===== 3. CSV =====
  const dlP = p.waitForEvent('download');
  await p.click('[data-gc-csv]');
  const dl = await dlP;
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
  check('3. CSV: bestandsnaam met periode', /^cadeaubonnen-\d{4}-\d{2}-\d{2}-tm-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  check('3. CSV: kop, 30 dagen, totaalregel; puntkomma en komma-decimalen', rows[0] === 'Datum;Uitgegeven (EUR);Aantal uitgegeven;Afgeschreven (EUR);Aantal afschrijvingen' && rows.length === 32 && rows[31] === 'Totaal;100,00;4;25,00;2', rows[31]);
  check('3. CSV: geen btw', !/btw/i.test(csv));
  check('3. CSV: geen extra verzoek naar de server', p.reports.slice(-1)[0].format === undefined);
  await ctx.close();

  // ===== 4. Laatste transacties: alleen als het veld in het antwoord zit =====
  await post('/__cfg', { reportTx: true });
  ({ ctx, p } = await open(b));
  check('4. Met het veld: sectie "Laatste transacties" zichtbaar', await vis(p, '#gcRepRecent'));
  const tr = await p.$$eval('#gcRepRecent tbody tr', r => r.map(x => [...x.cells].map(c => c.innerText)));
  check('4. Rijen met datum, soort, bedrag, saldo, referentie en waar', tr.length >= 5 && tr.every(r => r.length === 6 && /CB-\d{4}/.test(r[4])), JSON.stringify(tr[0]));
  const rd = tr.find(r => r[1] === 'Afschrijving' && /15,00/.test(r[2])), is = tr.find(r => r[1] === 'Uitgifte');
  check('4. Afschrijving met min, uitgifte met plus (backend: bedrag altijd positief)', rd && rd[2] === `−€${NB}15,00` && rd[5] === 'Eigenaar' && is && is[2].startsWith('+€'), JSON.stringify([rd, is]));
  const cen = tr.find(r => r[1] === 'Afschrijving' && /10,00/.test(r[2]));
  check('4. Vestiging bij naam', cen && cen[5] === 'Centrum', JSON.stringify(cen));
  await p.screenshot({ path: OUT + '/' + 'gcr-recent-1440.png', fullPage: true });
  await ctx.close();
  await post('/__cfg', { reportTx: false, reportTxBad: true });
  ({ ctx, p } = await open(b));
  check('4. Veld met verkeerde vorm → geen sectie, geen foutmelding', !(await vis(p, '#gcRepRecent')) && !(await vis(p, '#gcReportBox .gc-banner.error')) && await vis(p, '#gcRepStats'));
  await ctx.close();
  await post('/__cfg', { reportTxBad: false });
  ({ ctx, p } = await open(b, { waitFor: '#gcReportBox' }));
  await p.route('**/gift-cards/report**', async r => { const res = await r.fetch(); const j = await res.json(); j.recent_transactions = []; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
  await preset(p, '7d');
  check('4. Veld aanwezig maar leeg → sectie met "Nog geen transacties."', await vis(p, '#gcRepRecent') && /Nog geen transacties\./.test(await txt(p, '#gcRepRecent')));
  await ctx.close();

  // ===== 5. Lege staat, binnenkort verlopen, correcties =====
  ({ ctx, p } = await open(b, { waitFor: '#gcReportBox' }));
  await p.route('**/gift-cards/report**', async r => { const res = await r.fetch(); const j = await res.json(); j.by_status = j.by_status.map(x => ({ ...x, count: 0, balance_cents: 0 })); j.by_day = []; j.by_location = [];
    Object.keys(j.totals).forEach(k => { if (k !== 'expiring_soon_days') j.totals[k] = 0; }); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
  await preset(p, '7d');
  check('5. Nog geen bonnen → nette lege staat met knop "Nieuwe cadeaubon"', /Nog geen cadeaubonnen/.test(await txt(p, '#gcReportBox')) && await vis(p, '#gcReportBox [data-gc-new]') && !(await vis(p, '#gcRepStats')));
  await p.screenshot({ path: OUT + '/' + 'gcr-empty-1440.png' });
  await ctx.close();
  // Bon die over 10 dagen verloopt
  const exp = new Date(Date.now() + 10 * 864e5).toISOString();
  await api('/api/stamp/gift-cards', { card_id: 'pp', amount_cents: 4000, delivery_mode: 'none', expires_at: exp, idempotency_key: 'rep-exp-1', recipient_name: 'Binnenkort' });
  ({ ctx, p } = await open(b));
  c = await card(p, 'Binnenkort verlopen');
  check('5. Bon die over 10 dagen verloopt → € 40,00, 1 bon binnen 30 dagen', c && c.val === `€${NB}40,00` && /1 bon binnen 30 dagen/.test(c.sub), JSON.stringify(c));
  // Periode zonder uitgifte: gemiddelde als tekst, geen € 0,00
  await p.route('**/gift-cards/report**', async r => { const res = await r.fetch(); const j = await res.json(); j.totals.issued_cents = 0; j.totals.issued_count = 0; j.totals.average_issued_cents = 0; j.totals.adjusted_count = 2; j.totals.adjusted_cents = 700;
    j.by_day = j.by_day.map(d => ({ ...d, issued_cents: 0, issued_count: 0 })); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
  await preset(p, '7d');
  check('5. Geen uitgifte → gemiddelde zegt "Geen uitgifte in deze periode"', (await card(p, 'Gemiddelde bonwaarde')).val === 'Geen uitgifte in deze periode');
  check('5. Correcties apart genoemd in de voetnoot', /2 correcties van samen €\s7,00/.test(await txt(p, '.gc-rep-note')));
  await ctx.close();

  // ===== 6. Fouten en snelle wissels =====
  await post('/__cfg', { reportFail: 'migration' });
  ({ ctx, p } = await open(b, { waitFor: '#gcReportBox .gc-banner', expectErrors: true }));
  check('6. migration_missing → nette melding met "Opnieuw proberen"', /nog niet ingericht/.test(await txt(p, '#gcReportBox')) && await vis(p, '[data-gc-retry]') && !/_/.test(await txt(p, '#gcReportBox')));
  await post('/__cfg', { reportFail: null });
  await p.click('[data-gc-retry]'); await p.waitForSelector('#gcRepStats', { timeout: 4000 }).catch(() => {});
  check('6. Opnieuw proberen → rapport', await vis(p, '#gcRepStats'));
  await ctx.close();
  await post('/__cfg', { reportFail: 500 });
  ({ ctx, p } = await open(b, { waitFor: '#gcReportBox .gc-banner', expectErrors: true }));
  check('6. Serverfout → melding zonder ruwe code of statusnummer', /Rapport niet geladen/.test(await txt(p, '#gcReportBox')) && !/500|_/.test(await txt(p, '#gcReportBox .gc-banner')), await txt(p, '#gcReportBox'));
  await ctx.close();
  await post('/__cfg', { reportFail: null, reportDelay: 300 });
  ({ ctx, p } = await open(b));
  await p.evaluate(() => { for (const k of ['7d', '90d', 'ytd', '7d']) document.querySelector(`[data-gc-preset="${k}"]`).click(); });
  await p.waitForTimeout(1200);
  check('6. Snel wisselen: de laatste keuze wint (7 dagen)', (await p.$$('#gcRepDays .gc-day')).length === 7 && (await p.getAttribute('[data-gc-preset="7d"]', 'aria-selected')) === 'true');
  await ctx.close();
  await post('/__cfg', { reportDelay: 0 });

  // ===== 7. Schermformaten en licht thema =====
  for (const vp of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    await post('/__cfg', { reportTx: true });
    ({ ctx, p } = await open(b, { vp }));
    check(`7. ${vp.width}px: geen horizontale scroll`, await noH(p));
    check(`7. ${vp.width}px: aslabels leesbaar (≥ 9px op het scherm)`, await p.evaluate(() => { const t = document.querySelector('#gcRepDays .ax'); return t && t.getBoundingClientRect().height >= 9; }));
    check(`7. ${vp.width}px: tabellen passen zonder zijwaarts scrollen`, await p.evaluate(() => [...document.querySelectorAll('#gcRepLocs .gc-table-wrap, #gcRepRecent .gc-table-wrap')].every(w => w.scrollWidth <= w.clientWidth + 1)));
    check(`7. ${vp.width}px: alle periodeknoppen in beeld`, await p.evaluate(() => [...document.querySelectorAll('[data-gc-preset]')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })));
    await p.screenshot({ path: OUT + '/' + `gcr-${vp.width}.png`, fullPage: true });
    await preset(p, '90d');
    check(`7. ${vp.width}px, 90 dagen: geen horizontale scroll`, await noH(p));
    await ctx.close();
  }
  ({ ctx, p } = await open(b, { theme: 'light' }));
  await p.screenshot({ path: OUT + '/' + 'gcr-light-1440.png', fullPage: true });
  check('7. Licht thema: rapport rendert', await vis(p, '#gcRepStats') && await vis(p, '.gc-donut'));
  await ctx.close();
  await post('/__cfg', { reportTx: false });
};
