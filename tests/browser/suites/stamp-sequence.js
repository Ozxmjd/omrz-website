// Onderdeel S van de scanapp-suite: stempels en inwisselingen achter elkaar, zonder reload.
// Wordt door suites/scanapp.js aangeroepen.
let B = 'http://localhost:8792';
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json());
const state = () => fetch(B + '/__state').then(r => r.json());
const uuid = n => `${String(n).padStart(8, '0')}-9a4d-4e6f-b7c2-1d0e5a9f8b34`;
const VIP = 'vip-0000-9a4d-4e6f-b7c2-1d0e5a9f8b34';

async function stampSequence(b, check, pageErrors, base, opts) {
  if (base) B = base;
  const o = opts || {};
  const tag = o.scannerOn ? ' [cadeaubon-scanner aan]' : '';
  for (const tok of ['tok-basic', 'tok-pp']) {
    await post('/__reset');
    if (o.scannerOn) await post('/__settings', { card: tok.replace('tok-', ''), on: true });
    const ctx = await b.newContext({ viewport: { width: 820, height: 1180 } });
    await ctx.addInitScript(t => { localStorage.setItem('stamp_token', t); localStorage.setItem('stamp_card_id', t.replace('tok-', '')); window.confirm = () => true; }, tok);
    const p = await ctx.newPage();
    p.on('pageerror', e => pageErrors.push('stampseq ' + tok + ': ' + e.message));
    await p.goto(B + '/scan.html'); await p.waitForTimeout(800);
    if (o.scannerOn) check(`S0. ${tok}${tag}: keuze Stempelen/Cadeaubon ${tok === 'tok-pp' ? 'zichtbaar, op Stempelen' : 'niet zichtbaar (geen Premium Plus)'}`,
      (await p.evaluate(() => !document.getElementById('modeSeg').hidden && scanMode === 'stamp')) === (tok === 'tok-pp'));
    const scan = q => p.evaluate(q => routeScan(q), q);
    const vis = s => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, s);
    const gives = async () => (await state()).log.give;
    // Klikken die bij de bug vastlopen: kort wachten en doorgaan, zodat de suite een FAIL meldt i.p.v. te crashen.
    const tap = sel => p.click(sel, { timeout: 2000 }).then(() => true, () => false);
    let n = 0;
    // Stempel geven aan een nieuwe klant met 'amount' stempels; true als het verzoek de server haalde en het succesvenster kwam.
    async function giveTo(qr, amount) {
      await scan(qr); await p.waitForSelector('#resultStage.on', { timeout: 3000 }).catch(() => {});
      for (let i = 1; i < amount; i++) await p.click('#amountPlus', { timeout: 2000 }).catch(() => {});
      const before = (await gives()).length;
      await tap('#giveBtn');
      const ok = await p.waitForSelector('#successStage.on', { timeout: 3000 }).then(() => true, () => false);
      const after = await gives();
      return ok && after.length === before + 1 && after[after.length - 1].amount === amount;
    }

    // 1. Drie stempels achter elkaar, verschillende hoeveelheden, telkens na "Volgende klant"
    const r1 = await giveTo(uuid(++n), 1); await tap('#nextCustomerBtn');
    const r2 = await giveTo(uuid(++n), 2); await tap('#nextCustomerBtn');
    const r3 = await giveTo(uuid(++n), 3); await tap('#nextCustomerBtn');
    check(`S1. ${tok}${tag}: drie stempels achter elkaar (1, 2, 3) zonder reload`, r1 && r2 && r3, [r1, r2, r3].join('/'));

    // 2. Na een serverfout: opnieuw proberen lukt, en de volgende klant ook
    await post('/__cfg', { giveFail: 500 });
    await scan(uuid(++n)); await p.waitForSelector('#resultStage.on', { timeout: 3000 }).catch(() => {});
    await tap('#giveBtn'); await p.waitForTimeout(500);
    const errShown = /Interne fout|niet opgeslagen/.test(await p.textContent('#scanAlert')) && !(await p.isDisabled('#giveBtn'));
    await tap('#giveBtn'); const retryOk = await p.waitForSelector('#successStage.on', { timeout: 3000 }).then(() => true, () => false);
    await tap('#nextCustomerBtn');
    const afterErr = await giveTo(uuid(++n), 2); await tap('#nextCustomerBtn');
    check(`S2. ${tok}${tag}: na serverfout knop weer bruikbaar, opnieuw proberen en volgende klant lukken`, errShown && retryOk && afterErr, [errShown, retryOk, afterErr].join('/'));

    // 3. Na een netwerkfout
    await post('/__cfg', { giveFail: 'net' });
    await scan(uuid(++n)); await p.waitForSelector('#resultStage.on', { timeout: 3000 }).catch(() => {});
    await tap('#giveBtn'); await p.waitForTimeout(600);
    const netShown = (await p.textContent('#scanAlert')).length > 0 && !(await p.isDisabled('#giveBtn'));
    await tap('#giveBtn'); const netRetry = await p.waitForSelector('#successStage.on', { timeout: 3000 }).then(() => true, () => false);
    await tap('#nextCustomerBtn');
    const afterNet = await giveTo(uuid(++n), 1); await tap('#nextCustomerBtn');
    check(`S3. ${tok}${tag}: na netwerkfout opnieuw proberen en volgende klant lukken`, netShown && netRetry && afterNet, [netShown, netRetry, afterNet].join('/'));

    // 4. Na een Special Guest-scan (alleen kroonbericht) gewoon verder stempelen
    await scan(VIP); await p.waitForSelector('#resultStage.on', { timeout: 3000 }).catch(() => {});
    const sgOnly = (await vis('#custSg')) && !(await vis('#giveBtn'));
    await p.click('#resultStage .btn-ghost', { timeout: 2000 }).catch(() => {});                       // Annuleren
    const afterSg1 = await giveTo(uuid(++n), 3); await tap('#nextCustomerBtn');
    const afterSg2 = await giveTo(uuid(++n), 1); await tap('#nextCustomerBtn');
    check(`S4. ${tok}${tag}: na Special Guest-scan twee stempels achter elkaar`, sgOnly && afterSg1 && afterSg2, [sgOnly, afterSg1, afterSg2].join('/'));

    // 5. Twee keer inwisselen achter elkaar (kaart vol via stempel, uitreiken vanaf het succesvenster)
    let redeems = 0;
    for (let k = 0; k < 2; k++) {
      const qr = uuid(++n);
      await scan(qr); await p.waitForSelector('#resultStage.on', { timeout: 3000 }).catch(() => {});
      for (let i = 1; i < 5; i++) await p.click('#amountPlus', { timeout: 2000 }).catch(() => {});   // 3 + 5 = 8 → vol
      await tap('#giveBtn'); await p.waitForSelector('#successStage.on', { timeout: 3000 }).catch(() => {});
      const before = (await state()).log.redeemStamp.length;
      await tap('#successReward .btn');
      await p.waitForTimeout(600);
      if ((await state()).log.redeemStamp.length === before + 1 && /Beloning uitgereikt/.test(await p.textContent('#successTitle'))) redeems++;
      await tap('#nextCustomerBtn');
    }
    check(`S5. ${tok}${tag}: twee keer achter elkaar inwisselen`, redeems === 2, redeems + '/2');
    // 6. Volle kaart direct bij scannen → "Beloning uitreiken" (rewardControls), twee klanten na elkaar
    let direct = 0;
    for (let k = 0; k < 2; k++) {
      const qr = uuid(++n);
      await scan(qr); await p.waitForSelector('#resultStage.on', { timeout: 3000 }).catch(() => {});
      for (let i = 1; i < 5; i++) await p.click('#amountPlus', { timeout: 2000 }).catch(() => {});
      await tap('#giveBtn'); await p.waitForSelector('#successStage.on', { timeout: 3000 }).catch(() => {}); await tap('#nextCustomerBtn');
      await p.waitForTimeout(3100);                                // zelfde QR mag pas na 3 s opnieuw
      await scan(qr); await p.waitForSelector('#resultStage.on', { timeout: 3000 }).catch(() => {});
      const before = (await state()).log.redeemStamp.length;
      await tap('#rewardControls .btn'); await p.waitForTimeout(600);
      if ((await state()).log.redeemStamp.length === before + 1) direct++;
      await tap('#nextCustomerBtn');
    }
    check(`S6. ${tok}${tag}: "Beloning uitreiken" bij twee volle kaarten na elkaar`, direct === 2, direct + '/2');
    await ctx.close();
  }
}
module.exports = { stampSequence };

