// Cadeaubonnen: kleine hulpfuncties zonder DOM, gedeeld door dashboard.html en scan.html.
// Ook te laden in Node (module.exports) zodat ze getest kunnen worden: node --test tests/giftcards.test.js
(function (root) {
  'use strict';

  const NBSP = ' ';

  // Hele centen → "€ 1.234,50" (nl-NL). Ongeldige invoer → "—", nooit een stille 0.
  function formatCents(cents) {
    if (typeof cents !== 'number' || !Number.isInteger(cents)) return '—';
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const rest = String(abs % 100).padStart(2, '0');
    return (neg ? '-' : '') + '€' + NBSP + euros + ',' + rest;
  }

  // Wat iemand intypt → hele centen, of null als het geen geldig positief bedrag is.
  // Accepteert "30", "30,5", "30.50", "€ 30,00" en "1.234,50". Weigert negatief, nul,
  // leeg en meer dan 2 decimalen.
  function parseEuroToCents(input) {
    if (typeof input === 'number') input = String(input);
    if (typeof input !== 'string') return null;
    let s = input.replace(/€|eur(o)?/gi, '').replace(/[\s ]/g, '');
    if (!s || /^-/.test(s) || /[^0-9.,]/.test(s)) return null;

    let whole, frac = '';
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma !== -1 && lastDot !== -1) {
      // Beide aanwezig: de laatste is het decimaalteken, de andere de duizendtallen.
      const dec = lastComma > lastDot ? ',' : '.';
      const thou = dec === ',' ? '.' : ',';
      const [a, b, extra] = s.split(dec);
      if (extra !== undefined) return null;
      if (!/^\d{1,3}(\d{3})*$/.test(a.split(thou).join('')) || !a.split(thou).slice(1).every(g => g.length === 3)) return null;
      whole = a.split(thou).join(''); frac = b;
    } else if (lastComma !== -1 || lastDot !== -1) {
      const sep = lastComma !== -1 ? ',' : '.';
      const parts = s.split(sep);
      // Een losse komma is in het Nederlands altijd het decimaalteken ("30,505" = 3 decimalen,
      // dus ongeldig). Een losse punt is alleen duizendtallen bij precies groepjes van 3.
      if (parts.length === 2 && (sep === ',' || parts[1].length !== 3)) {
        // "30,5" of "30.50": decimaalteken
        whole = parts[0]; frac = parts[1];
      } else if (sep === '.' && parts.slice(1).every(g => g.length === 3) && parts[0].length >= 1 && parts[0].length <= 3) {
        // "1.234" of "1.234.567": duizendtallen
        whole = parts.join('');
      } else {
        return null;
      }
    } else {
      whole = s;
    }
    if (!/^\d+$/.test(whole || '0') || !/^\d{0,2}$/.test(frac)) return null;
    const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    if (!Number.isSafeInteger(cents) || cents <= 0) return null;
    return cents;
  }

  // Korte code: 10 tekens Crockford base32 (zonder I, L, O, U), getoond als XXXX-XXXX-XX.
  // Zelfde regels als de backend: hoofdletters, O → 0, I en L → 1, streepjes en spaties weg.
  // Een U komt in geen echte code voor; dan is het geen korte code. Geeft null als het er
  // geen is.
  function normalizeShortCode(input) {
    const s = String(input == null ? '' : input).toUpperCase().replace(/[\s .\-]/g, '')
      .replace(/O/g, '0').replace(/[IL]/g, '1');
    if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(s)) return null;
    return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
  }

  // Wat de camera las. In elke cadeaubon-QR (Apple- en Google-pas, bonpagina, mail) staat de
  // lange code: 32 hex-tekens. Een stempelkaart-QR is altijd een UUID met streepjes
  // (8-4-4-4-12). Die twee vormen overlappen nooit. Herkend als cadeaubon:
  //  - de lange code (32 hex, hoofd- of kleine letters);
  //  - een link naar /cadeaubon/<code> op een domein van OMRZ (omrzdigital.nl en subdomeinen);
  //  - de korte code, met of zonder streepjes.
  // Al het andere gaat ongewijzigd naar de stempelflow.
  const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const LONG_RX = /^[0-9a-f]{32}$/i;
  function isOurHost(host) {
    const h = String(host || '').toLowerCase();
    return h === 'omrzdigital.nl' || h.endsWith('.omrzdigital.nl');
  }
  // Sinds backend e101948 staat er in de QR van een bon OMRZCB1:<32 hex>. Dat voorvoegsel
  // gebruikt alleen een cadeaubon. Dit is de terugval voor als /scan/resolve niet antwoordt;
  // normaal beslist de backend wat een scan is.
  const GIFT_QR_PREFIX = 'OMRZCB1:';
  function classifyScan(text) {
    let raw = String(text == null ? '' : text).trim();
    if (raw.toUpperCase().startsWith(GIFT_QR_PREFIX)) {
      const rest = raw.slice(GIFT_QR_PREFIX.length).trim();
      if (LONG_RX.test(rest)) return { kind: 'gift', code: rest.toLowerCase() };
      const sc = normalizeShortCode(rest);
      return { kind: 'gift', code: sc || raw };                               // voorvoegsel = altijd een bon
    }
    if (UUID_RX.test(raw)) return { kind: 'stamp', code: raw };                // stempelkaart, altijd eerst
    if (LONG_RX.test(raw)) return { kind: 'gift', code: raw.toLowerCase() };
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        const m = u.pathname.match(/^\/cadeaubon\/([^/]+)\/?$/i);
        if (isOurHost(u.hostname) && m) {
          let code = m[1];
          try { code = decodeURIComponent(code); } catch (_) { /* laat zoals hij is */ }
          if (LONG_RX.test(code)) return { kind: 'gift', code: code.toLowerCase() };
          const sc = normalizeShortCode(code);
          if (sc) return { kind: 'gift', code: sc };
        }
      } catch (_) { /* geen geldige link: verder als gewone tekst */ }
      return { kind: 'stamp', code: raw };
    }
    const short = normalizeShortCode(raw);
    if (short) return { kind: 'gift', code: short };
    return { kind: 'stamp', code: raw };
  }
  // Het antwoord van GET /api/stamp/scan/resolve (backend de7021f), vertaald naar wat een
  // scanner moet doen:
  //   { kind: 'gift', gift_card, can_redeem, blocked_reason, blocked_message }
  //   { kind: 'stamp', holder }                 klant gevonden: verder met /api/stamp/lookup
  //   { kind: 'error', code, message, planLock } nette melding, geen afschrijving
  //   { kind: 'fallback' }                      backend gaf geen bruikbaar antwoord (netwerk,
  //                                             429, 5xx, oude backend zonder route): dan
  //                                             beslist de eigen herkenning, classifyScan.
  // 503 migration_missing is wel een antwoord (de bonnen bestaan nog niet), geen terugval.
  function resolveOutcome(status, data) {
    const d = data || {};
    if (status === 200 && d.success !== false) {
      if (d.kind === 'gift_card' && d.gift_card) {
        const can = d.can_redeem === true;
        const reason = can ? null : (d.blocked_reason || null);
        return { kind: 'gift', gift_card: d.gift_card, can_redeem: can, blocked_reason: reason,
          blocked_message: can ? null : (d.blocked_message || MESSAGES[reason] || MESSAGES.gift_card_unusable) };
      }
      if (d.kind === 'stamp_holder' && d.holder) return { kind: 'stamp', holder: d.holder };
      return { kind: 'fallback' };
    }
    const code = typeof d.code === 'string' ? d.code : '';
    const known = status === 400 || status === 401 || status === 403 || status === 404 || (status === 503 && code === 'migration_missing');
    if (!known || (status === 404 && !code)) return { kind: 'fallback' };    // 404 zonder code: route bestaat nog niet
    const key = code || (status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'unknown_code');
    return { kind: 'error', code: key, message: errorMessage(key, d), planLock: isPlanLock(key) };
  }

  // De keuze Stempelen/Cadeaubon bovenaan de scanner, onthouden per apparaat. Bewust geen
  // stamp_*-sleutel: die wist de scanapp bij uitloggen, en dit is een voorkeur van het
  // apparaat, niet van de sessie. Standaard en bij elke twijfel: stempelen.
  const SCAN_MODE_KEY = 'omrz_scan_mode';
  function readScanMode(storage) {
    try { return storage && storage.getItem(SCAN_MODE_KEY) === 'gift' ? 'gift' : 'stamp'; } catch (_) { return 'stamp'; }
  }
  function saveScanMode(storage, mode) {
    try { if (storage) storage.setItem(SCAN_MODE_KEY, mode === 'gift' ? 'gift' : 'stamp'); } catch (_) { /* privévenster: dan niet onthouden */ }
  }

  // De deellink van een bon: de backend noemt hem url (share_url uit het eerste contract).
  function giftShareUrl(g) { return (g && (g.url || g.share_url)) || ''; }
  // De korte code zoals op de bon: short_code_display, anders zelf opgemaakt.
  function giftShortCodeDisplay(g) {
    if (!g) return '';
    return g.short_code_display || normalizeShortCode(g.short_code) || g.short_code || '';
  }
  // Het resultaat van een afschrijving: de backend zet bedrag, saldo en referentie onder
  // transaction. Nog te betalen rekenen we zelf uit het rekeningbedrag als de backend het
  // niet geeft.
  function redeemResult(data, amountSent, billCents) {
    const d = data || {}, t = d.transaction || {};
    const pick = (a, b) => (Number.isInteger(a) ? a : Number.isInteger(b) ? b : null);
    const amount = pick(t.amount_cents, d.amount_cents);
    const amountAbs = amount === null ? amountSent : Math.abs(amount);
    let balance = pick(t.balance_after_cents, d.balance_after_cents);
    if (balance === null && d.gift_card && Number.isInteger(d.gift_card.balance_cents)) balance = d.gift_card.balance_cents;
    const remaining = Number.isInteger(d.remaining_to_pay_cents) ? d.remaining_to_pay_cents
      : (Number.isInteger(billCents) && billCents > amountAbs ? billCents - amountAbs : null);
    return { amount_cents: amountAbs, balance_after_cents: balance, reference_number: t.reference_number || d.reference_number || null,
      remaining_to_pay_cents: remaining, replayed: d.replayed === true };
  }

  // Eén sleutel per afschrijfpoging: dezelfde poging opnieuw versturen schrijft nooit dubbel af.
  function newIdempotencyKey() {
    const c = root && root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // "2027-03-31" → het einde van die dag in Europe/Amsterdam (23:59:59 lokale tijd) als
  // ISO-tijd in UTC, ongeacht de tijdzone van het apparaat. Ongeldige datum → null.
  const AMS = 'Europe/Amsterdam';
  function amsOffsetMs(utcMs) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: AMS, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
    const v = {}; parts.forEach(p => { v[p.type] = Number(p.value); });
    return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - Math.floor(utcMs / 1000) * 1000;
  }
  function endOfDayAmsterdamISO(dateStr) {
    const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const wall = Date.UTC(y, mo - 1, d, 23, 59, 59);
    const check = new Date(wall);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    // Wandkloktijd min de Amsterdamse afwijking; nogmaals met de afwijking op dat tijdstip (zomertijd-wissel).
    let utc = wall - amsOffsetMs(wall);
    utc = wall - amsOffsetMs(utc);
    return new Date(utc).toISOString();
  }

  // Weergavestatus van een bon, met vaste voorrang: blocked, expired, empty, active.
  // Een verlopen vervaldatum telt als verlopen, een saldo van 0 als leeg, ook als de
  // server (nog) iets anders zegt.
  const STATUS_LABELS = { active: 'Actief', empty: 'Leeg', blocked: 'Geblokkeerd', expired: 'Verlopen' };
  function giftStatus(g, nowMs) {
    if (!g) return 'unknown';
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    if (g.status === 'blocked') return 'blocked';
    const exp = g.expires_at ? Date.parse(g.expires_at) : NaN;
    if (g.status === 'expired' || (!isNaN(exp) && exp <= now)) return 'expired';
    if (g.status === 'empty' || (Number.isInteger(g.balance_cents) && g.balance_cents <= 0)) return 'empty';
    if (g.status === 'active') return 'active';
    return 'unknown';
  }
  // Staat de cadeaubon-scanner aan volgens /gift-cards/settings? De backend antwoordt met
  // gift_cards_scanner_enabled (en available); scanner_enabled uit het oorspronkelijke contract
  // lezen we ook. Alleen een echte true telt.
  function scannerEnabledFrom(data) {
    if (!data || data.success === false) return false;
    return data.gift_cards_scanner_enabled === true || data.scanner_enabled === true;
  }
  // De body voor PUT /gift-cards/settings: precies { card_id, enabled } met een echte boolean.
  function scannerSettingsBody(cardId, enabled) {
    return JSON.stringify({ card_id: cardId, enabled: enabled === true });
  }
  // Referentienummer uit het antwoord van POST /gift-cards. De backend stuurt het als
  // transaction.reference_number; reference_number bovenaan is de terugval (oud contract).
  function referenceFrom(data) {
    const d = data || {};
    return (d.transaction && d.transaction.reference_number) || d.reference_number || null;
  }
  // ---- Nieuwe cadeaubon: koper, ontvanger en verzending ----
  const DELIVERY_MODES = ['recipient', 'buyer', 'none'];
  const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isEmail = v => EMAIL_RX.test(String(v || '').trim());
  // Zelfde regels als de backend, zodat het formulier vooraf de juiste melding geeft.
  // f = { delivery_mode, buyer_email, recipient_email }. Geeft een foutcode of null.
  function validateGiftDelivery(f) {
    const mode = f && f.delivery_mode;
    if (DELIVERY_MODES.indexOf(mode) === -1) return 'invalid_delivery_mode';
    const be = String(f.buyer_email || '').trim(), re = String(f.recipient_email || '').trim();
    if (be && !isEmail(be)) return 'invalid_buyer_email';
    if (re && !isEmail(re)) return 'invalid_recipient_email';
    if (mode === 'recipient' && !re) return 'recipient_email_required';
    if (mode === 'buyer' && !be) return 'buyer_email_required';
    return null;
  }
  // Body voor POST /gift-cards: lege optionele velden laten we weg.
  function giftCreateBody(f) {
    const body = { card_id: f.card_id, amount_cents: f.amount_cents, delivery_mode: f.delivery_mode };
    ['buyer_name', 'buyer_email', 'recipient_name', 'recipient_email', 'message'].forEach(k => {
      const v = String(f[k] == null ? '' : f[k]).trim();
      if (v) body[k] = v;
    });
    if (f.expires_at) body.expires_at = f.expires_at;
    if (f.idempotency_key) body.idempotency_key = f.idempotency_key;
    return body;
  }
  // Body voor POST /gift-cards/:id/resend: { target } en alleen een e-mail als die is ingevuld.
  function resendBody(target, email) {
    const body = { target: target === 'buyer' ? 'buyer' : 'recipient' };
    const e = String(email == null ? '' : email).trim();
    if (e) body.email = e;
    return body;
  }
  // Verzendstatus van een bon per doel: { state: sent|failed|none, at, error }.
  // De backend geeft dit genest: gift_card.mail.pass|buyer = { sent_at, error } en
  // gift_card.mail.last_attempt_at (tijdstip van de laatste poging, ook als die mislukte).
  function mailStateOf(g, target) {
    const m = (g && g.mail) || {};
    const x = (target === 'buyer' ? m.buyer : m.pass) || {};
    const at = x.sent_at || null, err = x.error || null;
    if (err) return { state: 'failed', at: at || m.last_attempt_at || null, error: String(err) };
    if (at) return { state: 'sent', at, error: null };
    return { state: 'none', at: null, error: null };
  }
  // Het e-mailadres uit een mailresultaat. mail.email is het adres; mail.to kan bij opnieuw
  // versturen het doel zijn ("recipient"/"buyer") en telt alleen als het echt een adres is.
  function mailAddress(x) {
    if (!x) return null;
    if (isEmail(x.email)) return String(x.email).trim();
    if (isEmail(x.to)) return String(x.to).trim();
    return null;
  }
  // Mailresultaat na het aanmaken: { pass: {to,email,status,error}, buyer: {email,status,error} }.
  // pass is de mail mét de bon; pass.to zegt naar wie ('recipient' of 'buyer'). Bij 'buyer'
  // gaan bon en aankoopbevestiging in één bericht naar de koper; buyer beschrijft dan
  // hetzelfde bericht en tonen we niet nog eens. Anders is buyer de aankoopbevestiging.
  // Regels: { target, kind: 'pass'|'confirmation', status, to, error }.
  function mailOutcome(mail) {
    const m = mail || {};
    const rows = [];
    const shown = x => x && (x.status === 'sent' || x.status === 'failed');   // skipped: niets te melden
    const p = m.pass, passTarget = p && p.to === 'buyer' ? 'buyer' : 'recipient';
    if (shown(p)) rows.push({ target: passTarget, kind: 'pass', status: p.status, to: mailAddress(p), error: p.error || null });
    if (shown(m.buyer) && !(shown(p) && passTarget === 'buyer')) {
      rows.push({ target: 'buyer', kind: 'confirmation', status: m.buyer.status, to: mailAddress(m.buyer), error: m.buyer.error || null });
    }
    return { rows, failed: rows.some(r => r.status === 'failed') };
  }

  // ---- Ontwerp van de cadeaubon ----
  // De tien ontwerpvelden van GET/PUT /gift-cards/design (backend de7021f), elk { value, inherited }.
  const DESIGN_FIELDS = ['theme', 'pass_color', 'text_color', 'accent_color', 'logo_url', 'background_url',
    'business_name', 'show_name', 'font', 'amount_size'];
  const isHexColor = v => /^#[0-9a-fA-F]{6}$/.test(String(v || ''));
  const isHttpsUrl = v => { try { const u = new URL(String(v)); return u.protocol === 'https:'; } catch (_) { return false; } };
  // Kleuren komen van de backend altijd in kleine letters (#2e5b45). We vergelijken en
  // versturen ze daarom ook zo; andere waarden blijven ongemoeid.
  const COLOR_FIELDS = ['pass_color', 'text_color', 'accent_color'];
  // Geen stempelkaart-waarde om over te nemen (backend: altijd inherited false): nooit null sturen.
  const NO_INHERIT_FIELDS = ['show_name', 'amount_size'];
  function normalizeColor(v) { return isHexColor(v) ? String(v).toLowerCase() : v; }
  function designValue(k, v) { return COLOR_FIELDS.indexOf(k) !== -1 ? normalizeColor(v) : v; }
  // Alleen gewijzigde velden; null = weer overnemen van de stempelkaart.
  // current/original: { veld: { value, inherited } }.
  function designBody(cardId, current, original) {
    const body = { card_id: cardId };
    DESIGN_FIELDS.forEach(k => {
      const c = current[k], o = original[k];
      if (!c || !o) return;                                   // veld onbekend bij deze backend: niet aanraken
      if (k === 'show_name') { if (c.value !== o.value) body[k] = c.value === true; return; }
      if (NO_INHERIT_FIELDS.indexOf(k) !== -1) { if (c.value !== o.value && c.value != null) body[k] = c.value; return; }
      if (c.inherited) { if (!o.inherited) body[k] = null; return; }
      const cv = designValue(k, c.value), ov = designValue(k, o.value);
      if (o.inherited || cv !== ov) body[k] = cv;
    });
    return body;
  }
  // Fout van een ontwerpveld vooraf, of null. options: { themes, fonts, amount_sizes } uit GET /design.
  function validateDesignValue(field, value, options) {
    if (value === null) return null;
    const o = options || {};
    const inList = (list, v) => !Array.isArray(list) || list.some(x => String(x).toLowerCase() === String(v).toLowerCase());
    if (COLOR_FIELDS.indexOf(field) !== -1) return isHexColor(value) ? null : 'invalid_color';
    if (field === 'logo_url' || field === 'background_url') return value === '' || isHttpsUrl(value) ? null : 'invalid_url';
    if (field === 'theme') return inList(o.themes, value) ? null : 'invalid_theme';
    if (field === 'font') return inList(o.fonts, value) ? null : 'invalid_font';
    if (field === 'amount_size') return inList(o.amount_sizes, value) ? null : 'invalid_amount_size';
    if (field === 'show_name') return typeof value === 'boolean' ? null : 'invalid_show_name';
    return null;
  }
  // Leesbaarheid van tekst op de paskleur (WCAG-contrast). < 4,5 verdient een waarschuwing.
  function contrastRatio(a, b) {
    if (!isHexColor(a) || !isHexColor(b)) return null;
    const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return Math.round((x + 0.05) / (y + 0.05) * 100) / 100;
  }

  // Waar een ontwerpveld effect heeft (applies_to uit GET /design): page, mail, apple, google.
  const CHANNELS = ['page', 'mail', 'apple', 'google'];
  const CHANNEL_LABELS = { page: 'Bonpagina', mail: 'E-mail', apple: 'Apple Wallet', google: 'Google Wallet' };
  function channelsOf(appliesTo, field) {
    const list = appliesTo && Array.isArray(appliesTo[field]) ? appliesTo[field] : null;
    return list ? CHANNELS.filter(c => list.indexOf(c) !== -1) : null;
  }

  // Uploads (POST /gift-cards/upload-logo en /upload-background): png, jpg/jpeg of webp, max 5 MB.
  const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
  function validateUpload(file) {
    if (!file) return 'upload_empty';
    const typeOk = UPLOAD_TYPES.indexOf(String(file.type || '').toLowerCase()) !== -1
      || (!file.type && /\.(png|jpe?g|webp)$/i.test(String(file.name || '')));
    if (!typeOk) return 'upload_type';
    if (file.size > UPLOAD_MAX_BYTES) return 'upload_size';
    if (!file.size) return 'upload_empty';
    return null;
  }
  // De backend geeft bij een upload alleen { error } (Engelse multer-tekst of Nederlands);
  // vertaal op status en herkenbare tekst naar een vaste nette melding.
  function uploadErrorMessage(status, data) {
    const e = String((data && data.error) || '');
    if (status === 401) return MESSAGES.unauthorized;
    if (status === 403) return MESSAGES.owner_only;
    if (status === 400) {
      if (/te groot|too large|5\s?mb/i.test(e)) return MESSAGES.upload_size;
      if (/png|jpg|jpeg|webp|afbeelding/i.test(e)) return MESSAGES.upload_type;
      if (/geen bestand|file/i.test(e)) return MESSAGES.upload_empty;
      return MESSAGES.upload_failed;
    }
    return MESSAGES.upload_failed;
  }

  const PLAN_LOCK_CODES = ['premium_plus_required', 'plan_required'];
  const isPlanLock = code => PLAN_LOCK_CODES.indexOf(code) !== -1;

  // Duidelijke Nederlandse melding per foutcode uit het contract.
  const MESSAGES = {
    premium_plus_required: 'Cadeaubonnen zijn onderdeel van Premium Plus.',
    plan_required: 'Cadeaubonnen zijn onderdeel van Premium Plus.',
    migration_missing: 'Cadeaubonnen zijn nog niet ingericht. Neem contact op met support.',
    gift_card_not_found: 'Deze cadeaubon bestaat niet of hoort niet bij deze zaak.',
    gift_card_blocked: 'Deze cadeaubon is geblokkeerd en kan niet worden gebruikt.',
    gift_card_expired: 'Deze cadeaubon is verlopen.',
    gift_card_empty: 'Het saldo van deze cadeaubon is op.',
    insufficient_balance: 'Onvoldoende saldo op deze cadeaubon.',
    invalid_amount: 'Ongeldig bedrag. Vul een bedrag groter dan € 0,00 in, met hooguit 2 decimalen.',
    owner_only: 'Alleen de eigenaar van de zaak kan dit doen.',
    already_reversed: 'Deze afschrijving is al teruggedraaid.',
    rate_limited: 'Te veel pogingen achter elkaar. Wacht even en probeer het opnieuw.',
    unknown_code: 'Deze code hoort niet bij een cadeaubon of een stempelkaart.',
    gift_card_unusable: 'Deze cadeaubon kan nu niet worden afgeschreven.',
    holder_not_found: 'Klant niet gevonden. Deze stempelkaart hoort niet bij deze zaak.',
    wrong_location: 'Deze klant hoort bij een andere vestiging.',
    card_id_required: 'Er is geen stempelkaart actief. Log opnieuw in en probeer het nog eens.',
    code_required: 'Er is geen code gelezen. Scan opnieuw of typ de code in.',
    unauthorized: 'Je sessie is verlopen. Log opnieuw in.',
    forbidden: 'Je hebt geen toegang tot deze stempelkaart.',
    buyer_email_required: 'Vul het e-mailadres van de koper in: bij "Ik stuur hem zelf door" mailen we de link naar de koper.',
    invalid_buyer_email: 'Het e-mailadres van de koper klopt niet.',
    recipient_email_required: 'Vul het e-mailadres van de ontvanger in: bij "Direct naar de ontvanger" mailen we de bon naar de ontvanger.',
    invalid_recipient_email: 'Het e-mailadres van de ontvanger klopt niet.',
    invalid_delivery_mode: 'Kies hoe de cadeaubon verstuurd wordt.',
    resend_too_soon: 'Net al verstuurd. Probeer het over een minuut opnieuw.',
    no_email_for_target: 'Er is geen e-mailadres bekend om naartoe te sturen. Vul een adres in.',
    invalid_target: 'Kies of de mail naar de ontvanger of naar de koper moet.',
    invalid_expires_at: 'De vervaldatum klopt niet of ligt in het verleden. Kies een datum in de toekomst.',
    invalid_color: 'Deze kleur klopt niet. Gebruik een kleurcode zoals #1F4D2B.',
    invalid_url: 'Deze afbeelding moet een https-link uit de eigen opslag van OMRZ zijn.',
    invalid_show_name: 'Kies of de naam wel of niet op de cadeaubon komt.',
    nothing_to_update: 'Er is niets gewijzigd.',
    invalid_theme: 'Kies een van de thema\'s uit de lijst.',
    invalid_font: 'Kies een lettertype uit de lijst.',
    invalid_amount_size: 'Kies klein, normaal of groot.',
    upload_type: 'Dit bestandstype kan niet. Kies een PNG-, JPG- of WebP-afbeelding.',
    upload_size: 'Deze afbeelding is groter dan 5 MB. Kies een kleinere afbeelding.',
    upload_empty: 'Er is geen afbeelding gekozen.',
    upload_failed: 'Uploaden is niet gelukt. Probeer het opnieuw.',
  };
  const NOT_LIVE_MESSAGE = 'Cadeaubonnen zijn nog niet beschikbaar. Probeer het later opnieuw.';

  // Is de backend (nog) niet live? Een route die niet bestaat geeft 404 zonder foutcode;
  // een onbekende bon geeft 404 mét code gift_card_not_found.
  function isNotLive(status, data) {
    return status === 404 && !(data && data.code);
  }

  function errorMessage(code, data) {
    if (code === 'insufficient_balance' && data && Number.isInteger(data.balance_cents)) {
      return 'Onvoldoende saldo. Er staat nog ' + formatCents(data.balance_cents) + ' op deze cadeaubon.';
    }
    if (code === 'resend_too_soon' && data && Number.isFinite(Number(data.retry_after_seconds))) {
      const sec = Math.max(1, Math.ceil(Number(data.retry_after_seconds)));
      return 'Net al verstuurd, probeer over ' + sec + (sec === 1 ? ' seconde.' : ' seconden.');
    }
    if (MESSAGES[code]) return MESSAGES[code];
    return (data && typeof data.error === 'string' && data.error) || 'Er ging iets mis. Probeer het opnieuw.';
  }

  // ===== Rapport (GET /api/stamp/gift-cards/report, backend de7021f) =====
  const REPORT_PRESETS = ['7d', '30d', '90d', 'ytd', 'custom'];
  // De querystring: preset, of bij 'custom' from/to (YYYY-MM-DD). expiring_days alleen als gezet.
  function reportQuery(cardId, sel) {
    const s = sel || {};
    const qs = new URLSearchParams({ card_id: cardId });
    const preset = REPORT_PRESETS.includes(s.preset) ? s.preset : '30d';
    qs.set('preset', preset);
    if (preset === 'custom') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(s.from || '')) qs.set('from', s.from);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s.to || '')) qs.set('to', s.to);
    }
    if (Number.isInteger(s.expiring_days) && s.expiring_days > 0) qs.set('expiring_days', String(s.expiring_days));
    return qs.toString();
  }
  // by_day bevat alleen dagen waarop iets gebeurde; de grafiek wil elke dag van de periode.
  // Rekent op datumsleutels (UTC-middernacht), dus zomer- en wintertijd spelen geen rol.
  const DAY_MS = 86400000;
  function dayKeyToMs(k) { return /^\d{4}-\d{2}-\d{2}$/.test(String(k || '')) ? Date.parse(k + 'T00:00:00Z') : NaN; }
  function fillDays(from, to, byDay) {
    const a = dayKeyToMs(from), b = dayKeyToMs(to);
    if (isNaN(a) || isNaN(b) || b < a) return [];
    const map = new Map((Array.isArray(byDay) ? byDay : []).map(d => [d.day, d]));
    const out = [];
    for (let t = a; t <= b && out.length < 800; t += DAY_MS) {
      const day = new Date(t).toISOString().slice(0, 10);
      const d = map.get(day) || {};
      out.push({ day, issued_cents: d.issued_cents || 0, issued_count: d.issued_count || 0,
        redeemed_cents: d.redeemed_cents || 0, redeemed_count: d.redeemed_count || 0 });
    }
    return out;
  }
  // Naam per vestiging-rij. Afschrijvingen zonder vestiging deed de eigenaar zelf.
  function locationLabel(row) {
    if (!row || !row.location_id) return 'Zonder vestiging (eigenaar)';
    return row.location_name || 'Verwijderde vestiging';
  }
  // Is er iets om te laten zien? Geen enkele bon = de "Zo werkt het"-staat, niet een leeg rapport.
  function reportHasCards(data) {
    const st = (data && Array.isArray(data.by_status)) ? data.by_status : [];
    return st.some(r => (r.count || 0) > 0);
  }
  // De lijst "laatste transacties" komt later in het rapport. Tot de backend de veldnaam
  // bevestigt staat hij hier op één plek; zonder het veld (of als het geen lijst is) geen sectie.
  const REPORT_TX_FIELD = 'recent_transactions';
  function reportRecentTx(data) {
    const v = data && data[REPORT_TX_FIELD];
    return Array.isArray(v) ? v : null;
  }
  // CSV voor de boekhouder: puntkomma en komma-decimalen (Nederlandse Excel), één regel per dag
  // van de periode plus een totaalregel. Bewust zonder btw-kolommen.
  function csvEuro(c) { const n = Number(c) || 0; return (n < 0 ? '-' : '') + (Math.abs(n) / 100).toFixed(2).replace('.', ','); }
  function reportCsv(data) {
    const d = data || {}, r = d.range || {}, t = d.totals || {};
    const days = fillDays(r.from, r.to, d.by_day);
    const lines = [['Datum', 'Uitgegeven (EUR)', 'Aantal uitgegeven', 'Afgeschreven (EUR)', 'Aantal afschrijvingen']];
    days.forEach(x => lines.push([x.day, csvEuro(x.issued_cents), x.issued_count, csvEuro(x.redeemed_cents), x.redeemed_count]));
    lines.push(['Totaal', csvEuro(t.issued_cents), t.issued_count || 0, csvEuro(t.redeemed_cents), t.redeemed_count || 0]);
    return '﻿' + lines.map(l => l.join(';')).join('\r\n') + '\r\n';
  }

  const api = { formatCents, parseEuroToCents, normalizeShortCode, classifyScan, resolveOutcome, SCAN_MODE_KEY, readScanMode, saveScanMode, GIFT_QR_PREFIX, giftShareUrl, giftShortCodeDisplay, redeemResult, newIdempotencyKey, endOfDayAmsterdamISO,
    giftStatus, STATUS_LABELS, isPlanLock, scannerEnabledFrom, referenceFrom, scannerSettingsBody, errorMessage, isNotLive, MESSAGES, NOT_LIVE_MESSAGE,
    DELIVERY_MODES, validateGiftDelivery, giftCreateBody, resendBody, mailStateOf, mailOutcome, mailAddress,
    REPORT_PRESETS, reportQuery, fillDays, locationLabel, reportHasCards, REPORT_TX_FIELD, reportRecentTx, reportCsv,
    DESIGN_FIELDS, NO_INHERIT_FIELDS, designBody, validateDesignValue, contrastRatio, CHANNELS, CHANNEL_LABELS, channelsOf,
    UPLOAD_TYPES, UPLOAD_MAX_BYTES, validateUpload, uploadErrorMessage, isHexColor, isHttpsUrl, normalizeColor, designValue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OMRZGift = api;
})(typeof window !== 'undefined' ? window : globalThis);
