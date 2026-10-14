// Browsertests voor de scanapp en de cadeaubonnen. Draaien: npm run test:browser
// Optioneel alleen bepaalde suites: npm run test:browser -- scanapp stamp-regression
// Start een nep-API (tests/browser/mock-api.js) die ook de site serveert, en een headless Chromium.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright ontbreekt. Eenmalig installeren:\n  npm --prefix tests/browser install\n  npx --prefix tests/browser playwright install chromium');
  process.exit(2);
}

const SUITES = [
  ['scanapp', 'Scanapp: stempelflow, cadeaubonnen en onderdeel S (stempelreeks zonder reload)'],
  ['stamp-regression', 'Stempelflow-regressie (scan.html en Geef Stempel)'],
  ['dashboard-giftcards', 'Dashboard: pagina Cadeaubonnen'],
  ['dashboard-scanner', 'Dashboard: Geef Stempel met keuze Stempelen | Cadeaubon'],
];
const PORT = Number(process.env.TEST_PORT || 8799);
const B = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, 'output');

function startMock() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'mock-api.js')], {
      env: { ...process.env, PORT: String(PORT), SITE: path.resolve(__dirname, '..', '..') }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    const t = setTimeout(() => reject(new Error('nep-API start niet')), 8000);
    child.stdout.on('data', d => { if (/nep-API op/.test(String(d))) { clearTimeout(t); resolve(child); } });
    child.on('exit', code => reject(new Error('nep-API gestopt (' + code + ')')));
  });
}

(async () => {
  const wanted = process.argv.slice(2);
  const run = SUITES.filter(([k]) => !wanted.length || wanted.includes(k));
  if (!run.length) { console.error('Onbekende suite. Kies uit: ' + SUITES.map(s => s[0]).join(', ')); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  const mock = await startMock();
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  let pass = 0, fail = 0, crashed = 0;
  try {
    for (const [key, title] of run) {
      await fetch(B + '/__reset', { method: 'POST' });
      const R = [], pageErrors = [], consoleErrors = [];
      const check = (n, ok, x) => R.push((ok ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  [' + x + ']' : ''));
      console.log('\n=== ' + title);
      try {
        await require('./suites/' + key + '.js')({ browser, B, check, pageErrors, consoleErrors, out: OUT });
      } catch (e) { crashed++; R.push('FAIL suite gecrasht: ' + (e && e.message ? e.message.split('\n')[0] : e)); }
      console.log(R.join('\n'));
      if (pageErrors.length) { R.push('FAIL'); console.log('JS-fouten:\n' + pageErrors.join('\n')); }
      pass += R.filter(r => r.startsWith('PASS')).length;
      fail += R.filter(r => r.startsWith('FAIL')).length;
    }
  } finally {
    await browser.close();
    mock.kill();
  }
  console.log(`\nTotaal: ${pass} geslaagd, ${fail} mislukt${crashed ? ', ' + crashed + ' suite(s) gecrasht' : ''}. Schermafbeeldingen: ${path.relative(process.cwd(), OUT)}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
