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

  // Duidelijke Nederlandse melding per foutcode uit het contract.
  const MESSAGES = {
    plan_required: 'Cadeaubonnen zijn onderdeel van Premium Plus.',
    gift_card_not_found: 'Deze cadeaubon bestaat niet of hoort niet bij deze zaak.',
    gift_card_blocked: 'Deze cadeaubon is geblokkeerd en kan niet worden gebruikt.',
    gift_card_expired: 'Deze cadeaubon is verlopen.',
    gift_card_empty: 'Het saldo van deze cadeaubon is op.',
    insufficient_balance: 'Onvoldoende saldo op deze cadeaubon.',
    invalid_amount: 'Ongeldig bedrag. Vul een bedrag groter dan € 0,00 in, met hooguit 2 decimalen.',
    owner_only: 'Alleen de eigenaar van de zaak kan dit doen.',
    already_reversed: 'Deze afschrijving is al teruggedraaid.',
    rate_limited: 'Te veel pogingen achter elkaar. Wacht even en probeer het opnieuw.',
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
    if (MESSAGES[code]) return MESSAGES[code];
    return (data && typeof data.error === 'string' && data.error) || 'Er ging iets mis. Probeer het opnieuw.';
  }

  const api = { formatCents, parseEuroToCents, normalizeShortCode, classifyScan, newIdempotencyKey, errorMessage, isNotLive, MESSAGES, NOT_LIVE_MESSAGE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OMRZGift = api;
})(typeof window !== 'undefined' ? window : globalThis);
