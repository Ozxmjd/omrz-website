// Nep-API voor de browsertests: het cadeaubon-contract (stateful), stempelen/inwisselen en wat het
// dashboard en de scanapp bij het opstarten nodig hebben. Serveert de site uit SITE (standaard de repo).
// Beheer-routes voor de tests: /__reset, /__cfg, /__state.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const SITE = process.env.SITE || path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.PORT || 8792), BASE = 'http://localhost:' + PORT;
const tokens = {
  'tok-pp': { card: 'pp', owner: true, plan: 'premium_plus', biz: 'Loris Parfum' },
  'tok-mgr': { card: 'pp', owner: false, plan: 'premium_plus', location: 'L1', biz: 'Loris Parfum' },
  'tok-basic': { card: 'basic', owner: true, plan: 'basic', biz: 'Basiszaak' },
  'tok-trial': { card: 'trial', owner: true, plan: 'basic', access_status: 'trial', biz: 'Proefzaak' },
  'tok-ptrial': { card: 'ptrial', owner: true, plan: 'premium', access_status: 'trial', biz: 'Premium Proef' },
  'tok-pptrial': { card: 'pptrial', owner: true, plan: 'premium_plus', access_status: 'trial', biz: 'Plus Proef' },
};
const locs = { pp: [{ id: 'L1', name: 'Centrum' }, { id: 'L2', name: 'Noord' }], basic: [], trial: [], ptrial: [], pptrial: [] };
let S;
function reset() {
  S = { gifts: [], txs: [], ref: 400, idem: {}, cfg: { notLive: false, rateLimited: false, redeemDelay: 0, failLookup: false, settingsFail: null }, settings: {}, log: { redeem: [], create: [], lookup: [], give: [], redeemStamp: [], settingsPut: [], settingsGet: 0 }, holders: { 'vip-0000-9a4d-4e6f-b7c2-1d0e5a9f8b34': { name: 'Vaste Gast', stamps: 2, vip: true } } };
  const now = Date.now();
  mk('pp', 5000, { recipient_name: 'Sanne de Vries', message: 'Gefeliciteerd!' }, now - 5 * 864e5, 'ABCD-EFGH-JK', 'longcodeSanne123');
  mk('pp', 2500, { recipient_name: 'Daan' }, now - 3 * 864e5, 'BLKD-0000-01', 'longcodeBlocked1').status = 'blocked';
  const e = mk('pp', 1000, {}, now - 2 * 864e5, 'EMPT-0000-02', 'longcodeEmpty001'); redeemRaw(e, 1000, 'L1');
  mk('pp', 3000, { recipient_name: 'Verlopen Vera', expires_at: new Date(now - 864e5).toISOString() }, now - 40 * 864e5, 'EXPI-0000-03', 'longcodeExpired1').status = 'expired';
  mk('basic', 2000, { recipient_name: 'Basic klant' }, now, 'BASI-0000-04', 'longcodeBasic001');
  // Staat nog op 'active' maar de vervaldatum is voorbij: moet als Verlopen getoond worden.
  mk('pp', 1500, { recipient_name: 'Peter Verstreken', expires_at: new Date(now - 3600e3).toISOString() }, now - 20 * 864e5, 'PAST-0000-05', 'longcodePast0001');
  mk('pptrial', 2000, { recipient_name: 'Proefklant' }, now, 'PROE-0000-06', 'longcodeProef001');
}
const ref = () => 'CB-' + String(++S.ref).padStart(4, '0');
function mk(card, cents, extra, t, short, code) {
  const g = { id: crypto.randomUUID(), card_id: card, code: code || crypto.randomBytes(9).toString('base64url'), short_code: short || [4, 4, 2].map(n => crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, n)).join('-'),
    initial_amount_cents: cents, balance_cents: cents, status: 'active', recipient_name: null, recipient_email: null, message: null, expires_at: null, created_at: new Date(t || Date.now()).toISOString(), ...extra };
  g.share_url = 'https://omrzdigital.nl/cadeaubon/' + g.code;
  S.gifts.push(g);
  S.txs.push({ id: crypto.randomUUID(), gift_card_id: g.id, card_id: card, type: 'issue', amount_cents: cents, balance_after_cents: cents, reference_number: ref(), location_id: null, actor: 'owner', note: null, created_at: g.created_at });
  return g;
}
function redeemRaw(g, cents, loc) {
  g.balance_cents -= cents; if (g.balance_cents === 0) g.status = 'empty';
  const tx = { id: crypto.randomUUID(), gift_card_id: g.id, card_id: g.card_id, type: 'redeem', amount_cents: -cents, balance_after_cents: g.balance_cents, reference_number: ref(), location_id: loc || null, actor: 'staff', note: null, created_at: new Date().toISOString() };
  S.txs.push(tx); return tx;
}
reset();
const pub = g => { const { card_id, ...r } = g; return r; };
const send = (res, st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(JSON.stringify(obj)); };
const fail = (res, st, code, error, extra) => send(res, st, { success: false, code, error, ...(extra || {}) });
const findCode = (card, code) => {
  let c = String(code || '').trim(); const m = c.match(/\/cadeaubon\/([^/?#]+)/i); if (m) c = m[1];
  return S.gifts.find(g => g.card_id === card && (g.code === c || g.short_code === c.toUpperCase()));
};

function api(req, res, url, body, rawBody) {
  const p = url.pathname, q = url.searchParams; let m;
  const tok = tokens[(req.headers.authorization || '').replace('Bearer ', '')];
  if (p === '/__reset') { reset(); return send(res, 200, {}); }
  if (p === '/__cfg') { Object.assign(S.cfg, body); return send(res, 200, S.cfg); }
  if (p === '/__state') return send(res, 200, S);
  if (p === '/__settings') { S.settings[body.card] = body.on === true; return send(res, 200, S.settings); }
  if (p === '/api/stamp/subscription') { if (!tok) return send(res, 401, { error: 'Niet ingelogd' }); return send(res, 200, { success: true, plan: tok.plan, access_status: tok.access_status || 'active', has_access: true }); }
  if (p === '/api/stamp/locations') return send(res, 200, { success: true, locations: tok ? locs[tok.card] : [] });
  if ((m = p.match(/^\/api\/stamp\/cards\/(\w+)$/))) return send(res, 200, { success: true, card: { id: m[1], business_name: (Object.values(tokens).find(t => t.card === m[1]) || {}).biz, card_title: 'Spaarkaart', stamps_required: 8, reward_description: 'gratis product' } });
  if (p === '/api/stamp/overview-stats') return send(res, 200, { success: true, card_id: q.get('card_id'), location_id: null, total_customers: 3, total_rewards: 1, stamps_today: 0, stamps_week: 2, generated_at: new Date().toISOString() });
  if (p === '/api/stamp/scan-pincode-status') return send(res, 200, { success: true, pincode_set: false });
  if (p === '/api/stamp/today-stats') return send(res, 200, { success: true, stamps_today: 2, customers_today: 1 });
  if (p === '/api/stamp/lookup') {
    const h = S.holders[q.get('customer_qr_code')] || (S.holders[q.get('customer_qr_code')] = { name: 'Stempel Klant', stamps: 3, vip: false });
    return send(res, 200, { success: true, holder_id: 'h-' + q.get('customer_qr_code').slice(0, 8), customer_name: h.name, stamps_collected: h.stamps, stamps_required: 8,
      reward_available: h.vip || h.stamps >= 8, is_vip_forever: h.vip, vip_label: h.vip ? 'Special Guest' : null, display_stamps_collected: h.vip ? 8 : h.stamps, reward_description: 'gratis product' });
  }
  if (p === '/api/stamp/give' && req.method === 'POST') {
    S.log.give.push(body);
    if (S.cfg.giveFail === 500) { S.cfg.giveFail = null; return send(res, 500, { error: 'Interne fout' }); }
    if (S.cfg.giveFail === 'net') { S.cfg.giveFail = null; return req.socket.destroy(); }
    const h = S.holders[body.customer_qr_code] || (S.holders[body.customer_qr_code] = { name: 'Stempel Klant', stamps: 3, vip: false });
    h.stamps = Math.min(8, h.stamps + body.amount);
    return send(res, 200, { success: true, current_stamps: h.stamps, stamps_required: 8, is_full: h.stamps >= 8, reward_available: h.stamps >= 8 });
  }
  if (p === '/api/stamp/redeem' && req.method === 'POST') {
    S.log.redeemStamp.push(body);
    const h = S.holders[body.customer_qr_code]; if (h) h.stamps = 0;
    return send(res, 200, { success: true });
  }

  if (p.startsWith('/api/stamp/gift-cards')) {
    if (S.cfg.notLive) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<pre>Cannot ' + req.method + ' ' + p + '</pre>'); }
    if (!tok) return fail(res, 401, 'unauthorized', 'Niet ingelogd');
    if (tok.plan !== 'premium_plus') return fail(res, 403, 'premium_plus_required', 'Cadeaubonnen horen bij Premium Plus.', { upgrade_required: true });
    if (S.cfg.rateLimited) return fail(res, 429, 'rate_limited', 'Te veel verzoeken');
    const card = tok.card;
    // Instelling: cadeaubon-scanner voor medewerkers (standaard uit). Lezen mag iedereen van de zaak,
    // wijzigen alleen de eigenaar.
    if (p === '/api/stamp/gift-cards/settings') {
      const f = S.cfg.settingsFail;
      if (f === 404) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('Cannot ' + req.method); }
      if (f === 'migration') return fail(res, 503, 'migration_missing', 'Draai migratie');
      if (f === 500) return fail(res, 500, null, 'Interne fout');
      // Zelfde velden als de echte backend (ai-review-bot 9abe6c0).
      const out = on => ({ success: true, card_id: card, gift_cards_scanner_enabled: on, is_premium_plus: true, available: on });
      if (req.method === 'GET') { S.log.settingsGet++; return send(res, 200, out(S.settings[card] === true)); }
      if (req.method === 'PUT') {
        if (!tok.owner) return fail(res, 403, 'owner_only', 'Alleen eigenaar');
        if (f === 'putFail') return fail(res, 500, null, 'Opslaan mislukt op de server');
        S.log.settingsPut.push({ body, raw: rawBody, contentType: req.headers['content-type'] || null });
        if (!body.card_id) return fail(res, 400, 'card_id_required', 'card_id is verplicht');
        if (typeof body.enabled !== 'boolean') return fail(res, 400, 'invalid_enabled', 'enabled moet true of false zijn');
        S.settings[card] = body.enabled;
        return send(res, 200, out(S.settings[card]));
      }
    }
    if (p === '/api/stamp/gift-cards' && req.method === 'POST') {
      if (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0) return fail(res, 400, 'invalid_amount', 'Ongeldig bedrag');
      const g = mk(card, body.amount_cents, { recipient_name: body.recipient_name || null, message: body.message || null, recipient_email: body.recipient_email || null, expires_at: body.expires_at || null });
      S.log.create.push(body);
      // Zelfde vorm als de backend: het referentienummer zit in transaction.
      const tx = S.txs[S.txs.length - 1];
      return send(res, 201, { success: true, gift_card: pub(g), transaction: { id: tx.id, reference_number: tx.reference_number } });
    }
    if (p === '/api/stamp/gift-cards' && req.method === 'GET') {
      let list = S.gifts.filter(g => g.card_id === card).sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (q.get('status')) list = list.filter(g => g.status === q.get('status'));
      if (q.get('q')) { const t = q.get('q').toLowerCase(); list = list.filter(g => (g.recipient_name || '').toLowerCase().includes(t) || g.short_code.toLowerCase().includes(t)); }
      const all = S.gifts.filter(g => g.card_id === card && g.status === 'active');
      const off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 50);
      return send(res, 200, { success: true, gift_cards: list.slice(off, off + lim).map(pub), total: list.length, totals: { outstanding_cents: all.reduce((n, g) => n + g.balance_cents, 0), active_count: all.length } });
    }
    if (p === '/api/stamp/gift-cards/lookup') {
      S.log.lookup.push(q.get('code'));
      const g = findCode(card, q.get('code'));
      if (!g) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
      return send(res, 200, { success: true, gift_card: { id: g.id, shop_name: tok.biz, balance_cents: g.balance_cents, status: g.status, recipient_name: g.recipient_name, expires_at: g.expires_at, short_code: g.short_code }, can_redeem: g.status === 'active' && g.balance_cents > 0 });
    }
    if (p === '/api/stamp/gift-cards/redeem' && req.method === 'POST') {
      S.log.redeem.push({ ...body, auth: tok.owner ? 'owner' : 'mgr' });
      const done = () => {
        if (S.idem[body.idempotency_key]) return send(res, 200, S.idem[body.idempotency_key]);
        const g = findCode(card, body.code);
        if (!g) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
        if (g.status === 'blocked') return fail(res, 409, 'gift_card_blocked', 'Geblokkeerd');
        if (g.status === 'expired' || (g.expires_at && Date.parse(g.expires_at) <= Date.now())) return fail(res, 409, 'gift_card_expired', 'Verlopen');
        if (g.balance_cents <= 0) return fail(res, 409, 'gift_card_empty', 'Leeg');
        if (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0) return fail(res, 400, 'invalid_amount', 'Ongeldig');
        if (body.amount_cents > g.balance_cents) return fail(res, 409, 'insufficient_balance', 'Onvoldoende', { balance_cents: g.balance_cents });
        const tx = redeemRaw(g, body.amount_cents, body.location_id || tok.location || null);
        const bill = body.bill_total_cents;
        const out = { success: true, reference_number: tx.reference_number, gift_card_id: g.id, amount_cents: body.amount_cents, balance_after_cents: g.balance_cents,
          remaining_to_pay_cents: Number.isInteger(bill) && bill > body.amount_cents ? bill - body.amount_cents : null, status: g.status };
        S.idem[body.idempotency_key] = out;
        send(res, 200, out);
      };
      return S.cfg.redeemDelay ? setTimeout(done, S.cfg.redeemDelay) : done();
    }
    if (p === '/api/stamp/gift-cards/report') {
      const from = q.get('from'), to = q.get('to'), loc = q.get('location_id');
      const txs = S.txs.filter(t => t.card_id === card && t.created_at.slice(0, 10) >= from && t.created_at.slice(0, 10) <= to && (!loc || t.location_id === loc || t.type === 'issue'));
      const sum = f => txs.filter(f).reduce((n, t) => n + Math.abs(t.amount_cents), 0);
      const issued = sum(t => t.type === 'issue'), redeemed = sum(t => t.type === 'redeem'), reversed = sum(t => t.type === 'reverse');
      const dayMap = {};
      txs.forEach(t => { const d = t.created_at.slice(0, 10); dayMap[d] = dayMap[d] || { date: d, issued_cents: 0, redeemed_cents: 0, net_redeemed_cents: 0 };
        if (t.type === 'issue') dayMap[d].issued_cents += t.amount_cents; if (t.type === 'redeem') { dayMap[d].redeemed_cents += -t.amount_cents; dayMap[d].net_redeemed_cents += -t.amount_cents; } if (t.type === 'reverse') dayMap[d].net_redeemed_cents -= t.amount_cents; });
      const days = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
      if (q.get('format') === 'csv') { res.writeHead(200, { 'Content-Type': 'text/csv', 'Access-Control-Allow-Origin': '*' }); return res.end('date;issued_cents;redeemed_cents\n' + days.map(d => [d.date, d.issued_cents, d.redeemed_cents].join(';')).join('\n')); }
      return send(res, 200, { success: true, totals: { issued_cents: issued, redeemed_cents: redeemed, reversed_cents: reversed, net_redeemed_cents: redeemed - reversed, outstanding_cents: S.gifts.filter(g => g.card_id === card && g.status === 'active').reduce((n, g) => n + g.balance_cents, 0) }, days, rows: txs });
    }
    if ((m = p.match(/^\/api\/stamp\/gift-cards\/transactions\/([\w-]+)\/reverse$/)) && req.method === 'POST') {
      if (!tok.owner) return fail(res, 403, 'owner_only', 'Alleen eigenaar');
      const tx = S.txs.find(t => t.id === m[1]);
      if (!tx) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
      if (tx.reversed) return fail(res, 409, 'already_reversed', 'Al teruggedraaid');
      const g = S.gifts.find(x => x.id === tx.gift_card_id);
      g.balance_cents += -tx.amount_cents; if (g.status === 'empty') g.status = 'active'; tx.reversed = true;
      S.txs.push({ id: crypto.randomUUID(), gift_card_id: g.id, card_id: g.card_id, type: 'reverse', reverses_transaction_id: tx.id, amount_cents: -tx.amount_cents, balance_after_cents: g.balance_cents, reference_number: ref(), location_id: null, actor: 'owner', note: body.note, created_at: new Date().toISOString() });
      return send(res, 200, { success: true });
    }
    if ((m = p.match(/^\/api\/stamp\/gift-cards\/([\w-]+)\/(adjust|block|unblock)$/)) && req.method === 'POST') {
      if (!tok.owner) return fail(res, 403, 'owner_only', 'Alleen eigenaar');
      const g = S.gifts.find(x => x.id === m[1] && x.card_id === card);
      if (!g) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
      if (m[2] === 'adjust') {
        if (!Number.isInteger(body.delta_cents) || body.delta_cents === 0 || !body.note) return fail(res, 400, 'invalid_amount', 'Ongeldig');
        if (g.balance_cents + body.delta_cents < 0) return fail(res, 409, 'insufficient_balance', 'Onvoldoende', { balance_cents: g.balance_cents });
        g.balance_cents += body.delta_cents; g.status = g.balance_cents === 0 ? 'empty' : (g.status === 'empty' ? 'active' : g.status);
        S.txs.push({ id: crypto.randomUUID(), gift_card_id: g.id, card_id: card, type: 'adjust', amount_cents: body.delta_cents, balance_after_cents: g.balance_cents, reference_number: ref(), actor: 'owner', note: body.note, created_at: new Date().toISOString() });
      } else g.status = m[2] === 'block' ? 'blocked' : (g.balance_cents > 0 ? 'active' : 'empty');
      return send(res, 200, { success: true, gift_card: pub(g) });
    }
    if ((m = p.match(/^\/api\/stamp\/gift-cards\/([\w-]+)$/)) && req.method === 'GET') {
      const g = S.gifts.find(x => x.id === m[1] && x.card_id === card);
      if (!g) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
      return send(res, 200, { success: true, gift_card: pub(g), transactions: S.txs.filter(t => t.gift_card_id === g.id).slice().reverse() });
    }
    return fail(res, 404, 'gift_card_not_found', 'Onbekend');
  }
  return send(res, 200, { success: true });
}
http.createServer((req, res) => {
  const url = new URL(req.url, BASE);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__')) {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { let body = {}; try { body = JSON.parse(b || '{}'); } catch (_) {} api(req, res, url, body, b); }); return;
  }
  const f = path.join(SITE, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  let data = fs.readFileSync(f);
  if (f.endsWith('.html')) data = Buffer.from(data.toString().split("'https://api.omrzdigital.nl'").join("'" + BASE + "'"));
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(f)] || 'application/octet-stream' });
  res.end(data);
}).listen(PORT, () => console.log('nep-API op', BASE));
