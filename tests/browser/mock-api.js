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
  const tx = { id: crypto.randomUUID(), gift_card_id: g.id, card_id: g.card_id, type: 'redeem', amount_cents: -cents, balance_after_cents: g.balance_cents, reference_number: ref(), location_id: loc || null, actor: 'staff', note: null, created_at: new Date().toISOString() };
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
  expired: !!(g.expires_at && Date.parse(g.expires_at) <= Date.now()), created_at: g.created_at });
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
  let c = String(code || '').trim(); const m = c.match(/\/cadeaubon\/([^/?#]+)/i); if (m) c = m[1];
  if (/^[0-9a-f]{32}$/i.test(c)) return S.gifts.find(g => g.card_id === card && g.code === c.toLowerCase());
  return S.gifts.find(g => g.card_id === card && g.short_code === normShort(c));
};

function api(req, res, url, body, rawBody) {
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
