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

  // Korte code "ABCD-EFGH-JK" in een vaste vorm, of null als het er geen is.
  const SHORT_RX = /^([A-Z0-9]{4})-?([A-Z0-9]{4})-?([A-Z0-9]{2})$/;
  function normalizeShortCode(input) {
    const s = String(input == null ? '' : input).toUpperCase().replace(/[\s ]/g, '');
    const m = s.match(SHORT_RX);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }

  // Wat de camera las: een cadeaubon (link met /cadeaubon/ of een korte code) of iets
  // anders, dat dan naar de bestaande stempelflow gaat. Stempelkaart-QR's zijn UUID's en
  // vallen dus nooit onder de korte code.
  function classifyScan(text) {
    const raw = String(text == null ? '' : text).trim();
    const m = raw.match(/\/cadeaubon\/([^/?#\s]+)/i);
    if (m) {
      let code = m[1];
      try { code = decodeURIComponent(code); } catch (_) { /* laat zoals hij is */ }
      return { kind: 'gift', code: code };
    }
    const short = normalizeShortCode(raw);
    if (short) return { kind: 'gift', code: short };
    return { kind: 'stamp', code: raw };
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
  // Mailresultaat na het aanmaken: { pass: {to,status,error}, buyer: {status,error} }.
  // Geeft de regels die het tonen waard zijn (sent/failed) en of er iets misging.
  function mailOutcome(mail) {
    const m = mail || {};
    const rows = [];
    [['recipient', m.pass], ['buyer', m.buyer]].forEach(([target, x]) => {
      if (!x || (x.status !== 'sent' && x.status !== 'failed')) return;   // skipped of onbekend: niets te melden
      rows.push({ target, status: x.status, to: mailAddress(x), error: x.error || null });
    });
    return { rows, failed: rows.some(r => r.status === 'failed') };
  }

  // ---- Ontwerp van de cadeaubon ----
  const DESIGN_FIELDS = ['pass_color', 'text_color', 'logo_url', 'background_url', 'business_name', 'show_name'];
  const isHexColor = v => /^#[0-9a-fA-F]{6}$/.test(String(v || ''));
  const isHttpsUrl = v => { try { const u = new URL(String(v)); return u.protocol === 'https:'; } catch (_) { return false; } };
  // Alleen gewijzigde velden; null = weer overnemen van de stempelkaart.
  // current/original: { veld: { value, inherited } }.
  function designBody(cardId, current, original) {
    const body = { card_id: cardId };
    DESIGN_FIELDS.forEach(k => {
      const c = current[k] || {}, o = original[k] || {};
      if (c.inherited) { if (!o.inherited) body[k] = null; return; }
      if (o.inherited || c.value !== o.value) body[k] = c.value;
    });
    return body;
  }
  // Fout van een ontwerpveld vooraf: invalid_color, invalid_url of null.
  function validateDesignValue(field, value) {
    if (value === null) return null;
    if (field === 'pass_color' || field === 'text_color') return isHexColor(value) ? null : 'invalid_color';
    if (field === 'logo_url' || field === 'background_url') return value === '' || isHttpsUrl(value) ? null : 'invalid_url';
    return null;
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
    invalid_url: 'Deze link klopt niet. Gebruik een volledige link die begint met https://.',
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

  const api = { formatCents, parseEuroToCents, normalizeShortCode, classifyScan, newIdempotencyKey, endOfDayAmsterdamISO,
    giftStatus, STATUS_LABELS, isPlanLock, scannerEnabledFrom, referenceFrom, scannerSettingsBody, errorMessage, isNotLive, MESSAGES, NOT_LIVE_MESSAGE,
    DELIVERY_MODES, validateGiftDelivery, giftCreateBody, resendBody, mailStateOf, mailOutcome, mailAddress,
    DESIGN_FIELDS, designBody, validateDesignValue, isHexColor, isHttpsUrl };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OMRZGift = api;
})(typeof window !== 'undefined' ? window : globalThis);
