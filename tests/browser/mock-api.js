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
  S = { gifts: [], txs: [], ref: 400, idem: {}, cfg: { notLive: false, rateLimited: false, redeemDelay: 0, failLookup: false, settingsFail: null, mailFail: null, resendWait: 60 }, settings: {}, design: {}, designVersion: 1, createIdem: {}, log: { redeem: [], create: [], lookup: [], give: [], redeemStamp: [], settingsPut: [], settingsGet: 0, resend: [], designPut: [] }, holders: { 'vip-0000-9a4d-4e6f-b7c2-1d0e5a9f8b34': { name: 'Vaste Gast', stamps: 2, vip: true } } };
  const now = Date.now();
  mk('pp', 5000, { recipient_name: 'Sanne de Vries', message: 'Gefeliciteerd!' }, now - 5 * 864e5, 'ABCD-EFGH-JK', 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  mk('pp', 2500, { recipient_name: 'Daan' }, now - 3 * 864e5, 'BZKD-0000-01', 'b1000000000000000000000000000001').status = 'blocked';
  const e = mk('pp', 1000, {}, now - 2 * 864e5, 'EMPT-0000-02', 'c2000000000000000000000000000002'); redeemRaw(e, 1000, 'L1');
  mk('pp', 3000, { recipient_name: 'Verlopen Vera', expires_at: new Date(now - 864e5).toISOString() }, now - 40 * 864e5, 'EXPR-0000-03', 'e3000000000000000000000000000003').status = 'expired';
  mk('basic', 2000, { recipient_name: 'Basic klant' }, now, 'BASC-0000-04', 'ba500000000000000000000000000004');
  // Staat nog op 'active' maar de vervaldatum is voorbij: moet als Verlopen getoond worden.
  mk('pp', 1500, { recipient_name: 'Peter Verstreken', expires_at: new Date(now - 3600e3).toISOString() }, now - 20 * 864e5, 'PAST-0000-05', 'f5000000000000000000000000000005');
  mk('pptrial', 2000, { recipient_name: 'Proefklant' }, now, 'PREV-0000-06', 'd6000000000000000000000000000006');
}
const ref = () => 'CB-' + String(++S.ref).padStart(4, '0');
function mk(card, cents, extra, t, short, code) {
  const g = { id: crypto.randomUUID(), card_id: card, code: code || crypto.randomBytes(16).toString('hex'),
    short_code: (short || Array.from(crypto.randomBytes(10), b => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b % 32]).join('')).replace(/-/g, ''),
    initial_amount_cents: cents, balance_cents: cents, status: 'active', recipient_name: null, recipient_email: null, message: null, expires_at: null, created_at: new Date(t || Date.now()).toISOString(),
    buyer_name: null, buyer_email: null, delivery_mode: 'none', pass_mail_sent_at: null, pass_mail_error: null, buyer_mail_sent_at: null, buyer_mail_error: null, ...extra };
  S.gifts.push(g);
  S.txs.push({ id: crypto.randomUUID(), gift_card_id: g.id, card_id: card, type: 'issue', amount_cents: cents, balance_after_cents: cents, reference_number: ref(), location_id: null, actor: 'owner', note: null, created_at: g.created_at });
  return g;
}
function redeemRaw(g, cents, loc) {
  g.balance_cents -= cents; if (g.balance_cents === 0) g.status = 'empty';
  const tx = { id: crypto.randomUUID(), gift_card_id: g.id, card_id: g.card_id, type: 'redeem', amount_cents: cents, balance_after_cents: g.balance_cents, reference_number: ref(), location_id: loc || null, actor: 'staff', note: null, created_at: new Date().toISOString() };
  S.txs.push(tx); return tx;
}
// Stempelkaart-waarden waar het ontwerp van de cadeaubon op terugvalt.
const CARD_DESIGN = { pass_color: '#1f4d2b', text_color: '#ffffff', logo_url: 'https://omrzdigital.nl/images/logo.png', background_url: null, business_name: 'Loris Parfum', show_name: true };
function designOf(card) {
  const own = S.design[card] || {};
  const out = {};
  Object.keys(CARD_DESIGN).forEach(k => { out[k] = k in own ? { value: own[k], inherited: false } : { value: CARD_DESIGN[k], inherited: true }; });
  out.show_name = { value: 'show_name' in own ? own.show_name : true, inherited: false };   // backend: eigen kolom, nooit overgenomen
  return out;
}
// Mail versturen (nep): mislukt als cfg.mailFail dat doel noemt.
function sendMail(g, target) {
  const pre = target === 'buyer' ? 'buyer_mail_' : 'pass_mail_';
  const to = target === 'buyer' ? g.buyer_email : g.recipient_email;
  const now = new Date().toISOString();
  g.last_mail_attempt_at = now;
  if (S.cfg.mailFail === target || S.cfg.mailFail === 'all') { g[pre + 'error'] = 'Mailserver weigerde het adres'; g[pre + 'sent_at'] = null; g[pre + 'tried_ms'] = Date.now(); return { to, status: 'failed', error: g[pre + 'error'] }; }
  g[pre + 'sent_at'] = now; g[pre + 'error'] = null; g[pre + 'tried_ms'] = Date.now();
  return { to, status: 'sent', error: null };
}
reset();
// Publieke vorm van de bon, zoals de backend: verzendstatus genest onder mail.
// Korte code zoals de backend: Crockford, opgeslagen zonder streepjes.
const normShort = v => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
const fmtShort = c => c.length === 10 ? c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8) : c;
// Zonder code en url, zoals giftCardPublic(bon) bij de lookup.
const lookupPub = g => ({ id: g.id, card_id: g.card_id, short_code: g.short_code, short_code_display: fmtShort(g.short_code), initial_amount_cents: g.initial_amount_cents,
  balance_cents: g.balance_cents, status: g.status, recipient_name: g.recipient_name, recipient_email: g.recipient_email, message: g.message, expires_at: g.expires_at,
  expired: !!(g.expires_at && Date.parse(g.expires_at) <= Date.now()), created_at: g.created_at, updated_at: g.updated_at || g.created_at || null });
const pub = g => {
  const { card_id, pass_mail_tried_ms, buyer_mail_tried_ms, pass_mail_sent_at, pass_mail_error, buyer_mail_sent_at, buyer_mail_error, last_mail_attempt_at, ...r } = g;
  r.short_code_display = fmtShort(g.short_code);
  r.url = 'https://api.omrzdigital.nl/cadeaubon/' + g.code;                   // backend: url, niet share_url
  r.mail = { pass: { sent_at: pass_mail_sent_at || null, error: pass_mail_error || null },
    buyer: { sent_at: buyer_mail_sent_at || null, error: buyer_mail_error || null }, last_attempt_at: last_mail_attempt_at || null };
  return r;
};
const send = (res, st, obj) => { res.writeHead(st, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(JSON.stringify(obj)); };
const fail = (res, st, code, error, extra) => send(res, st, { success: false, code, error, ...(extra || {}) });
const findCode = (card, code) => {
  let c = String(code || '').trim();
  if (c.toUpperCase().startsWith('OMRZCB1:')) c = c.slice(8).trim();          // QR-voorvoegsel (backend e101948)
  const m = c.match(/\/cadeaubon\/([^/?#]+)/i); if (m) c = m[1];
  if (/^[0-9a-f]{32}$/i.test(c)) return S.gifts.find(g => g.card_id === card && g.code === c.toLowerCase());
  return S.gifts.find(g => g.card_id === card && g.short_code === normShort(c));
};

async function api(req, res, url, body, rawBody) {
  const p = url.pathname, q = url.searchParams; let m;
  const tok = tokens[(req.headers.authorization || '').replace('Bearer ', '')];
  if (p === '/__reset') { reset(); return send(res, 200, {}); }
  if (p === '/__cfg') { Object.assign(S.cfg, body); return send(res, 200, S.cfg); }
  if (p === '/__state') return send(res, 200, S);
  if (p === '/__preview') {
    const d = designOf(q.get('card') || 'pp');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:sans-serif;background:${d.pass_color.value};color:${d.text_color.value}">
      <div id="pv" data-version="${q.get('v')}" style="padding:24px"><h2>${d.show_name.value ? d.business_name.value : ''}</h2><p>Cadeaubon € 25,00</p></div></body>`);
  }
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

  // GET /api/stamp/scan/resolve, zoals ai-review-bot de7021f.
  if (p === '/api/stamp/scan/resolve') {
    S.log.resolve = (S.log.resolve || 0) + 1;
    const f = S.cfg.notLive ? 404 : S.cfg.resolveFail;                          // backend niet live: route bestaat niet
    if (S.cfg.rateLimited) return fail(res, 429, 'rate_limited', 'Te veel verzoeken');   // zelfde limiter als de cadeaubon-routes
    if (f === 404) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('Cannot GET'); }
    if (f === 500) return send(res, 500, { error: 'boem' });
    if (f === 503) return send(res, 503, { error: 'Service Unavailable' });
    if (f === 'migration') return fail(res, 503, 'migration_missing', 'De cadeaubonnen staan nog niet in de database. Draai migratie 038_gift_cards.sql.');
    if (f === 'net') return req.socket.destroy();
    if (!tok) return send(res, 401, { error: 'Niet geautoriseerd' });
    const cardId = q.get('card_id'), code = q.get('code');
    if (!cardId) return fail(res, 400, 'card_id_required', 'card_id is verplicht');
    if (!code) return fail(res, 400, 'code_required', 'code is verplicht');
    let v = String(code).trim();
    if (v.toUpperCase().startsWith('OMRZCB1:')) v = v.slice(8).trim();
    if (/^https?:\/\//i.test(v)) { try { const d = new URL(v).pathname.split('/').filter(Boolean); v = d.length ? d[d.length - 1] : ''; } catch (_) { v = ''; } }
    const isGift = /^[0-9a-f]{32}$/i.test(v) || normShort(v).length === 10 && /^[0-9A-HJKMNP-TV-Z]{10}$/.test(normShort(v));
    if (isGift && !/^[0-9a-f]{8}-/i.test(v)) {
      if (tok.plan !== 'premium_plus') return fail(res, 403, 'premium_plus_required', 'Cadeaubonnen horen bij Premium Plus.');
      const g = findCode(cardId, code);
      if (!g) return send(res, 404, { error: 'Deze cadeaubon bestaat niet.', code: 'gift_card_not_found', kind: 'gift_card' });
      const blk = g.status === 'blocked' ? 'gift_card_blocked' : (g.status === 'expired' || (g.expires_at && Date.parse(g.expires_at) <= Date.now())) ? 'gift_card_expired' : g.balance_cents <= 0 ? 'gift_card_empty' : null;
      const BLK_TEXT = { gift_card_blocked: 'Deze cadeaubon is geblokkeerd.', gift_card_expired: 'Deze cadeaubon is verlopen.', gift_card_empty: 'Deze cadeaubon is leeg.' };
      return send(res, 200, { success: true, kind: 'gift_card', gift_card: lookupPub(g), can_redeem: !blk, blocked_reason: blk, blocked_message: blk ? BLK_TEXT[blk] : null });
    }
    // Stempeltak: elke code wordt als klantcode geprobeerd (in deze nep-API: elke UUID is een klant,
    // behalve 00000000-… (bestaat niet) en 11111111-… (andere vestiging, voor een manager)).
    if (/^00000000-/.test(v)) return send(res, 404, { error: 'Deze klant hoort niet bij deze stempelkaart.', code: 'holder_not_found', kind: 'stamp_holder' });
    if (/^11111111-/.test(v) && !tok.owner) return send(res, 403, { error: 'Deze klant hoort niet bij jouw vestiging', code: 'wrong_location' });
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || /^vip-/.test(v) || /^QR-/.test(v)) {
      return send(res, 200, { success: true, kind: 'stamp_holder', holder: { id: crypto.randomUUID(), customer_qr_code: v, first_name: 'Stempel', last_name: 'Klant' },
        lookup_url: '/api/stamp/lookup?card_id=' + encodeURIComponent(cardId) + '&customer_qr_code=' + encodeURIComponent(v) });
    }
    return send(res, 404, { error: 'Deze code hoort niet bij een cadeaubon of een stempelkaart.', code: 'unknown_code', kind: 'unknown' });
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
      S.log.create.push(body);
      if (body.idempotency_key && S.createIdem[body.idempotency_key]) return send(res, 201, S.createIdem[body.idempotency_key]);
      if (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0) return fail(res, 400, 'invalid_amount', 'Ongeldig bedrag');
      if (body.expires_at && !(Date.parse(body.expires_at) > Date.now())) return fail(res, 400, 'invalid_expires_at', 'De vervaldatum ligt in het verleden.');
      const mode = body.delivery_mode === undefined ? 'none' : body.delivery_mode;
      const okMail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      if (!['recipient', 'buyer', 'none'].includes(mode)) return fail(res, 400, 'invalid_delivery_mode', 'Ongeldige verzending');
      if (body.buyer_email && !okMail(body.buyer_email)) return fail(res, 400, 'invalid_buyer_email', 'Ongeldig e-mailadres koper');
      if (body.recipient_email && !okMail(body.recipient_email)) return fail(res, 400, 'invalid_recipient_email', 'Ongeldig e-mailadres ontvanger');
      if (mode === 'recipient' && !body.recipient_email) return fail(res, 400, 'recipient_email_required', 'E-mail ontvanger vereist');
      if (mode === 'buyer' && !body.buyer_email) return fail(res, 400, 'buyer_email_required', 'E-mail koper vereist');
      const g = mk(card, body.amount_cents, { recipient_name: body.recipient_name || null, message: body.message || null, recipient_email: body.recipient_email || null,
        buyer_name: body.buyer_name || null, buyer_email: body.buyer_email || null, delivery_mode: mode, expires_at: body.expires_at || null });
      // Zoals de backend (sendGiftCardMails): pass = de mail met de bon (pass.to = doel,
      // pass.email = adres). Bij 'buyer' één bericht naar de koper, en beide kolommen gezet.
      const mail = { pass: { to: null, email: null, status: 'skipped', error: null }, buyer: { email: null, status: 'skipped', error: null } };
      if (mode === 'recipient') { const r = sendMail(g, 'recipient'); mail.pass = { to: 'recipient', email: r.to, status: r.status, error: r.error }; }
      if (mode === 'buyer') {
        const r = sendMail(g, 'buyer');
        mail.pass = { to: 'buyer', email: r.to, status: r.status, error: r.error };
        mail.buyer = { email: r.to, status: r.status, error: r.error };
        g.pass_mail_sent_at = g.buyer_mail_sent_at; g.pass_mail_error = g.buyer_mail_error;
      }
      if (g.buyer_email && mode !== 'buyer') { const r = sendMail(g, 'buyer'); mail.buyer = { email: r.to, status: r.status, error: r.error }; }
      // Zelfde vorm als de backend: het referentienummer zit in transaction.
      const tx = S.txs[S.txs.length - 1];
      const out = { success: true, gift_card: pub(g), transaction: { id: tx.id, reference_number: tx.reference_number }, mail };
      if (body.idempotency_key) S.createIdem[body.idempotency_key] = out;
      return send(res, 201, out);
    }
    if ((m = p.match(/^\/api\/stamp\/gift-cards\/([\w-]+)\/resend$/)) && req.method === 'POST') {
      if (!tok.owner) return fail(res, 403, 'owner_only', 'Alleen eigenaar');
      const g = S.gifts.find(x => x.id === m[1] && x.card_id === card);
      if (!g) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
      S.log.resend.push(body);
      if (g.status === 'blocked') return fail(res, 409, 'gift_card_blocked', 'Geblokkeerd');
      const target = body.target === 'buyer' ? 'buyer' : body.target === 'recipient' ? 'recipient' : null;
      if (!target) return fail(res, 400, 'invalid_target', 'target moet "recipient" of "buyer" zijn');
      const key = target === 'buyer' ? 'buyer_email' : 'recipient_email';
      if (body.email) g[key] = body.email;
      if (!g[key]) return fail(res, 400, 'no_email_for_target', 'Geen e-mailadres');
      const last = g[(target === 'buyer' ? 'buyer_mail_' : 'pass_mail_') + 'tried_ms'];
      if (last && Date.now() - last < S.cfg.resendWait * 1000) {
        return fail(res, 429, 'resend_too_soon', 'Te snel', { retry_after_seconds: Math.ceil((S.cfg.resendWait * 1000 - (Date.now() - last)) / 1000) });
      }
      const r = sendMail(g, target);
      // Zoals de backend: mail.to is het doel, mail.email het adres.
      return send(res, 200, { success: true, mail: { status: r.status, to: target, email: r.to, error: r.error }, gift_card: pub(g) });
    }
    if (p === '/api/stamp/gift-cards/design') {
      if (S.cfg.designFail === 404) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('Cannot ' + req.method); }
      if (S.cfg.designFail === 503) return fail(res, 503, 'migration_missing', 'Draai migratie');
      if (S.cfg.designFail === 'net') return req.socket.destroy();
      // Zoals ai-review-bot 2222342: velden onder design, vaste ondertekende preview_url.
      const previewUrl = BASE + '/__preview?card=' + card + '&token=t-' + card;
      if (req.method === 'GET') return send(res, 200, { success: true, card_id: card, design: designOf(card), preview_url: previewUrl });
      if (req.method === 'PUT') {
        if (!tok.owner) return fail(res, 403, 'owner_only', 'Alleen eigenaar');
        S.log.designPut.push(body);
        const own = Object.assign({}, S.design[card] || {});
        let touched = false;
        for (const k of ['pass_color', 'text_color']) {
          if (body[k] === undefined) continue; touched = true;
          if (body[k] === null || body[k] === '') { delete own[k]; continue; }
          if (!/^#[0-9a-fA-F]{6}$/.test(body[k])) return send(res, 400, { error: 'Dit is geen geldige kleurcode.', code: 'invalid_color', field: k });
          own[k] = body[k].toLowerCase();
        }
        for (const k of ['logo_url', 'background_url']) {
          if (body[k] === undefined) continue; touched = true;
          if (body[k] === null || body[k] === '') { delete own[k]; continue; }
          let okHost = false; try { const u = new URL(body[k]); okHost = u.protocol === 'https:' && u.hostname.endsWith('.supabase.co'); } catch (_) {}
          if (!okHost) return send(res, 400, { error: 'Deze afbeelding moet via https van onze eigen opslag komen (.supabase.co).', code: 'invalid_url', field: k });
          own[k] = body[k];
        }
        if (body.business_name !== undefined) { touched = true; const n = body.business_name === null ? '' : String(body.business_name).trim().slice(0, 60); if (n) own.business_name = n; else delete own.business_name; }
        if (body.show_name !== undefined) {
          touched = true;
          if (typeof body.show_name !== 'boolean') return send(res, 400, { error: 'show_name moet true of false zijn.', code: 'invalid_show_name', field: 'show_name' });
          own.show_name = body.show_name;
        }
        if (!touched) return send(res, 400, { error: 'Er is niets om op te slaan.', code: 'nothing_to_update' });
        S.design[card] = own;
        return send(res, 200, { success: true, card_id: card, design: designOf(card), preview_url: previewUrl });
      }
    }
    if (p === '/api/stamp/gift-cards' && req.method === 'GET') {
      let list = S.gifts.filter(g => g.card_id === card).sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (q.get('status')) list = list.filter(g => g.status === q.get('status'));
      if (q.get('q')) { const t = q.get('q').toLowerCase(); list = list.filter(g => (g.recipient_name || '').toLowerCase().includes(t) || g.short_code.toLowerCase().includes(normShort(t).toLowerCase())); }
      const all = S.gifts.filter(g => g.card_id === card && g.status === 'active');
      const off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || 50);
      return send(res, 200, { success: true, gift_cards: list.slice(off, off + lim).map(pub), total: list.length, totals: { outstanding_cents: all.reduce((n, g) => n + g.balance_cents, 0), active_count: all.length } });
    }
    if (p === '/api/stamp/gift-cards/lookup') {
      S.log.lookup.push(q.get('code'));
      if (!q.get('card_id')) return fail(res, 400, 'card_id_required', 'card_id is verplicht');
      if (!q.get('code')) return fail(res, 400, 'code_required', 'code is verplicht');
      const g = findCode(card, q.get('code'));
      if (!g) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
      const blk = g.status === 'blocked' ? 'gift_card_blocked' : (g.status === 'expired' || (g.expires_at && Date.parse(g.expires_at) <= Date.now())) ? 'gift_card_expired' : g.balance_cents <= 0 ? 'gift_card_empty' : null;
      return send(res, 200, { success: true, gift_card: lookupPub(g), can_redeem: !blk, blocked_reason: blk, blocked_message: blk ? 'Niet bruikbaar' : null });
    }
    if (p === '/api/stamp/gift-cards/redeem' && req.method === 'POST') {
      S.log.redeem.push({ ...body, auth: tok.owner ? 'owner' : 'mgr' });
      const done = () => {
        if (S.idem[body.idempotency_key]) return send(res, 200, { ...S.idem[body.idempotency_key], replayed: true });
        let g;
        if (body.gift_card_id) g = S.gifts.find(x => x.id === body.gift_card_id && x.card_id === card);
        else if (body.code) {
          if (!body.card_id) return fail(res, 400, 'card_id_required', 'card_id is verplicht bij een code');   // zoals de backend
          g = findCode(body.card_id, body.code);
        } else return fail(res, 400, 'code_required', 'code of gift_card_id is verplicht');
        if (!g) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
        if (g.status === 'blocked') return fail(res, 409, 'gift_card_blocked', 'Geblokkeerd');
        if (g.status === 'expired' || (g.expires_at && Date.parse(g.expires_at) <= Date.now())) return fail(res, 409, 'gift_card_expired', 'Verlopen');
        if (g.balance_cents <= 0) return fail(res, 409, 'gift_card_empty', 'Leeg');
        if (!Number.isInteger(body.amount_cents) || body.amount_cents <= 0) return fail(res, 400, 'invalid_amount', 'Ongeldig');
        if (body.amount_cents > g.balance_cents) return fail(res, 409, 'insufficient_balance', 'Onvoldoende', { balance_cents: g.balance_cents });
        const tx = redeemRaw(g, body.amount_cents, body.location_id || tok.location || null);
        // Zoals de backend: bedrag, saldo en referentie onder transaction; geen remaining_to_pay_cents.
        const out = { success: true, replayed: false, transaction: { id: tx.id, reference_number: tx.reference_number, amount_cents: body.amount_cents, balance_after_cents: g.balance_cents }, gift_card: pub(g) };
        S.idem[body.idempotency_key] = out;
        send(res, 200, out);
      };
      return S.cfg.redeemDelay ? setTimeout(done, S.cfg.redeemDelay) : done();
    }
    // GET /report, zoals ai-review-bot de7021f (eigenaar). Bedragen in het kasboek zijn altijd
    // positief; de richting zit in type. Dagen in Amsterdamse tijd.
    if (p === '/api/stamp/gift-cards/report') {
      if (!tok.owner) return fail(res, 403, 'owner_only', 'Alleen de eigenaar');
      if (S.cfg.reportFail === 'migration') return fail(res, 503, 'migration_missing', 'Draai migratie 038_gift_cards.sql.');
      if (S.cfg.reportFail === 500) return send(res, 500, { error: 'boem' });
      if (S.cfg.reportDelay) await new Promise(r => setTimeout(r, S.cfg.reportDelay));
      S.log.report = (S.log.report || []).concat([Object.fromEntries(q)]);
      const dayKey = v => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
      const shift = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
      const dk = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
      const today = dayKey(Date.now()), fq = dk(q.get('from')), tq = dk(q.get('to'));
      let preset = ['7d', '30d', '90d', 'ytd', 'custom'].includes(q.get('preset')) ? q.get('preset') : null;
      if (fq || tq) preset = 'custom';
      if (!preset) preset = '30d';
      let from, to;
      if (preset === 'custom') { from = fq; to = tq || (fq && fq > today ? fq : today); }
      else if (preset === 'ytd') { from = today.slice(0, 4) + '-01-01'; to = today; }
      else { from = shift(today, -({ '7d': 7, '30d': 30, '90d': 90 }[preset] - 1)); to = today; }
      if (fq && tq && from > to) { const h = from; from = to; to = h; }
      const days = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 : null;
      const expDays = Math.min(Math.max(Number(q.get('expiring_days')) || 30, 1), 365);
      const bonnen = S.gifts.filter(g => g.card_id === card);
      const per = S.txs.filter(t => t.card_id === card).filter(t => { const d = dayKey(t.created_at); return (!from || d >= from) && (!to || d <= to); });
      const som = ty => per.filter(t => t.type === ty).reduce((n, t) => n + (t.amount_cents || 0), 0);
      const cnt = ty => per.filter(t => t.type === ty).length;
      const stOf = g => g.status === 'blocked' ? 'blocked' : (g.status === 'expired' || (g.expires_at && Date.parse(g.expires_at) <= Date.now())) ? 'expired' : (g.balance_cents <= 0 ? 'empty' : 'active');
      const ps = { active: [], empty: [], blocked: [], expired: [] }; bonnen.forEach(g => ps[stOf(g)].push(g));
      const bal = l => l.reduce((n, g) => n + g.balance_cents, 0);
      const soon = ps.active.filter(g => g.expires_at && Date.parse(g.expires_at) > Date.now() && Date.parse(g.expires_at) <= Date.now() + expDays * 864e5);
      const dm = new Map();
      per.forEach(t => { const d = dayKey(t.created_at); if (!dm.has(d)) dm.set(d, { day: d, issued_cents: 0, issued_count: 0, redeemed_cents: 0, redeemed_count: 0 });
        const r = dm.get(d); if (t.type === 'issue') { r.issued_cents += t.amount_cents; r.issued_count++; } if (t.type === 'redeem') { r.redeemed_cents += t.amount_cents; r.redeemed_count++; } });
      const LOCS = { L1: 'Centrum', L2: 'Noord' };
      const lm = new Map();
      per.filter(t => t.type === 'redeem').forEach(t => { const k = t.location_id || '__geen__';
        if (!lm.has(k)) lm.set(k, { location_id: t.location_id || null, location_name: t.location_id ? (LOCS[t.location_id] || null) : null, redeemed_cents: 0, redeemed_count: 0 });
        const r = lm.get(k); r.redeemed_cents += t.amount_cents; r.redeemed_count++; });
      const issued = som('issue'), issuedN = cnt('issue');
      const out = { success: true, card_id: card, timezone: 'Europe/Amsterdam', generated_at: new Date().toISOString(), range: { preset, from, to, days },
        totals: { issued_cents: issued, issued_count: issuedN, redeemed_cents: som('redeem'), redeemed_count: cnt('redeem'), reversed_cents: som('reverse'), reversed_count: cnt('reverse'),
          adjusted_cents: som('adjust'), adjusted_count: cnt('adjust'), net_redeemed_cents: som('redeem') - som('reverse'),
          outstanding_cents: bal(ps.active), outstanding_count: ps.active.length, average_issued_cents: issuedN ? Math.round(issued / issuedN) : 0,
          expiring_soon_cents: bal(soon), expiring_soon_count: soon.length, expiring_soon_days: expDays },
        by_status: ['active', 'empty', 'blocked', 'expired'].map(st => ({ status: st, count: ps[st].length, balance_cents: bal(ps[st]) })),
        by_day: [...dm.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
        by_location: [...lm.values()].sort((a, b) => b.redeemed_cents - a.redeemed_cents) };
      // Nog niet in de backend: de lijst "laatste transacties". Alleen met cfg.reportTx, onder de
      // voorlopige naam uit js/giftcards.js (REPORT_TX_FIELD), in de vorm van giftTransactionPublic.
      if (S.cfg.reportTxBad) out.recent_transactions = 'niet-een-lijst';
      if (S.cfg.reportTx) out[S.cfg.reportTxField || 'recent_transactions'] = S.txs.filter(t => t.card_id === card).slice(-10).reverse()
        .map(t => ({ id: t.id, gift_card_id: t.gift_card_id, type: t.type, amount_cents: t.amount_cents, balance_after_cents: t.balance_after_cents, reference_number: t.reference_number,
          bill_total_cents: null, location_id: t.location_id || null, actor: t.actor || null, note: t.note || null, reverses_transaction_id: t.reverses_transaction_id || null, created_at: t.created_at }));
      return send(res, 200, out);
    }
    if ((m = p.match(/^\/api\/stamp\/gift-cards\/transactions\/([\w-]+)\/reverse$/)) && req.method === 'POST') {
      if (!tok.owner) return fail(res, 403, 'owner_only', 'Alleen eigenaar');
      const tx = S.txs.find(t => t.id === m[1]);
      if (!tx) return fail(res, 404, 'gift_card_not_found', 'Niet gevonden');
      if (tx.reversed) return fail(res, 409, 'already_reversed', 'Al teruggedraaid');
      const g = S.gifts.find(x => x.id === tx.gift_card_id);
      g.balance_cents += tx.amount_cents; if (g.status === 'empty') g.status = 'active'; tx.reversed = true;
      S.txs.push({ id: crypto.randomUUID(), gift_card_id: g.id, card_id: g.card_id, type: 'reverse', reverses_transaction_id: tx.id, amount_cents: tx.amount_cents, balance_after_cents: g.balance_cents, reference_number: ref(), location_id: null, actor: 'owner', note: body.note, created_at: new Date().toISOString() });
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
        S.txs.push({ id: crypto.randomUUID(), gift_card_id: g.id, card_id: card, type: 'adjust', amount_cents: Math.abs(body.delta_cents), balance_after_cents: g.balance_cents, reference_number: ref(), actor: 'owner', note: body.note, created_at: new Date().toISOString() });
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
    let b = ''; req.on('data', c => b += c); req.on('end', () => { let body = {}; try { body = JSON.parse(b || '{}'); } catch (_) {} Promise.resolve(api(req, res, url, body, b)).catch(e => { console.error(e); send(res, 500, { error: String(e) }); }); }); return;
  }
  const f = path.join(SITE, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!f.startsWith(SITE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  let data = fs.readFileSync(f);
  if (f.endsWith('.html')) data = Buffer.from(data.toString().split("'https://api.omrzdigital.nl'").join("'" + BASE + "'"));
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(f)] || 'application/octet-stream' });
  res.end(data);
}).listen(PORT, () => console.log('nep-API op', BASE));
