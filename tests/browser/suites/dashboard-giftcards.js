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
  await p.waitForFunction(() => !document.getElementById('gcOutstanding').classList.contains('is-loading'));
  check('1. Openstaand tegoed uit het rapport (de lijst heeft geen totalen): € 50,00', (await txt(p, '#gcOutstanding')) === `€${NB}50,00`, await txt(p, '#gcOutstanding'));
  check('1. Actieve bonnen uit het rapport: 1', (await txt(p, '#gcActive')) === '1');
  const counts = await p.$$eval('[data-gc-status]', bs => bs.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
  check('1. Filterchips met aantallen: Alle 5, Actief 1, Leeg 1, Verlopen 2, Geblokkeerd 1', JSON.stringify(counts) === JSON.stringify(['Alle5', 'Actief1', 'Leeg1', 'Verlopen2', 'Geblokkeerd1']) || JSON.stringify(counts) === JSON.stringify(['Alle 5', 'Actief 1', 'Leeg 1', 'Verlopen 2', 'Geblokkeerd 1']), JSON.stringify(counts));
  const badges = await p.$$eval('.gc-row', rs => Object.fromEntries(rs.map(r => [r.querySelector('.gc-code').textContent, [r.querySelector('.gc-badge').className.replace('gc-badge ', ''), r.querySelector('.gc-badge').textContent]])));
  const sortObj = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  check('1. Lijst: eigen label en kleurklasse per status', sortObj(badges) === sortObj({
    'PAST-0000-05': ['expired', 'Verlopen'], 'EMPT-0000-02': ['empty', 'Leeg'], 'BZKD-0000-01': ['blocked', 'Geblokkeerd'],
    'ABCD-EFGH-JK': ['active', 'Actief'], 'EXPR-0000-03': ['expired', 'Verlopen'] }), JSON.stringify(badges));
  const colors = await p.$$eval('.gc-badge', bs => [...new Set(bs.map(b => b.className + '|' + getComputedStyle(b).color))]);
  check('1. Vier statussen, vier verschillende kleuren', new Set(colors.map(c => c.split('|')[1])).size === 4, colors.join(' '));
  check('1. Rij: saldo, oorspronkelijk bedrag, voortgangsbalk, ontvanger, korte code, datum', await p.evaluate(() => { const r = [...document.querySelectorAll('.gc-row')].find(x => /Sanne/.test(x.innerText));
    return /€\s50,00/.test(r.innerText) && /van €\s50,00/.test(r.innerText) && /Voor Sanne de Vries/.test(r.innerText) && /ABCD-EFGH-JK/.test(r.innerText) && /20\d\d/.test(r.innerText) && r.querySelector('.gc-prog i').style.width === '100%'; }));
  check('1. Snelle acties: link kopiëren op elke bon, afschrijven alleen op de actieve bon', (await p.$$('[data-gc-qcopy]')).length === 5 && (await p.$$('[data-gc-qredeem]')).length === 1
    && await p.evaluate(() => !!document.querySelector('.gc-row[data-gc-row] [data-gc-qredeem]').closest('.gc-row').innerText.includes('Sanne')));
  check('1. Opnieuw versturen alleen bij een bon met e-mailadres (geen in de startdata)', (await p.$$('[data-gc-qresend]')).length === 0);
  await p.screenshot({ path: OUT + '/' + 'gcd-list-1440.png', fullPage: true });
  await p.click('.gc-row-main >> text=Peter Verstreken'); await p.waitForSelector('.gc-detail');
  check('1. Detail: zelfde label en kleur (Verlopen)', /Verlopen/.test(await txt(p, '.gc-hero')) && await p.evaluate(() => !!document.querySelector('.gc-hero .gc-badge.expired')));
  await p.click('#modalClose');
  // Zoeken zoals de backend: volledige korte code of exact e-mailadres
  const lists = async () => ((await state()).log.list || []).slice(-1)[0] || {};
  const nList = ((await state()).log.list || []).length;
  await p.fill('#gcSearch', 'abcd'); await p.waitForTimeout(600);
  check('1. Halve code → hint, geen zoekverzoek met q', /volledige korte code/.test(await txt(p, '#gcSearchHint')) && !('q' in (await lists())), JSON.stringify(await lists()));
  await p.fill('#gcSearch', 'abcd-efgh-jk'); await p.waitForTimeout(700);
  check('1. Volledige korte code → q=ABCDEFGHJK, één bon', (await lists()).q === 'ABCDEFGHJK' && (await p.$$('.gc-row')).length === 1 && (await txt(p, '#gcSearchHint')) === '');
  await p.fill('#gcSearch', 'Niemand@Example.nl'); await p.waitForTimeout(700);
  check('1. E-mailadres → q in kleine letters; geen resultaat → nette lege staat', (await lists()).q === 'niemand@example.nl' && /Geen cadeaubonnen gevonden/.test(await txt(p, '#gcListBox')));
  await p.fill('#gcSearch', ''); await p.waitForTimeout(600);
  // Filterchips
  await p.click('[data-gc-status="blocked"]'); await p.waitForTimeout(500);
  check('1. Chip Geblokkeerd → status=blocked, alleen Daan', (await lists()).status === 'blocked' && (await p.$$('.gc-row')).length === 1 && /Daan/.test(await txt(p, '#gcListBox')) && (await p.getAttribute('[data-gc-status="blocked"]', 'aria-selected')) === 'true');
  await p.click('[data-gc-status="expired"]'); await p.waitForTimeout(500);
  check('1. Chip Verlopen → ook de actieve bon met verstreken datum', (await lists()).status === 'expired' && (await p.$$('.gc-row')).length === 2 && /Peter/.test(await txt(p, '#gcListBox')));
  await p.click('[data-gc-status=""]'); await p.waitForTimeout(500);
  check('1. Chip Alle → geen status in het verzoek', !('status' in (await lists())) && (await p.$$('.gc-row')).length === 5);
  // Snelle acties
  const sanneG = (await state()).gifts.find(g => g.short_code === 'ABCDEFGHJK');
  await p.click(`[data-gc-qcopy="${sanneG.id}"]`); await p.waitForTimeout(200);
  check('1. Link kopiëren → link op het klembord + melding', (await p.evaluate(() => navigator.clipboard.readText())) === 'https://api.omrzdigital.nl/cadeaubon/' + sanneG.code && /Link gekopieerd/.test(await txt(p, '#gcToast')));
  await p.click(`[data-gc-qredeem="${sanneG.id}"]`); await p.waitForSelector('#gcRedeemBox .gr');
  await p.fill('#grAmount', '5'); await p.click('#grNext'); await p.click('#grConfirm'); await p.waitForSelector('.gr-done');
  check('1. Afschrijven vanuit de lijst: € 5,00 afgeschreven, nieuw saldo € 45,00', /€\s5,00 afgeschreven/.test(await txt(p, '.gr-done h4')) && (await txt(p, '#grNewBal')) === `€${NB}45,00`);
  await p.click('[data-gc-close], [data-gr-close]'); await p.waitForTimeout(600);
  check('1. Lijst en totaal ververst na afschrijven', /€\s45,00/.test(await p.evaluate(id => document.querySelector(`[data-gc-row="${id}"]`).innerText, sanneG.id)) && (await txt(p, '#gcOutstanding')) === `€${NB}45,00`, await txt(p, '#gcOutstanding'));
  await ctx.close();

  // ===== 1b. Lege lijst: "Zo werkt het" =====
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.route('**/api/stamp/gift-cards?*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, total: 0, limit: 50, offset: 0, gift_cards: [] }) }));
  await p.evaluate(() => loadGiftList(true)); await p.waitForSelector('#gcHowTo');
  const steps = await p.$$eval('#gcHowTo .gc-steps3 li b', l => l.map(x => x.textContent));
  check('1b. Geen bonnen → "Zo werkt het" in drie stappen met knop', JSON.stringify(steps) === JSON.stringify(['Maak een cadeaubon', 'Geef hem aan de klant', 'Schrijf af aan de kassa']) && await vis(p, '#gcHowTo [data-gc-new]'));
  await p.screenshot({ path: OUT + '/' + 'gcd-howto-1440.png' });
  await p.click('#gcHowTo [data-gc-new]'); await p.waitForSelector('#gcNewForm');
  check('1b. Knop opent het formulier', await vis(p, '#gcNewForm'));
  await ctx.close();

  // ===== 2. Nieuwe cadeaubon in drie stappen =====
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.waitForSelector('.gc-row');
  await p.click('[data-gc-new]'); await p.waitForSelector('#gcNewForm');
  const stepNow = () => p.evaluate(() => [...document.querySelectorAll('[data-gc-step]')].filter(x => !x.hidden).map(x => x.dataset.gcStep).join(','));
  check('2. Stap 1 van 3: Bedrag; stappenbalk met drie stappen', (await stepNow()) === '0' && (await p.$$eval('#gcStepper li', l => l.map(x => x.textContent))).join('|') === '1. Bedrag|2. Koper en ontvanger|3. Verzending'
    && !(await vis(p, '#gcStepBack')) && !(await vis(p, '#gcNewBtn')));
  await p.click('#gcStepNext');
  check('2. Zonder bedrag: nette melding, blijft op stap 1', /geldig bedrag/.test(await txt(p, '#gcNewNote')) && (await stepNow()) === '0');
  await p.fill('#gcAmount', '30,505'); await p.click('#gcStepNext');
  check('2. 3 decimalen geweigerd', /geldig bedrag/.test(await txt(p, '#gcNewNote')) && (await stepNow()) === '0');
  await p.click('[data-gc-quick="2500"]');
  check('2. Snelkeuze €25 vult "25,00" en is actief; ook €10/€50/€100 en Eigen bedrag', (await p.inputValue('#gcAmount')) === '25,00' && await p.evaluate(() => document.querySelector('[data-gc-quick="2500"]').classList.contains('active'))
    && (await p.$$eval('[data-gc-quick]', c => c.map(x => x.textContent.trim()))).join('|') === '€ 10|€ 25|€ 50|€ 100|Eigen bedrag'.replace(/ /g, NB).replace('Eigen' + NB + 'bedrag', 'Eigen bedrag'));
  await p.screenshot({ path: OUT + '/' + 'gcd-new-step1-1440.png' });
  await p.click('#gcStepNext');
  check('2. Stap 2: Koper en ontvanger, met Terug', (await stepNow()) === '1' && await vis(p, '#gcStepBack') && await vis(p, '#gcRecName'));
  await p.fill('#gcRecEmail', 'geen-email'); await p.click('#gcStepNext');
  check('2. Ongeldig e-mailadres → blijft op stap 2', /e-mailadres van de ontvanger klopt niet/.test(await txt(p, '#gcNewNote')) && (await stepNow()) === '1');
  await p.fill('#gcRecEmail', 'mila@example.nl'); await p.fill('#gcRecName', 'Mila'); await p.fill('#gcMessage', 'Fijne verjaardag!');
  await p.screenshot({ path: OUT + '/' + 'gcd-new-step2-1440.png' });
  await p.click('#gcStepNext');
  check('2. Stap 3: drie keuzes met uitleg, standaard "Geen e-mail"', (await stepNow()) === '2' && await p.isChecked('input[name="gcDelivery"][value="none"]')
    && /We mailen de cadeaubon met de Wallet-pas naar de ontvanger/.test(await txt(p, '[data-gc-step="2"]')) && /stuurt hem zelf door of print hem uit/.test(await txt(p, '[data-gc-step="2"]'))
    && /Er gaat geen mail uit/.test(await txt(p, '[data-gc-step="2"]')) && await vis(p, '#gcNewBtn'));
  await p.check('input[name="gcDelivery"][value="recipient"]');
  check('2. Samenvatting: bedrag, ontvanger en waar de mail heen gaat', /€\s25,00 voor Mila/.test(await txt(p, '#gcSummary')) && /We mailen hem naar mila@example\.nl/.test(await txt(p, '#gcSummary')), await txt(p, '#gcSummary'));
  await p.screenshot({ path: OUT + '/' + 'gcd-new-1440.png' });
  await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
  const st1 = await state(); const sent = st1.log.create[st1.log.create.length - 1];
  check('2. Verstuurd: amount_cents 2500 + optionele velden + delivery_mode', sent.amount_cents === 2500 && sent.recipient_name === 'Mila' && sent.recipient_email === 'mila@example.nl' && sent.message === 'Fijne verjaardag!' && !('expires_at' in sent) && sent.card_id === 'pp' && sent.delivery_mode === 'recipient', JSON.stringify(sent));
  const succ = await txt(p, '.gc-success');
  {
    const st = await state(); const issue = st.txs.filter(t => t.type === 'issue').slice(-1)[0];
    const shown = await p.$$eval('.gc-success .gc-fact', fs => (fs.find(f => /Referentienummer/.test(f.innerText)) || {}).innerText || '');
    check('2. Referentienummer uit transaction.reference_number in beeld', shown.includes(issue.reference_number) && !/—/.test(shown), shown.replace(/\s+/g, ' '));
  }
  check('2. Succes: kassa-instructie, korte code, referentie', /Boek op de kassa als verkoop cadeaubon:\s*€\s25,00/.test(succ) && /CB-\d{4}/.test(succ) && /[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}/.test(succ));
  const link = await p.inputValue('.gc-success .gc-link input');
  check('2. Deelbare link getoond', /^https:\/\/api\.omrzdigital\.nl\/cadeaubon\/[0-9a-f]{32}$/.test(link), link);
  const wa = await p.getAttribute('.gc-success a[href^="https://wa.me/"]', 'href');
  check('2. WhatsApp-knop met voorgevulde tekst + link', decodeURIComponent(wa).includes(link) && /cadeaubon van €\s25,00 gekregen bij Loris Parfum/.test(decodeURIComponent(wa)));
  check('2. QR-code van de link gerenderd', await p.evaluate(() => !!document.querySelector('#gcQr img, #gcQr canvas')));
  await p.screenshot({ path: OUT + '/' + 'gcd-success-1440.png' });
  await p.click('[data-gc-close]'); await p.waitForTimeout(600);
  check('2. Lijst en totaal ververst (6 bonnen, openstaand € 70,00 = 45 + 25)', (await p.$$('.gc-row')).length === 6 && (await txt(p, '#gcOutstanding')) === `€${NB}70,00`, await txt(p, '#gcOutstanding'));
  // Gekozen verzending zonder adres → terug naar stap 2 met focus
  await p.click('[data-gc-new]'); await p.click('[data-gc-quick="1000"]'); await p.click('#gcStepNext'); await p.click('#gcStepNext');
  await p.check('input[name="gcDelivery"][value="buyer"]');
  check('2. Samenvatting waarschuwt dat het adres van de koper ontbreekt', /E-mail van de koper is nodig/.test(await txt(p, '#gcSummary')));
  await p.click('#gcNewBtn');
  check('2. Aanmaken zonder koper-adres → terug naar stap 2, melding, focus op het veld', (await stepNow()) === '1' && /e-mailadres van de koper in/.test(await txt(p, '#gcNewNote')) && await p.evaluate(() => document.activeElement.id) === 'gcBuyerEmail');
  await p.click('#modalClose');
  // Vervaldatum in het verleden en geldige
  await p.click('[data-gc-new]'); await p.waitForSelector('#gcNewForm');
  await p.fill('#gcAmount', '12,5'); await p.evaluate(() => { document.getElementById('gcExpires').value = '2020-01-01'; });
  await p.click('#gcStepNext'); await p.click('#gcStepNext'); await p.click('#gcNewBtn');
  check('2. Vervaldatum in het verleden → terug naar stap 1 met melding', /toekomst/.test(await txt(p, '#gcNewNote')) && (await stepNow()) === '0');
  await p.evaluate(() => { document.getElementById('gcExpires').value = '2027-03-31'; });
  await p.click('#gcStepNext'); await p.click('#gcStepNext');
  check('2. Samenvatting noemt de vervaldatum', /Geldig tot en met 31 mrt\.? 2027/.test(await txt(p, '#gcSummary')), await txt(p, '#gcSummary'));
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
      await ny.p.click('#gcStepNext'); await ny.p.click('#gcStepNext'); await ny.p.click('#gcNewBtn'); await ny.p.waitForSelector('.gc-success');
      const got = (await state()).log.create.slice(-1)[0].expires_at;
      check(`2. Browser in New York, vervaldatum ${day} → ${want}`, got === want, got);
      await ny.p.click('[data-gc-close]');
    }
    await ny.ctx.close();
  }

  // ===== 3. Detail: tijdlijn, afschrijven, corrigeren, blokkeren =====
  await p.waitForTimeout(400);
  const sanne3 = (await state()).gifts.find(g => g.short_code === 'ABCDEFGHJK');
  await p.evaluate(id => openGiftDetail(id), sanne3.id); await p.waitForSelector('.gc-detail');
  check('3. Detail: saldo, voortgang, korte code met streepjes, ontvanger en koper apart', /€\s45,00\s*van €\s50,00/.test(await txt(p, '.gc-hero')) && (await txt(p, '.gc-code-big')) === 'ABCD-EFGH-JK'
    && /Sanne de Vries/.test(await txt(p, '#gcSecRecipient')) && /Naam niet opgegeven/.test(await txt(p, '#gcSecBuyer')) && await vis(p, '.gc-hero .gc-prog'));
  check('3. Tijdlijn: Uitgegeven +€ 50,00 met saldo en referentie', /Uitgegeven/.test(await txt(p, '#gcTimeline')) && /\+€\s50,00/.test(await txt(p, '#gcTimeline .t-issue .amt')) && /CB-\d{4}/.test(await txt(p, '#gcTimeline .t-issue .meta')));
  check('3. Eigenaar ziet Afschrijven, Corrigeren en Blokkeren', await vis(p, '[data-gc-redeem-open]') && await vis(p, '[data-gc-adjust-open]') && await vis(p, '[data-gc-block]'));
  // Afschrijven vanuit het detail
  await p.click('[data-gc-redeem-open]'); await p.waitForSelector('#gcRedeemBox .gr');
  await p.fill('#grAmount', '7,5'); await p.click('#grNext'); await p.click('#grConfirm'); await p.waitForSelector('.gr-done');
  await p.click('[data-gr-close]'); await p.waitForSelector('.gc-detail');
  check('3. "Terug naar de bon" → detail met de afschrijving in de tijdlijn (−€ 7,50)', /€\s37,50/.test(await txt(p, '.gc-hero')) && /−€\s7,50/.test(await txt(p, '#gcTimeline .t-redeem .amt')) && /Eigenaar|Medewerker/.test(await txt(p, '#gcTimeline .t-redeem .meta')));
  await p.click('[data-gc-adjust-open]');
  await p.fill('#gcAdjAmt', '5'); await p.click('#gcAdjBtn');
  check('3. Correctie zonder notitie geweigerd', /notitie is verplicht/.test(await txt(p, '#gcDetailNote')));
  await p.selectOption('#gcAdjSign', '-1'); await p.fill('#gcAdjNote', 'Kassaverschil'); await p.click('#gcAdjBtn');
  await p.waitForFunction(() => /gecorrigeerd/.test(document.getElementById('gcDetailNote').textContent));
  check('3. Correctie −€5: saldo € 32,50; tijdlijn "Saldo gecorrigeerd" −€ 5,00 met notitie (richting uit het saldo)', /€\s32,50/.test(await txt(p, '.gc-hero'))
    && /−€\s5,00/.test(await txt(p, '#gcTimeline .t-adjust .amt')) && /Kassaverschil/.test(await txt(p, '#gcTimeline .t-adjust .note')));
  // Blokkeren met bevestiging en notitie
  await p.click('[data-gc-block="block"]');
  const conf = await txt(p, '#gcBlockConfirm');
  check('3. Blokkeren → bevestiging: pas blijft in de Wallet maar wordt als ongeldig getoond; nergens "verdwijnt"', await vis(p, '#gcBlockConfirm') && /pas blijft in de Wallet van de klant staan, maar wordt als ongeldig getoond/.test(conf) && !/verdwijn/i.test(conf) && p.dialogs.length === 0);
  await p.fill('#gcBlockNote', 'Klant is de bon kwijt');
  check('3. Teller notitie (max 500)', (await txt(p, '#gcBlockCount')) === '21' && (await p.getAttribute('#gcBlockNote', 'maxlength')) === '500');
  await p.screenshot({ path: OUT + '/' + 'gcd-block-confirm-1440.png' });
  await p.click('[data-gc-block-confirm="block"]');
  await p.waitForFunction(() => /Cadeaubon geblokkeerd/.test(document.getElementById('gcDetailNote').textContent));
  const blk = ((await state()).log.block || []).slice(-1)[0];
  check('3. POST /block met {"note":"Klant is de bon kwijt"}', blk.action === 'block' && blk.raw === '{"note":"Klant is de bon kwijt"}', blk && blk.raw);
  check('3. Na blokkeren: badge Geblokkeerd, Wallet-uitleg, knop Deblokkeren, tijdlijn met notitie, geen Afschrijven', /Geblokkeerd/.test(await txt(p, '.gc-hero')) && /wordt als ongeldig getoond/.test(await txt(p, '#gcPassNote'))
    && await vis(p, '[data-gc-block="unblock"]') && /Klant is de bon kwijt/.test(await txt(p, '#gcTimeline .t-block')) && !(await vis(p, '[data-gc-redeem-open]')));
  await p.click('[data-gc-block="unblock"]');
  check('3. Deblokkeren → eigen bevestiging (pas weer geldig)', /weer als geldig getoond/.test(await txt(p, '#gcBlockConfirm')));
  await p.click('[data-gc-block-confirm="unblock"]');
  await p.waitForFunction(() => /gedeblokkeerd/.test(document.getElementById('gcDetailNote').textContent));
  check('3. Zonder notitie → body {}; weer Actief, tijdlijn "Gedeblokkeerd"', ((await state()).log.block || []).slice(-1)[0].raw === '{}' && /Actief/.test(await txt(p, '.gc-hero')) && /Gedeblokkeerd/.test(await txt(p, '#gcTimeline')));
  // 409: de bon stond al in die stand → scherm bijwerken, geen foutmelding
  await post('/__cfg', {});
  const sNow = (await state()).gifts.find(g => g.id === sanne3.id);
  await p.route('**/block', async r => { const g = Object.assign({}, sNow, { status: 'blocked' }); r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Deze cadeaubon is al geblokkeerd.', code: 'already_blocked', gift_card: { ...g, short_code_display: 'ABCD-EFGH-JK' } }) }); });
  await p.route(`**/gift-cards/${sanne3.id}`, async r => { const res = await r.fetch(); const j = await res.json(); j.gift_card.status = 'blocked'; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
  await p.click('[data-gc-block="block"]'); await p.click('[data-gc-block-confirm="block"]'); await p.waitForTimeout(500);
  check('3. 409 already_blocked → scherm toont Geblokkeerd, geen foutmelding', /Geblokkeerd/.test(await txt(p, '.gc-hero')) && !/error/.test(await p.getAttribute('#gcDetailNote', 'class')) && !/al geblokkeerd|already/i.test(await txt(p, '#gcDetailNote')));
  await p.unroute('**/block'); await p.unroute(`**/gift-cards/${sanne3.id}`);
  await p.evaluate(id => openGiftDetail(id), sanne3.id); await p.waitForSelector('.gc-detail');
  await p.route('**/unblock', r => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Deze cadeaubon is niet geblokkeerd.', code: 'not_blocked', gift_card: { ...sNow, status: 'active' } }) }));
  await p.evaluate(() => { const b = document.querySelector('[data-gc-block]'); b.dataset.gcBlock = 'unblock'; });
  await p.evaluate(id => toggleGiftBlock(id, 'unblock', document.createElement('button')), sanne3.id); await p.waitForTimeout(500);
  check('3. 409 not_blocked → scherm toont Actief, geen foutmelding', /Actief/.test(await txt(p, '.gc-hero')) && !/error/.test(await p.getAttribute('#gcDetailNote', 'class')));
  await p.unroute('**/unblock');
  for (const [st, code, re] of [[403, 'owner_only', /Alleen de eigenaar/], [404, 'gift_card_not_found', /bestaat niet/], [503, 'migration_missing', /nog niet ingericht/]]) {
    await p.route('**/block', r => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify({ error: 'x', code }) }));
    await p.click('[data-gc-block="block"]'); await p.click('[data-gc-block-confirm="block"]'); await p.waitForTimeout(400);
    check(`3. Blokkeren ${st} ${code} → nette melding`, re.test(await txt(p, '#gcDetailNote')) && !/_/.test(await txt(p, '#gcDetailNote')), await txt(p, '#gcDetailNote'));
    await p.unroute('**/block');
    await p.click('[data-gc-block-cancel]');
  }
  await p.screenshot({ path: OUT + '/' + 'gcd-detail-1440.png', fullPage: true });
  await p.click('#modalClose');
  // Terugdraaien op de lege bon (afschrijving van €10)
  const g = (await state()).gifts.find(x => x.short_code === 'EMPT000002');
  await p.evaluate(id => openGiftDetail(id), g.id); await p.waitForSelector('[data-gc-reverse]');
  const revId = await p.getAttribute('[data-gc-reverse]', 'data-gc-reverse');
  await p.click('[data-gc-reverse]');
  await p.waitForFunction(() => /teruggedraaid ✓/.test(document.getElementById('gcDetailNote').textContent));
  check('3. Terugdraaien (met bevestiging): saldo terug op € 10,00, tijdlijn "Afschrijving teruggedraaid" +€ 10,00', /€\s10,00/.test(await txt(p, '.gc-hero')) && /\+€\s10,00/.test(await txt(p, '#gcTimeline .t-reverse .amt')));
  check('3. Teruggedraaide afschrijving: label i.p.v. de knop', !(await p.$(`[data-gc-reverse="${revId}"]`)) && (await p.$$('#gcTimeline .gc-reversed')).length === 1);
  await p.click('#modalClose'); await p.evaluate(id => openGiftDetail(id), g.id); await p.waitForSelector('.gc-detail');
  check('3. Ook na opnieuw openen: geen Terugdraaien-knop meer', (await p.$$('[data-gc-reverse]')).length === 0 && (await p.$$('#gcTimeline .gc-reversed')).length === 1);
  await p.screenshot({ path: OUT + '/' + 'gcd-reversed-1440.png' });
  await p.evaluate(id => reverseGiftTx(id, 1000, document.createElement('button')), revId);
  await p.waitForFunction(() => /al teruggedraaid/.test(document.getElementById('gcDetailNote').textContent));
  check('3. already_reversed → Nederlandse melding', true);
  await p.click('#modalClose');
  await ctx.close();

  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.waitForSelector('.gc-row');
  // ===== 4. Rapport (uitgebreid in suites/dashboard-report.js) =====
  await p.click('[data-gc-view="report"]'); await p.waitForSelector('#gcRepStats');
  check('4. Rapport laadt met kaarten (standaard 30 dagen)', /Uitgegeven/.test(await txt(p, '#gcRepStats')) && (await p.getAttribute('[data-gc-preset="30d"]', 'aria-selected')) === 'true');
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
  check('9. Aanzetten → schakelaar aan + bevestiging over de keuze Stempelen of Cadeaubon', true
    && /keuze Stempelen of Cadeaubon/.test(await txt(p, '#gcScannerNote')) && await p.isChecked('#gcScannerSwitch') && p.dialogs.length === 0);
  // Openstaand = actieve bonnen die niet verlopen zijn (zoals het rapport van de backend).
  const open9 = (await state()).gifts.filter(g => g.card_id === 'pp' && g.status === 'active' && !(g.expires_at && Date.parse(g.expires_at) <= Date.now())).reduce((n, g) => n + g.balance_cents, 0);
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
  await p.route('**/gift-cards/report?*', async r => { const res = await r.fetch(); const j = await res.json(); j.totals.outstanding_cents = 0; j.totals.outstanding_count = 0; r.fulfill({ response: res, json: j }); });
  await p.evaluate(() => { gcLastTotals = null; return loadGiftStats(); }); await p.waitForTimeout(400);
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
  // Velden staan verdeeld over drie stappen: eerst naar de juiste stap, dan invullen.
  const STEP_OF = { gcAmount: 0, gcExpires: 0, gcRecName: 1, gcRecEmail: 1, gcMessage: 1, gcBuyerName: 1, gcBuyerEmail: 1 };
  const fillF = async (sel, v) => { await p.evaluate(n => gcGoStep(n), STEP_OF[sel.slice(1)]); await p.fill(sel, v); };
  const checkD = async v => { await p.evaluate(() => gcGoStep(2)); await p.check(`input[name="gcDelivery"][value="${v}"]`); };
  const submit = async () => { await p.evaluate(() => gcGoStep(2)); if (await p.isVisible('#gcNewBtn')) await p.click('#gcNewBtn'); };
  const note = () => txt(p, '#gcNewNote');
  const creates = async () => (await state()).log.create.length;
  await newForm();
  const legends = await p.$$eval('#gcNewForm legend', l => l.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  check('10. Formulier: blokken Ontvanger (optioneel), Koper (optioneel), Verzending; standaard "Geen e-mail"',
    JSON.stringify(legends) === JSON.stringify(['Ontvanger (optioneel)', 'Koper (optioneel)', 'Verzending']) && await p.isChecked('input[name="gcDelivery"][value="none"]')
    && !(await vis(p, '#gcRecReq')) && !(await vis(p, '#gcBuyerReq')), JSON.stringify(legends));
  await p.click('[data-gc-quick="2500"]');
  await checkD('recipient');
  await p.evaluate(() => gcGoStep(1));
  check('10. "Direct naar de ontvanger" → vooraf: e-mail ontvanger verplicht (stap 2)', await vis(p, '#gcRecReq') && !(await vis(p, '#gcBuyerReq')));
  let c0 = await creates();
  await submit();
  check('10. Zonder e-mail ontvanger: nette melding, niets verstuurd, focus op het veld', /e-mailadres van de ontvanger in/.test(await note()) && await creates() === c0 && await p.evaluate(() => document.activeElement.id) === 'gcRecEmail');
  await checkD('buyer');
  await p.evaluate(() => gcGoStep(1));
  check('10. "Ik stuur hem zelf door" → vooraf: e-mail koper verplicht (stap 2)', await vis(p, '#gcBuyerReq') && !(await vis(p, '#gcRecReq')));
  await submit();
  check('10. Zonder e-mail koper: nette melding', /e-mailadres van de koper in/.test(await note()) && await creates() === c0);
  await checkD('none'); await fillF('#gcBuyerEmail', 'geen-mail'); await submit();
  check('10. Ongeldig e-mailadres koper', /e-mailadres van de koper klopt niet/.test(await note()));
  await fillF('#gcBuyerEmail', ''); await fillF('#gcRecEmail', 'x@'); await submit();
  check('10. Ongeldig e-mailadres ontvanger', /e-mailadres van de ontvanger klopt niet/.test(await note()));
  await fillF('#gcRecEmail', '');
  // Foutcodes van de server vertaald
  for (const [code, re] of [['invalid_delivery_mode', /Kies hoe de cadeaubon verstuurd wordt/], ['buyer_email_required', /e-mailadres van de koper in/], ['recipient_email_required', /e-mailadres van de ontvanger in/],
    ['invalid_buyer_email', /koper klopt niet/], ['invalid_recipient_email', /ontvanger klopt niet/]]) {
    await p.route('**/api/stamp/gift-cards', r => r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, code, error: 'x' }) }) : r.continue());
    await submit(); await p.waitForTimeout(250);
    check(`10. Server ${code} → Nederlandse melding`, re.test(await note()), await note());
    await p.unroute('**/api/stamp/gift-cards');
  }
  // Server invalid_expires_at (bijv. als de klok van het apparaat afwijkt)
  await p.route('**/api/stamp/gift-cards', r => r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, code: 'invalid_expires_at', error: 'x' }) }) : r.continue());
  await submit(); await p.waitForTimeout(250);
  check('10. Server invalid_expires_at → nette melding', /vervaldatum klopt niet of ligt in het verleden/.test(await note()), await note());
  await p.unroute('**/api/stamp/gift-cards');
  // Ontvangerblok leeg, geen e-mail
  await submit(); await p.waitForSelector('.gc-success');
  let body = (await state()).log.create.slice(-1)[0];
  check('10. Leeg ontvangerblok + geen e-mail: body zonder koper/ontvanger, delivery_mode none, met sleutel',
    JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['amount_cents', 'card_id', 'delivery_mode', 'idempotency_key']) && body.delivery_mode === 'none' && /^[0-9a-f-]{36}$/.test(body.idempotency_key), JSON.stringify(body));
  check('10. Resultaat: "geen e-mail verstuurd", link en kassa-instructie blijven', /geen e-mail verstuurd/.test(await txt(p, '.gc-success')) && /Boek op de kassa/.test(await txt(p, '.gc-success')));
  await p.click('[data-gc-close]');
  // Direct naar de ontvanger, mail lukt
  await newForm(); await p.click('[data-gc-quick="5000"]');
  await fillF('#gcBuyerName', 'Kees'); await fillF('#gcBuyerEmail', 'kees@example.nl');
  await fillF('#gcRecName', 'Mila'); await fillF('#gcRecEmail', 'mila@example.nl'); await fillF('#gcMessage', 'Fijne dag!');
  await checkD('recipient');
  await submit(); await p.waitForSelector('.gc-success');
  body = (await state()).log.create.slice(-1)[0];
  check('10. Body met koper, ontvanger, bericht en delivery_mode recipient', body.buyer_name === 'Kees' && body.buyer_email === 'kees@example.nl' && body.recipient_name === 'Mila'
    && body.recipient_email === 'mila@example.nl' && body.message === 'Fijne dag!' && body.delivery_mode === 'recipient' && body.amount_cents === 5000, JSON.stringify(body));
  check('10. Mail gelukt → "Cadeaubon gemaild naar de ontvanger (mila@example.nl)" + bevestiging naar de koper', /Cadeaubon gemaild naar de ontvanger \(mila@example\.nl\)/.test(await txt(p, '.gc-mails'))
    && /Aankoopbevestiging gemaild naar de koper \(kees@example\.nl\)/.test(await txt(p, '.gc-mails')), (await txt(p, '.gc-mails')).replace(/\s+/g, ' '));
  await p.click('[data-gc-close]');
  // Mail mislukt: bon bestaat wel, Opnieuw versturen
  await post('/__cfg', { mailFail: 'recipient' });
  await newForm(); await p.click('[data-gc-quick="1000"]'); await fillF('#gcRecEmail', 'stuk@example.nl'); await checkD('recipient');
  c0 = (await state()).gifts.length;
  await submit(); await p.waitForSelector('.gc-success');
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
  await newForm(); await p.click('[data-gc-quick="1000"]'); await fillF('#gcBuyerEmail', 'koper@example.nl'); await checkD('buyer');
  await submit(); await p.waitForSelector('.gc-success');
  check('10. "Ik stuur hem zelf door", mail mislukt → één melding (bon naar de koper) met knop voor de koper, geen ontvanger-regel',
    /niet verstuurd/.test(await txt(p, '.gc-mails')) && /Cadeaubon naar de koper/.test(await txt(p, '.gc-mails')) && await vis(p, '[data-gc-resend-now="buyer"]')
    && !(await p.$('[data-gc-resend-now="recipient"]')) && (await p.$$('.gc-mail')).length === 1, (await txt(p, '.gc-mails')).replace(/\s+/g, ' '));
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
  await submit(); await p.waitForTimeout(500);
  await submit(); await p.waitForSelector('.gc-success');
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
  await p.click('[data-gc-new]'); await p.click('[data-gc-quick="2500"]'); await p.click('#gcStepNext');
  await p.fill('#gcRecName', 'Rosa'); await p.fill('#gcRecEmail', 'rosa@example.nl'); await p.fill('#gcBuyerEmail', 'oud@example.nl'); await p.click('#gcStepNext');
  await p.check('input[name="gcDelivery"][value="buyer"]'); await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success'); await p.click('[data-gc-close]');
  await post('/__cfg', { mailFail: null });
  const rosa = (await state()).gifts.find(g => g.recipient_name === 'Rosa');
  await p.evaluate(id => openGiftDetail(id), rosa.id); await p.waitForSelector('.gc-detail');
  const ms = await txt(p, '.gc-mailstat');
  check('11. Verzendstatus (geneste gift_card.mail), koper-modus: ontvanger "niet van toepassing", koper "Mislukt (tijdstip laatste poging): fout"',
    /Mail ontvanger\s*Niet van toepassing/.test(ms) && /Mail koper \(bon en bevestiging\)\s*Mislukt \(\d+ \w+\.? 20\d\d, \d\d:\d\d\): .*Mailserver weigerde/.test(ms), ms.replace(/\s+/g, ' '));
  check('11. Koper en ontvanger met e-mailadres in eigen blokken', /oud@example\.nl/.test(await txt(p, '#gcSecBuyer')) && /Rosa/.test(await txt(p, '#gcSecRecipient')) && /rosa@example\.nl/.test(await txt(p, '#gcSecRecipient')));
  await p.click('.gc-detail [data-gc-copy]'); await p.waitForTimeout(150);
  check('11. "Link kopiëren" kopieert de deelbare link', (await p.evaluate(() => navigator.clipboard.readText())) === 'https://api.omrzdigital.nl/cadeaubon/' + rosa.code && /Gekopieerd/.test(await txt(p, '.gc-detail [data-gc-copy]')));
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
    && /Mail koper \(bon en bevestiging\)\s*Verstuurd op/.test(await txt(p, '.gc-mailstat')) && /nieuw@example\.nl/.test(await txt(p, '#gcSecBuyer')));
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
  const sanne = (await state()).gifts.find(g => g.short_code === 'ABCDEFGHJK');
  await p.evaluate(id => openGiftDetail(id), sanne.id); await p.waitForSelector('.gc-detail');
  await p.click('[data-gc-resend-open]'); await p.click('#gcResendBtn'); await p.waitForTimeout(400);
  check('11. Geen adres bekend → "geen e-mailadres bekend"', /geen e-mailadres bekend/.test(await txt(p, '#gcResendNote')) && /error/.test(await p.getAttribute('#gcResendNote', 'class')));
  await p.click('#modalClose');
  // Geblokkeerde bon
  const daan = (await state()).gifts.find(g => g.short_code === 'BZKD000001');
  await p.evaluate(id => openGiftDetail(id), daan.id); await p.waitForSelector('.gc-detail');
  check('11. Geblokkeerd: uitleg dat de pas in de Wallet blijft staan maar als ongeldig wordt getoond', /De pas blijft in de Wallet van de klant staan, maar wordt als ongeldig getoond/.test(await txt(p, '.gc-passnote')));
  // Blokkeren-route ontbreekt in de backend (404 zonder code): eerlijke melding
  await p.route('**/unblock', r => r.fulfill({ status: 404, contentType: 'text/html', body: 'Cannot POST' }));
  await p.click('[data-gc-block="unblock"]'); await p.click('[data-gc-block-confirm="unblock"]'); await p.waitForTimeout(300);
  check('11. Deblokkeren zonder backend-route → "Deblokkeren is nog niet beschikbaar"', /Deblokkeren is nog niet beschikbaar/.test(await txt(p, '#gcDetailNote')) && !/Cadeaubonnen zijn nog niet beschikbaar/.test(await txt(p, '#gcDetailNote')), await txt(p, '#gcDetailNote'));
  await p.unroute('**/unblock');
  await p.click('[data-gc-resend-open]'); await p.fill('#gcResendEmail', 'daan@example.nl'); await p.click('#gcResendBtn'); await p.waitForTimeout(400);
  check('11. 409 gift_card_blocked → nette melding', /geblokkeerd/.test(await txt(p, '#gcResendNote')));
  await p.click('#modalClose');
  // Blokkeren: bevestiging noemt de Wallet, nergens "verdwijnt"
  await p.evaluate(id => openGiftDetail(id), sanne.id); await p.waitForSelector('.gc-detail');
  await p.click('[data-gc-block="block"]');
  const bc11 = await txt(p, '#gcBlockConfirm');
  await p.click('[data-gc-block-confirm="block"]'); await p.waitForFunction(() => /Cadeaubon geblokkeerd/.test(document.getElementById('gcDetailNote').textContent));
  check('11. Blokkeer-bevestiging: pas blijft in de Wallet; nergens "verdwijnt"', /pas blijft in de Wallet van de klant staan/.test(bc11)
    && !/verdwijn|van de telefoon/i.test(bc11 + await txt(p, '#gcWrap') + await txt(p, '.gc-detail')));
  await p.screenshot({ path: OUT + '/gcd-detail-mail-1440.png' });
  await ctx.close();

  // ===== 12a. Tab Ontwerp alleen als GET /design werkt =====
  for (const [f, label] of [[404, '404 (endpoint bestaat niet)'], [503, '503'], ['net', 'netwerkfout']]) {
    await post('/__reset');
    await post('/__cfg', { designFail: f });
    ({ ctx, p } = await open(b, 'tok-pp', 'pp', null, { expectErrors: true }));
    await p.waitForSelector('.gc-row'); await p.waitForTimeout(500);
    check(`12a. Zonder /design (${label}): tab Ontwerp verborgen, geen foutmelding`, !(await vis(p, '[data-gc-view="design"]'))
      && (await p.$$('.gc-banner.error')).length === 0 && !/ontwerp/i.test(await txt(p, '#gcWrap .gc-top')));
    await ctx.close();
  }
  await post('/__cfg', { designFail: null });

  // ===== 12. Ontwerp (uitgebreid in suites/dashboard-design.js) =====
  await post('/__reset');
  ({ ctx, p } = await open(b, 'tok-pp', 'pp'));
  await p.waitForSelector('.gc-row');
  await p.waitForSelector('[data-gc-view="design"]:not([hidden])');
  check('12a. Met /design: tab Ontwerp zichtbaar', await vis(p, '[data-gc-view="design"]'));
  await ctx.close();
  for (const vp of [{ width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    ({ ctx, p } = await open(b, 'tok-pp', 'pp', vp));
    await p.waitForSelector('.gc-row');
    await p.click('[data-gc-new]'); await p.waitForSelector('#gcNewForm');
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
    await p.click('[data-gc-new]'); await p.click('[data-gc-quick="5000"]');
    for (const st of [0, 1, 2]) {
      check(`8. ${vp.width}px nieuw formulier stap ${st + 1}: geen horizontale scroll`, await noH(p));
      await p.screenshot({ path: OUT + '/' + `gcd-new-step${st + 1}-${vp.width}.png` });
      if (st < 2) await p.click('#gcStepNext');
    }
    await p.click('#gcNewBtn'); await p.waitForSelector('.gc-success');
    check(`8. ${vp.width}px succesblok: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcd-success-${vp.width}.png`, fullPage: true });
    await p.click('[data-gc-close]');
    await p.click('[data-gc-view="report"]'); await p.waitForSelector('#gcRepStats');
    check(`8. ${vp.width}px rapport: geen horizontale scroll`, await noH(p));
    await p.screenshot({ path: OUT + '/' + `gcd-report-${vp.width}.png`, fullPage: true });
    await ctx.close();
  }
};
