// Dashboard, Cadeaubonnen → Ontwerp (fase D): tien velden, opties, kanalen, uploads. Draait via tests/browser/run.js.
let B, check, pageErrors, consoleErrors, OUT;
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const state = () => fetch(B + '/__state').then(r => r.json());
// Een echte (kleine) PNG van 1x1 pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function open(b, extra = {}) {
  const ctx = await b.newContext({ viewport: extra.vp || { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => { if (!/dashboard/.test(location.pathname)) return; localStorage.setItem('omrz_token', 'tok-pp'); localStorage.setItem('omrz_card_id', 'pp'); localStorage.setItem('omrz_role', 'owner'); });
  const p = await ctx.newPage();
  p.on('pageerror', e => pageErrors.push('design: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !extra.expectErrors) consoleErrors.push('design: ' + m.text()); });
  p.calls = [];
  p.on('request', r => { const u = new URL(r.url()); if (/\/api\/stamp\/(gift-cards\/)?(design|upload)/.test(u.pathname)) p.calls.push(r.method() + ' ' + u.pathname); });
  await p.goto(B + '/dashboard.html'); await p.waitForTimeout(900);
  if (extra.theme) await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), extra.theme);
  if (extra.before) await extra.before(p);
  await p.evaluate(() => activateTab('cadeaubonnen'));
  await p.waitForSelector('[data-gc-view="design"]:not([hidden])', { timeout: 5000 }).catch(() => {});
  await p.click('[data-gc-view="design"]');
  await p.waitForSelector('#gcDsTheme', { timeout: 5000 }).catch(() => {});
  return { ctx, p };
}
const txt = (p, s) => p.evaluate(s => (document.querySelector(s) || {}).innerText || '', s);
const vis = (p, s) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, s);
const noH = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const lastPut = async () => JSON.stringify((await state()).log.designPut.slice(-1)[0]);
const saved = p => p.waitForFunction(() => /opgeslagen|ververst|stempelkaart\./.test((document.getElementById('gcDesignNote') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
const pv = (p, attr) => p.frameLocator('#gcDesignFrame').locator('#pv').getAttribute(attr);
const chip = (p, k) => txt(p, `[data-gc-drow="${k}"] .gc-dchip`);

module.exports = async function run(env) {
  ({ B, check, pageErrors, consoleErrors, out: OUT } = env);
  const b = env.browser;
  await post('/__reset');

  // ===== A. Laden: tien velden, opties en kanalen uit de backend =====
  let { ctx, p } = await open(b);
  const themes = await p.$$eval('[data-gc-theme]', bs => bs.map(x => [x.dataset.gcTheme, x.getAttribute('aria-checked')]));
  check('A. Vier thema\'s uit options, het overgenomen thema (modern) gekozen', JSON.stringify(themes) === JSON.stringify([['klassiek', 'false'], ['modern', 'true'], ['minimaal', 'false'], ['feestelijk', 'false']]), JSON.stringify(themes));
  check('A. Thema-chip "Van stempelkaart"', /Van stempelkaart/.test(await txt(p, '#gcDsTheme .gc-dhead')));
  const fonts = await p.$$eval('[data-gc-dinput="font"] option', o => o.map(x => x.value));
  check('A. Lettertypes uit options (zes), Inter gekozen', JSON.stringify(fonts) === JSON.stringify(['Inter', 'Playfair Display', 'Poppins', 'Montserrat', 'Lora', 'Bebas Neue']) && (await p.inputValue('[data-gc-dinput="font"]')) === 'Inter', JSON.stringify(fonts));
  check('A. Bedraggrootte: klein/normaal/groot, normaal actief', (await p.$$eval('[data-gc-size]', s => s.map(x => x.dataset.gcSize + (x.classList.contains('active') ? '*' : '')).join(','))) === 'klein,normaal*,groot');
  check('A. Kleuren uit design in kleine letters (bon, tekst, accent)', (await p.inputValue('[data-gc-dinput="pass_color"]')) === '#1f4d2b' && (await p.inputValue('[data-gc-dinput="text_color"]')) === '#ffffff' && (await p.inputValue('[data-gc-dinput="accent_color"]')) === '#d4a373');
  check('A. Geen "Overnemen" bij Naam op de pas en bedraggrootte (en niet bij overgenomen velden)', !(await p.$('[data-gc-inherit="show_name"]')) && !(await p.$('[data-gc-inherit="amount_size"]')) && !(await p.$('[data-gc-inherit="pass_color"]')));
  check('A. Kanalen per veld uit applies_to', /Zichtbaar op: Bonpagina · E-mail$/.test((await txt(p, '#gcDsTheme .gc-chan')).trim())
    && /Bonpagina · E-mail · Google Wallet/.test(await txt(p, '[data-gc-drow="accent_color"] .gc-chan')) && /Bonpagina · Google Wallet/.test(await txt(p, '[data-gc-drow="background_url"] .gc-chan')));
  const apple = await p.$$eval('#gcMatrix tbody tr', r => r.filter(x => x.cells[3].classList.contains('yes')).map(x => x.dataset.field));
  check('A. Overzicht "wat verandert waar": Apple alleen kleuren, logo en naam', JSON.stringify(apple) === JSON.stringify(['pass_color', 'text_color', 'logo_url', 'business_name', 'show_name']), JSON.stringify(apple));
  check('A. Voorbeeld = iframe op preview_url', (await p.getAttribute('#gcDesignFrame', 'src')) === B + '/__preview?card=pp&token=t-pp');
  check('A. Logo van de stempelkaart in de uploadtegel, met "Van stempelkaart"', /kaart\.png$/.test(await p.getAttribute('[data-gc-drow="logo_url"] .gc-up-img', 'data-src')) && /Van stempelkaart/.test(await chip(p, 'logo_url')));
  check('A. Opslaan uit en "Alles is opgeslagen." zolang er niets gewijzigd is', await p.isDisabled('#gcDesignSave') && /Alles is opgeslagen/.test(await txt(p, '#gcDesignNote')));
  await p.screenshot({ path: OUT + '/' + 'gcdz-start-1440.png', fullPage: true });

  // ===== B. Thema kiezen: alleen het thema, nooit de kleuren =====
  await p.click('[data-gc-theme="feestelijk"]');
  check('B. Feestelijk gekozen, "1 wijziging nog niet opgeslagen"', (await p.getAttribute('[data-gc-theme="feestelijk"]', 'aria-checked')) === 'true' && /1 wijziging nog niet opgeslagen/.test(await txt(p, '#gcDesignNote')) && !(await p.isDisabled('#gcDesignSave')));
  check('B. Kleuren onveranderd na thema-keuze', (await p.inputValue('[data-gc-dinput="pass_color"]')) === '#1f4d2b' && (await p.inputValue('[data-gc-dinput="accent_color"]')) === '#d4a373');
  await p.click('#gcDesignSave'); await saved(p);
  check('B. PUT met alleen het thema', (await lastPut()) === '{"card_id":"pp","theme":"feestelijk"}', await lastPut());
  check('B. Voorbeeld ververst met het nieuwe thema', /&_=\d+$/.test(await p.getAttribute('#gcDesignFrame', 'src')) && (await pv(p, 'data-theme')) === 'feestelijk');
  check('B. Thema nu "Eigen instelling" met "Overnemen van stempelkaart"', /Eigen instelling/.test(await txt(p, '#gcDsTheme .gc-dhead')) && await vis(p, '[data-gc-inherit="theme"]'));

  // ===== C. Accent, lettertype, bedraggrootte, naam op de pas =====
  await p.fill('[data-gc-dinput="accent_color"]', '#C0392B');
  await p.selectOption('[data-gc-dinput="font"]', 'Lora');
  await p.click('[data-gc-size="groot"]');
  await p.uncheck('[data-gc-dinput="show_name"]');
  check('C. "4 wijzigingen nog niet opgeslagen"', /4 wijzigingen nog niet opgeslagen/.test(await txt(p, '#gcDesignNote')));
  await p.click('#gcDesignSave'); await saved(p);
  check('C. PUT: accent in kleine letters, font als label, amount_size, show_name boolean', (await lastPut()) === '{"card_id":"pp","accent_color":"#c0392b","show_name":false,"font":"Lora","amount_size":"groot"}', await lastPut());
  check('C. Voorbeeld toont accent en grootte', (await pv(p, 'data-accent')) === '#c0392b' && (await pv(p, 'data-size')) === 'groot');
  check('C. Na opnieuw ophalen: Lora, groot, naam uit', (await p.inputValue('[data-gc-dinput="font"]')) === 'Lora' && /groot/.test(await p.$eval('[data-gc-size].active', x => x.dataset.gcSize)) && !(await p.isChecked('[data-gc-dinput="show_name"]')));
  // Overnemen
  await p.click('[data-gc-inherit="theme"]'); await p.click('[data-gc-inherit="accent_color"]');
  check('C. Overnemen → "Wordt overgenomen na opslaan"', /Wordt overgenomen na opslaan/.test(await txt(p, '#gcDsTheme .gc-dhead')) && /Wordt overgenomen na opslaan/.test(await chip(p, 'accent_color')));
  await p.click('#gcDesignSave'); await saved(p);
  check('C. PUT met null = weer overnemen', (await lastPut()) === '{"card_id":"pp","theme":null,"accent_color":null}', await lastPut());
  check('C. Terug op modern en #d4a373, "Van stempelkaart"', (await p.getAttribute('[data-gc-theme="modern"]', 'aria-checked')) === 'true' && (await p.inputValue('[data-gc-dinput="accent_color"]')) === '#d4a373' && /Van stempelkaart/.test(await chip(p, 'accent_color')));
  // Ongedaan maken
  await p.click('[data-gc-theme="minimaal"]'); await p.fill('[data-gc-dinput="business_name"]', 'Iets anders');
  await p.click('#gcDesignUndo');
  check('C. "Wijzigingen ongedaan maken" zet alles terug, geen PUT', (await p.getAttribute('[data-gc-theme="modern"]', 'aria-checked')) === 'true' && (await p.inputValue('[data-gc-dinput="business_name"]')) === 'Loris Parfum' && await p.isDisabled('#gcDesignSave'));

  // ===== D. Contrast en controles vooraf =====
  await p.fill('[data-gc-dinput="text_color"]', '#2e5b46');
  check('D. Tekstkleur bijna gelijk aan bonkleur → waarschuwing over leesbaarheid', /slecht leesbaar/.test(await txt(p, '#gcContrast')));
  await p.fill('[data-gc-dinput="text_color"]', '#ffffff');
  check('D. Goed contrast → geen waarschuwing', (await txt(p, '#gcContrast')) === '');
  const putsD = (await state()).log.designPut.length;
  await p.fill('[data-gc-dinput="accent_color"]', 'rood'); await p.click('#gcDesignSave'); await p.waitForTimeout(300);
  check('D. Ongeldige accentkleur → melding bij het veld, geen PUT', /Deze kleur klopt niet/.test(await txt(p, '[data-gc-derr="accent_color"]')) && (await state()).log.designPut.length === putsD
    && await p.evaluate(() => document.querySelector('[data-gc-drow="accent_color"]').classList.contains('has-err')));
  await p.fill('[data-gc-dinput="accent_color"]', '#d4a373');
  check('D. Veld aanpassen haalt de foutmelding weg', (await txt(p, '[data-gc-derr="accent_color"]')) === '');

  // ===== E. Fouten van de server bij het juiste veld =====
  for (const [code, field, sel, msg] of [['invalid_theme', 'theme', '#gcDsTheme [data-gc-derr="theme"]', /thema/], ['invalid_font', 'font', '[data-gc-derr="font"]', /Dit is geen geldige keuze|lettertype/],
    ['invalid_amount_size', 'amount_size', '[data-gc-derr="amount_size"]', /Dit is geen geldige keuze|klein, normaal of groot/], ['invalid_color', 'text_color', '[data-gc-derr="text_color"]', /kleur/i],
    ['invalid_show_name', 'show_name', '[data-gc-derr="show_name"]', /naam/i]]) {
    await p.route('**/api/stamp/gift-cards/design', r => r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code, error: 'Dit is geen geldige keuze. Kies uit: x.', field }) }) : r.continue());
    await p.click('[data-gc-theme="klassiek"]'); await p.click('#gcDesignSave'); await p.waitForTimeout(300);
    const t = await txt(p, sel);
    check(`E. ${code} → melding bij ${field}, geen ruwe code`, msg.test(t) && !/_/.test(t) && /Controleer de gemarkeerde instelling/.test(await txt(p, '#gcDesignNote')), t);
    await p.unroute('**/api/stamp/gift-cards/design');
    await p.click('#gcDesignUndo');
  }
  for (const [st, code, re] of [[503, 'migration_missing', /nog niet ingericht/], [400, 'nothing_to_update', /Er is niets gewijzigd/], [403, 'owner_only', /Alleen de eigenaar/]]) {
    await p.route('**/api/stamp/gift-cards/design', r => r.request().method() === 'PUT' ? r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify({ code, error: 'x' }) }) : r.continue());
    await p.click('[data-gc-theme="klassiek"]'); await p.click('#gcDesignSave'); await p.waitForTimeout(300);
    check(`E. ${st} ${code} → nette melding in de balk`, re.test(await txt(p, '#gcDesignNote')), await txt(p, '#gcDesignNote'));
    await p.unroute('**/api/stamp/gift-cards/design');
    await p.click('#gcDesignUndo');
  }
  await ctx.close();

  // ===== F. Uploads =====
  await post('/__reset');
  ({ ctx, p } = await open(b));
  await p.fill('[data-gc-dinput="business_name"]', 'Nog niet opgeslagen');       // moet een upload overleven
  await post('/__cfg', { uploadDelay: 700 });
  p.calls.length = 0;
  await p.setInputFiles('[data-gc-file="logo_url"]', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForTimeout(250);
  check('F. Tijdens upload: voortgangsbalk en "Uploaden…"', await vis(p, '[data-gc-prog="logo_url"]') && /Uploaden/.test(await txt(p, '[data-gc-upnote="logo_url"]')));
  await p.waitForFunction(() => /geüpload/.test((document.getElementById('gcDesignNote') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  await post('/__cfg', { uploadDelay: 0 });
  const up = (await state()).log.upload.slice(-1)[0];
  check('F. POST /api/stamp/gift-cards/upload-logo, multipart, Bearer-token (niet de stempelkaart-route)', up && up.kind === 'logo' && /^multipart\/form-data; boundary=/.test(up.contentType) && up.auth === 'Bearer tok-pp'
    && p.calls.includes('POST /api/stamp/gift-cards/upload-logo') && !p.calls.includes('POST /api/stamp/upload-logo'), p.calls.join('|'));
  check('F. Daarna GET /design, geen PUT voor de upload', p.calls.filter(c => c === 'GET /api/stamp/gift-cards/design').length >= 1 && !p.calls.includes('PUT /api/stamp/gift-cards/design'));
  check('F. Nieuw logo in beeld als eigen instelling, voorbeeld ververst', /\/gift\/gift-logo-pp-\d+\.png$/.test(await p.getAttribute('[data-gc-drow="logo_url"] .gc-up-img', 'data-src')) && /Eigen instelling/.test(await chip(p, 'logo_url'))
    && /gift-logo-pp/.test(await pv(p, 'data-logo')) && /&_=\d+$/.test(await p.getAttribute('#gcDesignFrame', 'src')));
  check('F. Niet opgeslagen naam blijft staan na de upload', (await p.inputValue('[data-gc-dinput="business_name"]')) === 'Nog niet opgeslagen' && /1 wijziging nog niet opgeslagen/.test(await txt(p, '#gcDesignNote')));
  await p.screenshot({ path: OUT + '/' + 'gcdz-upload-1440.png', fullPage: true });
  // Controles vooraf: geen verzoek
  const nUp = (await state()).log.upload.length;
  await p.setInputFiles('[data-gc-file="background_url"]', { name: 'anim.gif', mimeType: 'image/gif', buffer: PNG });
  check('F. GIF → "Kies een PNG-, JPG- of WebP-afbeelding", geen upload', /PNG-, JPG- of WebP/.test(await txt(p, '[data-gc-upnote="background_url"]')) && (await state()).log.upload.length === nUp);
  await p.setInputFiles('[data-gc-file="background_url"]', { name: 'groot.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 10) });
  check('F. Groter dan 5 MB → nette melding, geen upload', /groter dan 5 MB/.test(await txt(p, '[data-gc-upnote="background_url"]')) && (await state()).log.upload.length === nUp);
  // Fouten van de server (alleen { error })
  for (const [st, body, re] of [[400, { error: 'Bestand is te groot (max 5MB)' }, /groter dan 5 MB/], [400, { error: 'Alleen afbeeldingen toegestaan (png, jpg, jpeg, webp)' }, /PNG-, JPG- of WebP/],
    [403, { error: 'Geen toegang' }, /Alleen de eigenaar/], [500, { error: 'storage kapot' }, /Uploaden is niet gelukt/]]) {
    await p.route('**/gift-cards/upload-background', r => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(body) }));
    await p.setInputFiles('[data-gc-file="background_url"]', { name: 'bg.jpg', mimeType: 'image/jpeg', buffer: PNG });
    await p.waitForTimeout(300);
    const t = await txt(p, '[data-gc-upnote="background_url"]');
    check(`F. Server ${st} bij upload → "${re.source.replace(/\\/g, '')}"`, re.test(t) && !/storage|max 5MB/.test(t), t);
    await p.unroute('**/gift-cards/upload-background');
  }
  await p.setInputFiles('[data-gc-file="background_url"]', { name: 'bg.webp', mimeType: 'image/webp', buffer: PNG });
  await p.waitForFunction(() => /Achtergrondafbeelding geüpload/.test((document.getElementById('gcDesignNote') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check('F. Achtergrond (webp) geüpload via /upload-background', /\/gift\/gift-bg-pp-\d+\.webp$/.test(await p.getAttribute('[data-gc-drow="background_url"] .gc-up-img', 'data-src')) && (await state()).log.upload.slice(-1)[0].kind === 'background');
  // Overnemen van de stempelkaart: meteen PUT null
  await p.click('[data-gc-inherit-now="logo_url"]');
  await p.waitForFunction(() => /komt weer van de stempelkaart/.test((document.getElementById('gcDesignNote') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check('F. "Overnemen van stempelkaart" bij het logo → PUT {logo_url: null}', (await lastPut()) === '{"card_id":"pp","logo_url":null}', await lastPut());
  check('F. Logo weer van de stempelkaart; naam-wijziging nog steeds niet opgeslagen', /kaart\.png$/.test(await p.getAttribute('[data-gc-drow="logo_url"] .gc-up-img', 'data-src')) && /Van stempelkaart/.test(await chip(p, 'logo_url'))
    && (await p.inputValue('[data-gc-dinput="business_name"]')) === 'Nog niet opgeslagen');
  await ctx.close();

  // ===== G. Opties komen uit de backend, niet uit de code =====
  ({ ctx, p } = await open(b, { before: async pg => pg.route('**/api/stamp/gift-cards/design?**', async r => {
    const res = await r.fetch(); const j = await res.json(); j.options.themes = j.options.themes.concat(['retro']); j.options.fonts = j.options.fonts.concat(['Roboto Slab']); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); }) }));
  check('G. Extra thema en lettertype uit options verschijnen', !!(await p.$('[data-gc-theme="retro"]')) && (await p.$$eval('[data-gc-dinput="font"] option', o => o.map(x => x.value))).includes('Roboto Slab'));
  await ctx.close();

  // ===== H. Per kanaal =====
  ({ ctx, p } = await open(b));
  await p.click('[data-gc-ptab="mail"]');
  const mail = await txt(p, '#gcChanText');
  check('H. E-mail: wat wel en wat niet', /Verandert in de e-mail:.*thema.*lettertype.*grootte van het bedrag/.test(mail) && /Niet in de e-mail:.*achtergrondafbeelding.*naam van de ontvanger op de pas/.test(mail), mail);
  await p.click('[data-gc-ptab="wallet"]');
  const wal = await txt(p, '#gcChanText');
  check('H. Wallet: Apple alleen kleuren, logo en naam; thema/lettertype/grootte niet op de pas', /Apple Wallet toont alleen: kleur van de bon, tekstkleur, logo, naam op de cadeaubon, naam van de ontvanger op de pas/.test(wal)
    && /Thema, lettertype en bedraggrootte gelden niet voor de Wallet-passen/.test(wal) && !(await vis(p, '#gcDesignFrame')), wal);
  await p.click('[data-gc-ptab="page"]');
  check('H. Terug naar Bonpagina → voorbeeld', await vis(p, '#gcDesignFrame'));
  await ctx.close();

  // ===== I. Schermformaten en licht thema =====
  for (const vp of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    ({ ctx, p } = await open(b, { vp }));
    check(`I. ${vp.width}px ontwerp: geen horizontale scroll`, await noH(p));
    check(`I. ${vp.width}px thema-kaarten en uploadknoppen bruikbaar (≥ 36px hoog)`, await p.evaluate(() => [...document.querySelectorAll('.gc-theme, .gc-up-actions .btn')].every(x => x.getBoundingClientRect().height >= 36)));
    await p.screenshot({ path: OUT + '/' + `gcdz-${vp.width}.png`, fullPage: true });
    await ctx.close();
  }
  ({ ctx, p } = await open(b, { theme: 'light' }));
  await p.screenshot({ path: OUT + '/' + 'gcdz-light-1440.png', fullPage: true });
  check('I. Licht thema rendert', await vis(p, '#gcDsTheme'));
  await ctx.close();
};
