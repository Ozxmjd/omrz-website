// Stempelflow-regressie: stempel geven en inwisselen in scan.html en Geef Stempel in het dashboard,
// op Basic en Premium Plus. Draait via tests/browser/run.js.
module.exports = async function run(env) {
  const { B, check } = env; const errs = env.pageErrors;
  const b = env.browser;
  for (const tok of ['tok-basic', 'tok-pp']) {
    await fetch(B + '/__reset', { method: 'POST' });   // elk account begint met dezelfde klantstand
    const card = tok.replace('tok-', '');
    const ctx = await b.newContext({ viewport: { width: 820, height: 1180 } });
    await ctx.addInitScript(([t, c]) => { localStorage.setItem('stamp_token', t); localStorage.setItem('stamp_card_id', c); localStorage.setItem('omrz_token', t); localStorage.setItem('omrz_card_id', c); window.confirm = () => true; }, [tok, card]);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(tok + ' ' + e.message));
    const reqs = []; p.on('request', r => { if (/\/api\/stamp\/(give|redeem|lookup)/.test(r.url())) reqs.push(r.method() + ' ' + new URL(r.url()).pathname); });
    // scan.html: stempel geven
    await p.goto(B + '/scan.html'); await p.waitForTimeout(800);
    await p.evaluate(() => routeScan('3f2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b34')); await p.waitForSelector('#resultStage.on');
    check(`${tok} scan.html: klant 3 van 8, stempelknop`, /3 van 8/.test(await p.textContent('#custMeta')) && await p.isVisible('#giveBtn'));
    await p.click('#giveBtn'); await p.waitForSelector('#successStage.on');
    check(`${tok} scan.html: stempel gegeven → POST /give`, reqs.includes('POST /api/stamp/give'));
    // volle kaart → inwisselen
    await p.route('**/api/stamp/lookup**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, holder_id: 'h2', customer_name: 'Volle Kaart', stamps_collected: 8, stamps_required: 8, reward_available: true, is_vip_forever: false }) }));
    await p.click('#nextCustomerBtn');
    await p.evaluate(() => routeScan('aaaaaaaa-9a4d-4e6f-b7c2-1d0e5a9f8b34')); await p.waitForSelector('#resultStage.on');
    check(`${tok} scan.html: volle kaart → "Beloning uitreiken"`, await p.isVisible('#rewardControls') && !(await p.isVisible('#giveControls')));
    await p.click('#rewardControls .btn'); await p.waitForSelector('#successStage.on');
    check(`${tok} scan.html: inwisselen → POST /redeem`, reqs.includes('POST /api/stamp/redeem'));
    await p.unroute('**/api/stamp/lookup**');
    // dashboard Geef Stempel
    await p.goto(B + '/dashboard.html'); await p.waitForTimeout(800);
    await p.evaluate(() => activateTab('stempel')); await p.evaluate(() => onQrDetected('3f2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b34'));
    await p.waitForSelector('#customerView:not([hidden])');
    await p.click('#confirmBtn'); await p.waitForSelector('#stampResult:not([hidden])');
    check(`${tok} dashboard Geef Stempel: stempel gegeven`, reqs.filter(x => x === 'POST /api/stamp/give').length === 2);
    await ctx.close();
  }
};
