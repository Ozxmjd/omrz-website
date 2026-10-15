// Draaien: node --test tests/giftcards.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/giftcards.js');

const S = ' '; // formatCents gebruikt een vaste spatie, zodat "€" en het bedrag niet splitsen

test('formatCents: nl-NL euro', () => {
  assert.equal(G.formatCents(123450), `€${S}1.234,50`);
  assert.equal(G.formatCents(3000), `€${S}30,00`);
  assert.equal(G.formatCents(5), `€${S}0,05`);
  assert.equal(G.formatCents(0), `€${S}0,00`);
  assert.equal(G.formatCents(100000000), `€${S}1.000.000,00`);
  assert.equal(G.formatCents(-2550), `-€${S}25,50`);
});

test('formatCents: ongeldig → streepje, nooit 0', () => {
  for (const v of [null, undefined, '3000', 12.5, NaN, Infinity]) assert.equal(G.formatCents(v), '—');
});

test('parseEuroToCents: geaccepteerde notaties', () => {
  assert.equal(G.parseEuroToCents('30'), 3000);
  assert.equal(G.parseEuroToCents('30,5'), 3050);
  assert.equal(G.parseEuroToCents('30.50'), 3050);
  assert.equal(G.parseEuroToCents('€ 30,00'), 3000);
  assert.equal(G.parseEuroToCents('€30'), 3000);
  assert.equal(G.parseEuroToCents('  12,34 '), 1234);
  assert.equal(G.parseEuroToCents('0,01'), 1);
  assert.equal(G.parseEuroToCents(',50'), 50);
  assert.equal(G.parseEuroToCents('1.234,50'), 123450);
  assert.equal(G.parseEuroToCents('1,234.50'), 123450);
  assert.equal(G.parseEuroToCents('1.234'), 123400);
  assert.equal(G.parseEuroToCents('€ 1.000.000,00'), 100000000);
});

test('parseEuroToCents: weigert negatief, nul, >2 decimalen en onzin', () => {
  for (const v of ['-5', '-€ 5', '0', '0,00', '0.0', '30,505', '1,234', '30.5050', '30.123,4,5', '', '   ', '€', 'abc', '3O', '1,2,3', '12.34.5', '30,5e2', null, undefined, {}]) {
    assert.equal(G.parseEuroToCents(v), null, JSON.stringify(v));
  }
});

test('normalizeShortCode: Crockford zoals de backend', () => {
  assert.equal(G.normalizeShortCode('abcd-efgh-jk'), 'ABCD-EFGH-JK');
  assert.equal(G.normalizeShortCode('ABCDEFGHJK'), 'ABCD-EFGH-JK');
  assert.equal(G.normalizeShortCode(' AB CD-EF GH-JK '), 'ABCD-EFGH-JK');
  assert.equal(G.normalizeShortCode('7K3M.P9QR.2X'), '7K3M-P9QR-2X');
  assert.equal(G.normalizeShortCode('ABCO-EFGH-JL'), 'ABC0-EFGH-J1');          // O → 0, L → 1
  assert.equal(G.normalizeShortCode('IBCD-EFGH-JK'), '1BCD-EFGH-JK');          // I → 1
  assert.equal(G.normalizeShortCode('ABCU-EFGH-JK'), null);                    // U komt nooit voor
  assert.equal(G.normalizeShortCode('ABCD-EFGH-J'), null);
  assert.equal(G.normalizeShortCode('ABCD-EFGH-JKL'), null);
});

// De echte vormen uit de backend: in elke cadeaubon-QR (Apple, Google, bonpagina, mail) staat
// bon.code = 32 hex; de deellink is https://api.omrzdigital.nl/cadeaubon/<code>.
const LONG = '9f3c2a7d1e4b5c6d7e8f9a0b1c2d3e4f';
test('classifyScan: elke vorm van een echte cadeaubon is een cadeaubon', () => {
  const g = t => G.classifyScan(t);
  assert.deepEqual(g(LONG), { kind: 'gift', code: LONG });
  assert.deepEqual(g(LONG.toUpperCase()), { kind: 'gift', code: LONG });
  assert.deepEqual(g('  ' + LONG + '\n'), { kind: 'gift', code: LONG });
  for (const host of ['https://api.omrzdigital.nl', 'https://omrzdigital.nl', 'https://www.omrzdigital.nl', 'http://omrzdigital.nl']) {
    assert.deepEqual(g(host + '/cadeaubon/' + LONG), { kind: 'gift', code: LONG }, host);
    assert.deepEqual(g(host + '/cadeaubon/' + LONG + '/?utm_source=wa#x'), { kind: 'gift', code: LONG }, host + ' met query');
  }
  assert.deepEqual(g('HTTPS://API.OMRZDIGITAL.NL/cadeaubon/' + LONG.toUpperCase()), { kind: 'gift', code: LONG });
  assert.deepEqual(g('https://api.omrzdigital.nl/cadeaubon/7K3M-P9QR-2X'), { kind: 'gift', code: '7K3M-P9QR-2X' });
  assert.deepEqual(g('7k3m-p9qr-2x'), { kind: 'gift', code: '7K3M-P9QR-2X' });
  assert.deepEqual(g('7K3MP9QR2X'), { kind: 'gift', code: '7K3M-P9QR-2X' });
});

test('classifyScan: een stempelkaart-QR is nooit een cadeaubon, en vreemde links ook niet', () => {
  const uuid = '3f2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b34';
  assert.deepEqual(G.classifyScan(uuid), { kind: 'stamp', code: uuid });
  assert.equal(G.classifyScan(uuid.toUpperCase()).kind, 'stamp');
  assert.equal(G.classifyScan('https://evil.example/cadeaubon/' + LONG).kind, 'stamp');           // niet ons domein
  assert.equal(G.classifyScan('https://omrzdigital.nl.evil.example/cadeaubon/' + LONG).kind, 'stamp');
  assert.equal(G.classifyScan('https://omrzdigital.nl/cadeaubon/voorbeeld?card_id=x&token=y').kind, 'stamp');  // voorbeeldpagina
  assert.equal(G.classifyScan('https://omrzdigital.nl/stamp/card/abc').kind, 'stamp');
  assert.equal(G.classifyScan('loc-a1b2c3d4e5f6').kind, 'stamp');
  assert.equal(G.classifyScan(LONG.slice(0, 31)).kind, 'stamp');                                   // 31 hex
  assert.equal(G.classifyScan(LONG + '0').kind, 'stamp');                                           // 33 hex
  assert.equal(G.classifyScan('QR-SANNE').kind, 'stamp');
  assert.equal(G.classifyScan('').kind, 'stamp');
});

test('giftShareUrl, giftShortCodeDisplay en redeemResult volgens de backend', () => {
  assert.equal(G.giftShareUrl({ url: 'https://api.omrzdigital.nl/cadeaubon/' + LONG }), 'https://api.omrzdigital.nl/cadeaubon/' + LONG);
  assert.equal(G.giftShareUrl({ share_url: 'x' }), 'x');
  assert.equal(G.giftShareUrl({}), '');
  assert.equal(G.giftShortCodeDisplay({ short_code: '7K3MP9QR2X', short_code_display: '7K3M-P9QR-2X' }), '7K3M-P9QR-2X');
  assert.equal(G.giftShortCodeDisplay({ short_code: '7K3MP9QR2X' }), '7K3M-P9QR-2X');
  const r = G.redeemResult({ success: true, replayed: false, transaction: { id: 't', reference_number: 'CB-0412', amount_cents: 3000, balance_after_cents: 2000 } }, 3000, null);
  assert.deepEqual(r, { amount_cents: 3000, balance_after_cents: 2000, reference_number: 'CB-0412', remaining_to_pay_cents: null, replayed: false });
  assert.equal(G.redeemResult({ transaction: { amount_cents: 2000, balance_after_cents: 0 } }, 2000, 2500).remaining_to_pay_cents, 500);   // zelf berekend
  assert.equal(G.redeemResult({ transaction: { amount_cents: -2000 } }, 2000, null).amount_cents, 2000);
  assert.equal(G.redeemResult({ replayed: true, transaction: {} }, 1000, null).replayed, true);
});

test('newIdempotencyKey: uuid v4, uniek', () => {
  const a = G.newIdempotencyKey(), b = G.newIdempotencyKey();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test('endOfDayAmsterdamISO: 23:59:59 Amsterdamse tijd, ook rond de zomertijd', () => {
  assert.equal(G.endOfDayAmsterdamISO('2027-03-31'), '2027-03-31T21:59:59.000Z');   // zomertijd (+02:00)
  assert.equal(G.endOfDayAmsterdamISO('2027-01-15'), '2027-01-15T22:59:59.000Z');   // wintertijd (+01:00)
  assert.equal(G.endOfDayAmsterdamISO('2026-03-29'), '2026-03-29T21:59:59.000Z');   // dag van de wissel naar zomertijd
  assert.equal(G.endOfDayAmsterdamISO('2026-10-25'), '2026-10-25T22:59:59.000Z');   // dag van de wissel naar wintertijd
  assert.equal(G.endOfDayAmsterdamISO('2028-02-29'), '2028-02-29T22:59:59.000Z');   // schrikkeldag
  for (const v of ['', '2027-02-30', '31-03-2027', '2027-3-1', null]) assert.equal(G.endOfDayAmsterdamISO(v), null, String(v));
});

test('giftStatus: voorrang blocked, expired, empty, active', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  const past = '2026-10-01T21:59:59.000Z', future = '2027-03-31T21:59:59.000Z';
  const st = g => G.giftStatus(g, now);
  assert.equal(st({ status: 'active', balance_cents: 500 }), 'active');
  assert.equal(st({ status: 'active', balance_cents: 500, expires_at: future }), 'active');
  assert.equal(st({ status: 'blocked', balance_cents: 0, expires_at: past }), 'blocked');   // blocked wint van alles
  assert.equal(st({ status: 'expired', balance_cents: 0 }), 'expired');                    // expired wint van empty
  assert.equal(st({ status: 'active', balance_cents: 500, expires_at: past }), 'expired'); // vervaldatum voorbij
  assert.equal(st({ status: 'empty', balance_cents: 0, expires_at: past }), 'expired');
  assert.equal(st({ status: 'empty', balance_cents: 0 }), 'empty');
  assert.equal(st({ status: 'active', balance_cents: 0 }), 'empty');                       // saldo 0 = leeg
  assert.equal(st({ status: 'iets_anders', balance_cents: 500 }), 'unknown');
  assert.equal(st(null), 'unknown');
  assert.deepEqual(G.STATUS_LABELS, { active: 'Actief', empty: 'Leeg', blocked: 'Geblokkeerd', expired: 'Verlopen' });
});

test('isPlanLock: premium_plus_required (backend) en plan_required (contract)', () => {
  assert.equal(G.isPlanLock('premium_plus_required'), true);
  assert.equal(G.isPlanLock('plan_required'), true);
  assert.equal(G.isPlanLock('owner_only'), false);
});

test('errorMessage: elke contractcode heeft een Nederlandse melding', () => {
  const codes = ['premium_plus_required', 'plan_required', 'migration_missing', 'gift_card_not_found', 'gift_card_blocked', 'gift_card_expired', 'gift_card_empty',
    'insufficient_balance', 'invalid_amount', 'owner_only', 'already_reversed', 'rate_limited'];
  for (const c of codes) {
    const m = G.errorMessage(c, {});
    assert.ok(m && m !== 'Er ging iets mis. Probeer het opnieuw.', c);
  }
  assert.equal(G.errorMessage('insufficient_balance', { balance_cents: 2000 }), `Onvoldoende saldo. Er staat nog €${S}20,00 op deze cadeaubon.`);
  assert.equal(G.errorMessage('iets_nieuws', { error: 'Serverbericht' }), 'Serverbericht');
  assert.equal(G.errorMessage(undefined, {}), 'Er ging iets mis. Probeer het opnieuw.');
});

test('isNotLive: 404 zonder code = backend niet live, met code = onbekende bon', () => {
  assert.equal(G.isNotLive(404, {}), true);
  assert.equal(G.isNotLive(404, null), true);
  assert.equal(G.isNotLive(404, { code: 'gift_card_not_found' }), false);
  assert.equal(G.isNotLive(500, {}), false);
});

test('scannerSettingsBody: precies { card_id, enabled } met een echte boolean', () => {
  assert.equal(G.scannerSettingsBody('c1', true), '{"card_id":"c1","enabled":true}');
  assert.equal(G.scannerSettingsBody('c1', false), '{"card_id":"c1","enabled":false}');
  for (const v of ['true', 1, null, undefined]) assert.equal(JSON.parse(G.scannerSettingsBody('c1', v)).enabled, false, String(v));
});

test('scannerEnabledFrom: velden van de backend, alleen een echte true telt', () => {
  assert.equal(G.scannerEnabledFrom({ success: true, gift_cards_scanner_enabled: true, available: true }), true);
  assert.equal(G.scannerEnabledFrom({ success: true, gift_cards_scanner_enabled: false, available: false }), false);
  assert.equal(G.scannerEnabledFrom({ success: true, scanner_enabled: true }), true);       // oud contract
  assert.equal(G.scannerEnabledFrom({ success: true, gift_cards_scanner_enabled: 'true' }), false);
  assert.equal(G.scannerEnabledFrom({ success: false, gift_cards_scanner_enabled: true }), false);
  assert.equal(G.scannerEnabledFrom(null), false);
});

test('referenceFrom: transaction.reference_number, met reference_number als terugval', () => {
  assert.equal(G.referenceFrom({ transaction: { id: 't', reference_number: 'CB-0412' } }), 'CB-0412');
  assert.equal(G.referenceFrom({ reference_number: 'CB-0001' }), 'CB-0001');
  assert.equal(G.referenceFrom({ transaction: { reference_number: 'CB-0412' }, reference_number: 'CB-0001' }), 'CB-0412');
  assert.equal(G.referenceFrom({}), null);
  assert.equal(G.referenceFrom(null), null);
});

test('validateGiftDelivery: regels van de backend vooraf', () => {
  const v = f => G.validateGiftDelivery(f);
  assert.equal(v({ delivery_mode: 'none' }), null);                                           // ontvangerblok leeg mag
  assert.equal(v({ delivery_mode: 'recipient', recipient_email: 'a@b.nl' }), null);
  assert.equal(v({ delivery_mode: 'recipient' }), 'recipient_email_required');
  assert.equal(v({ delivery_mode: 'buyer', buyer_email: 'k@b.nl' }), null);
  assert.equal(v({ delivery_mode: 'buyer', recipient_email: 'a@b.nl' }), 'buyer_email_required');
  assert.equal(v({ delivery_mode: 'none', buyer_email: 'geen-mail' }), 'invalid_buyer_email');
  assert.equal(v({ delivery_mode: 'none', recipient_email: 'x@' }), 'invalid_recipient_email');
  assert.equal(v({ delivery_mode: 'post' }), 'invalid_delivery_mode');
  assert.equal(v({}), 'invalid_delivery_mode');
});

test('giftCreateBody: alleen ingevulde velden, met delivery_mode en sleutel', () => {
  assert.deepEqual(G.giftCreateBody({ card_id: 'c', amount_cents: 2500, delivery_mode: 'none', buyer_name: '  ', recipient_name: 'Mila ', message: '' }),
    { card_id: 'c', amount_cents: 2500, delivery_mode: 'none', recipient_name: 'Mila' });
  assert.deepEqual(G.giftCreateBody({ card_id: 'c', amount_cents: 1000, delivery_mode: 'buyer', buyer_name: 'Kees', buyer_email: 'k@b.nl', expires_at: '2027-01-15T22:59:59.000Z', idempotency_key: 'k1' }),
    { card_id: 'c', amount_cents: 1000, delivery_mode: 'buyer', buyer_name: 'Kees', buyer_email: 'k@b.nl', expires_at: '2027-01-15T22:59:59.000Z', idempotency_key: 'k1' });
});

test('resendBody: target en alleen een ingevuld adres', () => {
  assert.deepEqual(G.resendBody('recipient'), { target: 'recipient' });
  assert.deepEqual(G.resendBody('buyer', ' k@b.nl '), { target: 'buyer', email: 'k@b.nl' });
  assert.deepEqual(G.resendBody('iets', ''), { target: 'recipient' });
});

test('mailStateOf en mailOutcome: verzendstatus', () => {
  // Geneste vorm van de backend: gift_card.mail.pass|buyer + mail.last_attempt_at
  assert.deepEqual(G.mailStateOf({ mail: { pass: { sent_at: 't1', error: null } } }, 'recipient'), { state: 'sent', at: 't1', error: null });
  assert.deepEqual(G.mailStateOf({ mail: { buyer: { sent_at: null, error: 'bounce' }, last_attempt_at: 't2' } }, 'buyer'), { state: 'failed', at: 't2', error: 'bounce' });
  assert.deepEqual(G.mailStateOf({ mail: { pass: { sent_at: 't1' } } }, 'buyer'), { state: 'none', at: null, error: null });
  assert.deepEqual(G.mailStateOf({ pass_mail_sent_at: 't1' }, 'recipient'), { state: 'none', at: null, error: null });   // platte velden bestaan niet
  assert.deepEqual(G.mailStateOf({}, 'buyer'), { state: 'none', at: null, error: null });
  const o = G.mailOutcome({ pass: { to: 'recipient', email: 'a@b.nl', status: 'failed', error: 'SMTP' }, buyer: { status: 'skipped' } });
  assert.equal(o.failed, true); assert.equal(o.rows.length, 1); assert.equal(o.rows[0].target, 'recipient');
  assert.deepEqual(G.mailOutcome(undefined), { rows: [], failed: false });
  assert.equal(G.mailOutcome({ pass: { to: 'a@b.nl', status: 'sent' }, buyer: { status: 'sent' } }).failed, false);
});

test('designBody: alleen wijzigingen, null = weer overnemen van de stempelkaart', () => {
  const o = { pass_color: { value: '#111111', inherited: true }, text_color: { value: '#ffffff', inherited: false }, logo_url: { value: 'https://x/l.png', inherited: false },
    background_url: { value: null, inherited: true }, business_name: { value: 'Zaak', inherited: true }, show_name: { value: true, inherited: true } };
  const c = JSON.parse(JSON.stringify(o));
  assert.deepEqual(G.designBody('c', c, o), { card_id: 'c' });
  c.pass_color = { value: '#1f4d2b', inherited: false };      // eigen kleur
  c.logo_url = { value: 'https://x/l.png', inherited: true }; // terug naar stempelkaart
  c.show_name = { value: false, inherited: false };
  assert.deepEqual(G.designBody('c', c, o), { card_id: 'c', pass_color: '#1f4d2b', logo_url: null, show_name: false });
});

test('validateDesignValue en nieuwe foutmeldingen', () => {
  assert.equal(G.validateDesignValue('pass_color', '#1F4D2B'), null);
  assert.equal(G.validateDesignValue('text_color', 'rood'), 'invalid_color');
  assert.equal(G.validateDesignValue('logo_url', 'http://x.nl/a.png'), 'invalid_url');
  assert.equal(G.validateDesignValue('background_url', 'https://x.nl/a.jpg'), null);
  assert.equal(G.validateDesignValue('logo_url', null), null);
  assert.equal(G.errorMessage('resend_too_soon', { retry_after_seconds: 42 }), 'Net al verstuurd, probeer over 42 seconden.');
  assert.equal(G.errorMessage('resend_too_soon', { retry_after_seconds: 1 }), 'Net al verstuurd, probeer over 1 seconde.');
  for (const c of ['buyer_email_required', 'invalid_buyer_email', 'invalid_recipient_email', 'recipient_email_required', 'invalid_delivery_mode',
    'no_email_for_target', 'invalid_color', 'invalid_url', 'resend_too_soon']) assert.ok(G.MESSAGES[c], c);
});

test('mailAddress: mail.email is het adres, mail.to alleen als het een adres is', () => {
  assert.equal(G.mailAddress({ status: 'sent', to: 'recipient', email: 'a@b.nl' }), 'a@b.nl');
  assert.equal(G.mailAddress({ status: 'sent', to: 'buyer' }), null);
  assert.equal(G.mailAddress({ to: 'a@b.nl', status: 'failed' }), 'a@b.nl');
  assert.equal(G.mailAddress(null), null);
  for (const c of ['invalid_target', 'invalid_expires_at']) assert.ok(G.MESSAGES[c], c);
});

test('mailOutcome volgens de backend: pass.to bepaalt het doel, geen dubbele regel bij "buyer"', () => {
  const rec = G.mailOutcome({ pass: { to: 'recipient', email: 'r@b.nl', status: 'sent' }, buyer: { email: 'k@b.nl', status: 'sent' } });
  assert.deepEqual(rec.rows.map(r => [r.target, r.kind, r.to]), [['recipient', 'pass', 'r@b.nl'], ['buyer', 'confirmation', 'k@b.nl']]);
  const buy = G.mailOutcome({ pass: { to: 'buyer', email: 'k@b.nl', status: 'failed', error: 'x' }, buyer: { email: 'k@b.nl', status: 'failed', error: 'x' } });
  assert.deepEqual(buy.rows.map(r => [r.target, r.kind, r.status]), [['buyer', 'pass', 'failed']]);
  assert.equal(buy.failed, true);
  const none = G.mailOutcome({ pass: { to: null, email: null, status: 'skipped' }, buyer: { email: 'k@b.nl', status: 'sent' } });
  assert.deepEqual(none.rows.map(r => [r.target, r.kind]), [['buyer', 'confirmation']]);
});

test('kleuren in kleine letters: geen schijnwijziging en versturen in kleine letters', () => {
  const o = { pass_color: { value: '#2e5b45', inherited: false }, text_color: { value: '#ffffff', inherited: true }, logo_url: { value: null, inherited: true },
    background_url: { value: null, inherited: true }, business_name: { value: 'Zaak', inherited: true }, show_name: { value: true, inherited: true } };
  const c = JSON.parse(JSON.stringify(o));
  c.pass_color.value = '#2E5B45';
  assert.deepEqual(G.designBody('c', c, o), { card_id: 'c' });                       // zelfde kleur, andere schrijfwijze
  c.pass_color.value = '#AABBCC';
  assert.deepEqual(G.designBody('c', c, o), { card_id: 'c', pass_color: '#aabbcc' });
  c.text_color = { value: '#FFFFFF', inherited: false };
  assert.equal(G.designBody('c', c, o).text_color, '#ffffff');
  assert.equal(G.normalizeColor('#2E5B45'), '#2e5b45');
  assert.equal(G.normalizeColor('rood'), 'rood');
  assert.equal(G.designValue('business_name', 'ABC'), 'ABC');
});

test('classifyScan: het QR-voorvoegsel OMRZCB1: (backend e101948) is altijd een cadeaubon', () => {
  assert.deepEqual(G.classifyScan('OMRZCB1:' + LONG), { kind: 'gift', code: LONG });
  assert.deepEqual(G.classifyScan('omrzcb1:' + LONG.toUpperCase()), { kind: 'gift', code: LONG });
  assert.deepEqual(G.classifyScan(' OMRZCB1: ' + LONG + ' '), { kind: 'gift', code: LONG });
  assert.deepEqual(G.classifyScan('OMRZCB1:7K3M-P9QR-2X'), { kind: 'gift', code: '7K3M-P9QR-2X' });
  assert.equal(G.classifyScan('OMRZCB1:iets-vreemds').kind, 'gift');                  // voorvoegsel = bon, backend zegt welke
  assert.equal(G.classifyScan('3f2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b34').kind, 'stamp');
});

test('resolveOutcome: het antwoord van /scan/resolve (de7021f)', () => {
  const gc = { id: 'g1', card_id: 'c1', balance_cents: 500, status: 'active' };
  assert.deepEqual(G.resolveOutcome(200, { success: true, kind: 'gift_card', gift_card: gc, can_redeem: true, blocked_reason: null, blocked_message: null }),
    { kind: 'gift', gift_card: gc, can_redeem: true, blocked_reason: null, blocked_message: null });
  // can_redeem false: de tekst van de backend (blocked_message) wordt getoond
  const blk = G.resolveOutcome(200, { success: true, kind: 'gift_card', gift_card: gc, can_redeem: false, blocked_reason: 'gift_card_blocked', blocked_message: 'Deze cadeaubon is geblokkeerd.' });
  assert.equal(blk.can_redeem, false); assert.equal(blk.blocked_message, 'Deze cadeaubon is geblokkeerd.');
  assert.ok(G.resolveOutcome(200, { success: true, kind: 'gift_card', gift_card: gc, can_redeem: false, blocked_reason: 'gift_card_empty' }).blocked_message);
  const holder = { id: 'h', customer_qr_code: 'q', first_name: 'A', last_name: null };
  assert.deepEqual(G.resolveOutcome(200, { success: true, kind: 'stamp_holder', holder, lookup_url: '/x' }), { kind: 'stamp', holder });
  // fouten: altijd een nette Nederlandse tekst, nooit de code zelf
  const cases = [[400, 'card_id_required'], [400, 'code_required'], [403, 'premium_plus_required'], [403, 'wrong_location'],
    [404, 'gift_card_not_found'], [404, 'holder_not_found'], [404, 'unknown_code'], [503, 'migration_missing']];
  for (const [st, code] of cases) {
    const o = G.resolveOutcome(st, { error: 'x', code });
    assert.equal(o.kind, 'error', code); assert.equal(o.code, code);
    assert.ok(o.message && o.message !== code && !/_/.test(o.message), code + ' → ' + o.message);
  }
  assert.equal(G.resolveOutcome(403, { code: 'premium_plus_required' }).planLock, true);
  assert.equal(G.resolveOutcome(403, { code: 'wrong_location' }).planLock, false);
  assert.equal(G.resolveOutcome(401, { error: 'Niet geautoriseerd' }).code, 'unauthorized');
  assert.equal(G.resolveOutcome(403, { error: 'Geen toegang tot deze stempelkaart' }).message, G.MESSAGES.forbidden);
  // terugval: netwerk, 429, 5xx, oude backend (404 zonder code), vreemd 200-antwoord
  for (const [st, d] of [[404, {}], [404, null], [500, { error: 'x' }], [502, null], [503, { error: 'x' }], [429, { code: 'rate_limited' }], [0, null], [200, { success: true }], [200, { success: true, kind: 'stamp_holder' }]]) {
    assert.equal(G.resolveOutcome(st, d).kind, 'fallback', st + ' ' + JSON.stringify(d));
  }
});

test('scan-modus: per apparaat onthouden, standaard stempelen', () => {
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
  const st = mem();
  assert.equal(G.readScanMode(st), 'stamp');
  G.saveScanMode(st, 'gift'); assert.equal(G.readScanMode(st), 'gift'); assert.equal(st.m[G.SCAN_MODE_KEY], 'gift');
  G.saveScanMode(st, 'iets'); assert.equal(G.readScanMode(st), 'stamp');
  assert.ok(!G.SCAN_MODE_KEY.startsWith('stamp_'), 'uitloggen wist stamp_*; de keuze hoort te blijven');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(G.readScanMode(broken), 'stamp'); G.saveScanMode(broken, 'gift');
  assert.equal(G.readScanMode(null), 'stamp');
});

test('rapport: querystring per periode', () => {
  const q = s => Object.fromEntries(new URLSearchParams(G.reportQuery('c1', s)));
  assert.deepEqual(q({ preset: '7d' }), { card_id: 'c1', preset: '7d' });
  assert.deepEqual(q({}), { card_id: 'c1', preset: '30d' });
  assert.deepEqual(q({ preset: 'iets' }), { card_id: 'c1', preset: '30d' });
  assert.deepEqual(q({ preset: 'ytd', from: '2026-01-01' }), { card_id: 'c1', preset: 'ytd' });           // from alleen bij custom
  assert.deepEqual(q({ preset: 'custom', from: '2026-02-01', to: '2026-02-28' }), { card_id: 'c1', preset: 'custom', from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(q({ preset: 'custom', from: '1-2-2026' }), { card_id: 'c1', preset: 'custom' });
  assert.equal(q({ preset: '7d', expiring_days: 14 }).expiring_days, '14');
});

test('rapport: gaten in by_day vullen, ook over de zomertijd heen', () => {
  const d = G.fillDays('2026-03-27', '2026-03-31', [{ day: '2026-03-29', issued_cents: 500, issued_count: 1, redeemed_cents: 200, redeemed_count: 1 }]);
  assert.deepEqual(d.map(x => x.day), ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
  assert.equal(d[2].issued_cents, 500); assert.equal(d[2].redeemed_count, 1); assert.equal(d[0].issued_cents, 0);
  assert.equal(G.fillDays('2026-10-25', '2026-10-26', []).length, 2);                                       // wintertijd
  assert.equal(G.fillDays('2026-01-01', '2026-12-31', null).length, 365);
  assert.deepEqual(G.fillDays('2026-02-02', '2026-02-01', []), []);
  assert.deepEqual(G.fillDays(null, '2026-02-01', []), []);
});

test('rapport: vestigingnaam, lege staat, laatste transacties alleen als het veld er is', () => {
  assert.equal(G.locationLabel({ location_id: null, location_name: null }), 'Zonder vestiging (eigenaar)');
  assert.equal(G.locationLabel({ location_id: 'L1', location_name: 'Centrum' }), 'Centrum');
  assert.equal(G.locationLabel({ location_id: 'L9', location_name: null }), 'Verwijderde vestiging');
  assert.equal(G.reportHasCards({ by_status: [{ status: 'active', count: 0 }, { status: 'empty', count: 0 }] }), false);
  assert.equal(G.reportHasCards({ by_status: [{ status: 'empty', count: 2 }] }), true);
  assert.equal(G.reportHasCards({}), false);
  assert.equal(G.reportRecentTx({}), null);
  assert.equal(G.reportRecentTx({ [G.REPORT_TX_FIELD]: 'x' }), null);
  assert.deepEqual(G.reportRecentTx({ [G.REPORT_TX_FIELD]: [] }), []);
});

test('rapport: CSV met puntkomma, komma-decimalen, elke dag en een totaal', () => {
  const csv = G.reportCsv({ range: { from: '2026-02-01', to: '2026-02-03' },
    by_day: [{ day: '2026-02-02', issued_cents: 2500, issued_count: 1, redeemed_cents: 1250, redeemed_count: 2 }],
    totals: { issued_cents: 2500, issued_count: 1, redeemed_cents: 1250, redeemed_count: 2 } });
  assert.ok(csv.startsWith('﻿Datum;Uitgegeven (EUR);Aantal uitgegeven;Afgeschreven (EUR);Aantal afschrijvingen\r\n'));
  const rows = csv.trim().split('\r\n');
  assert.equal(rows.length, 5);
  assert.equal(rows[1], '2026-02-01;0,00;0;0,00;0');
  assert.equal(rows[2], '2026-02-02;25,00;1;12,50;2');
  assert.equal(rows[4], 'Totaal;25,00;1;12,50;2');
  assert.ok(!/btw/i.test(csv));
});

test('ontwerp v2: tien velden, alleen wijzigingen, null = overnemen, nooit null voor show_name/amount_size', () => {
  assert.deepEqual(G.DESIGN_FIELDS.slice().sort(), ['accent_color', 'amount_size', 'background_url', 'business_name', 'font', 'logo_url', 'pass_color', 'show_name', 'text_color', 'theme']);
  const orig = {
    theme: { value: 'klassiek', inherited: true }, pass_color: { value: '#1f4d2b', inherited: true }, text_color: { value: '#ffffff', inherited: true },
    accent_color: { value: '#d4a373', inherited: false }, logo_url: { value: null, inherited: true }, background_url: { value: null, inherited: true },
    business_name: { value: 'Loris', inherited: true }, show_name: { value: true, inherited: false }, font: { value: 'Inter', inherited: true }, amount_size: { value: 'normaal', inherited: false } };
  const cur = JSON.parse(JSON.stringify(orig));
  assert.deepEqual(G.designBody('c', cur, orig), { card_id: 'c' });
  cur.theme = { value: 'feestelijk', inherited: false };
  cur.accent_color = { value: '#D4A373', inherited: false };                     // zelfde kleur, andere letters: geen wijziging
  cur.font = { value: 'Playfair Display', inherited: false };
  cur.amount_size = { value: 'groot', inherited: false };
  assert.deepEqual(G.designBody('c', cur, orig), { card_id: 'c', theme: 'feestelijk', font: 'Playfair Display', amount_size: 'groot' });
  cur.accent_color = { value: null, inherited: true };                          // overnemen
  cur.amount_size = { value: null, inherited: true };                           // kan niet overnemen: niet versturen
  const body = G.designBody('c', cur, orig);
  assert.equal(body.accent_color, null); assert.ok(!('amount_size' in body));
  cur.show_name = { value: false, inherited: false };
  assert.strictEqual(G.designBody('c', cur, orig).show_name, false);
  // Onbekend veld bij een oudere backend: niet aanraken
  const o2 = Object.assign({}, orig); delete o2.font; const c2 = Object.assign({}, cur); delete c2.font;
  assert.ok(!('font' in G.designBody('c', c2, o2)));
});

test('ontwerp v2: controle vooraf tegen de opties uit GET /design', () => {
  const opt = { themes: ['klassiek', 'modern', 'minimaal', 'feestelijk'], fonts: ['Inter', 'Playfair Display'], amount_sizes: ['klein', 'normaal', 'groot'] };
  assert.equal(G.validateDesignValue('accent_color', '#12'), 'invalid_color');
  assert.equal(G.validateDesignValue('accent_color', '#123abc'), null);
  assert.equal(G.validateDesignValue('theme', 'retro', opt), 'invalid_theme');
  assert.equal(G.validateDesignValue('theme', 'modern', opt), null);
  assert.equal(G.validateDesignValue('font', 'playfair display', opt), null);
  assert.equal(G.validateDesignValue('font', 'Comic Sans', opt), 'invalid_font');
  assert.equal(G.validateDesignValue('amount_size', 'reuze', opt), 'invalid_amount_size');
  assert.equal(G.validateDesignValue('show_name', 'false'), 'invalid_show_name');
  for (const c of ['invalid_theme', 'invalid_font', 'invalid_amount_size', 'upload_type', 'upload_size', 'upload_empty', 'upload_failed']) assert.ok(G.MESSAGES[c], c);
});

test('ontwerp v2: contrast, kanalen en uploadcontrole', () => {
  assert.equal(G.contrastRatio('#ffffff', '#000000'), 21);
  assert.ok(G.contrastRatio('#ffffff', '#ffff00') < 4.5);
  assert.equal(G.contrastRatio('#fff', '#000'), null);
  const at = { theme: ['page', 'mail'], accent_color: ['page', 'mail', 'google'], pass_color: ['google', 'apple', 'page', 'mail'] };
  assert.deepEqual(G.channelsOf(at, 'accent_color'), ['page', 'mail', 'google']);
  assert.deepEqual(G.channelsOf(at, 'pass_color'), ['page', 'mail', 'apple', 'google']);
  assert.equal(G.channelsOf(at, 'font'), null);
  assert.equal(G.channelsOf(null, 'theme'), null);
  assert.equal(G.validateUpload({ type: 'image/png', size: 1000, name: 'a.png' }), null);
  assert.equal(G.validateUpload({ type: 'image/webp', size: 5 * 1024 * 1024, name: 'a.webp' }), null);
  assert.equal(G.validateUpload({ type: 'image/png', size: 5 * 1024 * 1024 + 1, name: 'a.png' }), 'upload_size');
  assert.equal(G.validateUpload({ type: 'image/gif', size: 10, name: 'a.gif' }), 'upload_type');
  assert.equal(G.validateUpload({ type: 'image/svg+xml', size: 10, name: 'a.svg' }), 'upload_type');
  assert.equal(G.validateUpload({ type: '', size: 10, name: 'foto.JPEG' }), null);
  assert.equal(G.validateUpload(null), 'upload_empty');
  assert.equal(G.uploadErrorMessage(400, { error: 'Bestand is te groot (max 5MB)' }), G.MESSAGES.upload_size);
  assert.equal(G.uploadErrorMessage(400, { error: 'Alleen afbeeldingen toegestaan (png, jpg, jpeg, webp)' }), G.MESSAGES.upload_type);
  assert.equal(G.uploadErrorMessage(400, { error: 'Geen bestand ontvangen (veld "file")' }), G.MESSAGES.upload_empty);
  assert.equal(G.uploadErrorMessage(403, { error: 'x' }), G.MESSAGES.owner_only);
  assert.equal(G.uploadErrorMessage(500, { error: 'storage kapot' }), G.MESSAGES.upload_failed);
  assert.equal(G.uploadErrorMessage(401, {}), G.MESSAGES.unauthorized);
});

test('bonnenlijst: zoeken zoals de backend (volledige korte code of exact e-mailadres)', () => {
  assert.deepEqual(G.giftSearchQuery(''), { q: '' });
  assert.deepEqual(G.giftSearchQuery('abcd-efgh-jk'), { q: 'ABCDEFGHJK', kind: 'code' });
  assert.deepEqual(G.giftSearchQuery(' ABCD EFGH JK '), { q: 'ABCDEFGHJK', kind: 'code' });
  assert.deepEqual(G.giftSearchQuery('abcd'), { hint: 'code' });
  assert.deepEqual(G.giftSearchQuery('Sanne'), { hint: 'code' });
  assert.deepEqual(G.giftSearchQuery('Sanne@Voorbeeld.NL'), { q: 'sanne@voorbeeld.nl', kind: 'email' });
  assert.deepEqual(G.giftSearchQuery('sanne@'), { hint: 'email' });
});

test('tijdlijn: richting uit type, correctie uit het saldo, teruggedraaid gemarkeerd', () => {
  const txs = [
    { id: 'u', type: 'unblock', amount_cents: 0, balance_after_cents: 4500, created_at: '2026-10-06T10:00:00Z', actor: 'eigenaar:a@b.nl' },
    { id: 'b', type: 'block', amount_cents: 0, balance_after_cents: 4500, created_at: '2026-10-05T10:00:00Z', actor: 'eigenaar:a@b.nl', note: 'kwijt' },
    { id: 'a2', type: 'adjust', amount_cents: 500, balance_after_cents: 4500, created_at: '2026-10-04T10:00:00Z' },
    { id: 'rv', type: 'reverse', amount_cents: 1000, balance_after_cents: 5000, reverses_transaction_id: 'r1', created_at: '2026-10-03T10:00:00Z' },
    { id: 'r1', type: 'redeem', amount_cents: 1000, balance_after_cents: 4000, created_at: '2026-10-02T10:00:00Z', actor: 'medewerker:m@b.nl' },
    { id: 'i', type: 'issue', amount_cents: 5000, balance_after_cents: 5000, created_at: '2026-10-01T10:00:00Z', actor: 'eigenaar:a@b.nl' },
  ];
  const t = Object.fromEntries(G.giftTimeline(txs).map(x => [x.tx.id, x]));
  assert.deepEqual(G.giftTimeline(txs).map(x => x.tx.id), ['u', 'b', 'a2', 'rv', 'r1', 'i']);       // volgorde blijft
  assert.equal(t.i.sign, 1); assert.equal(t.r1.sign, -1); assert.equal(t.rv.sign, 1);
  assert.equal(t.a2.sign, -1, 'correctie van 5000 naar 4500 is eraf');
  assert.equal(t.b.sign, 0); assert.equal(t.u.sign, 0);
  assert.equal(t.r1.reversed, true); assert.equal(t.i.reversed, false);
  assert.equal(t.r1.actor, 'Medewerker'); assert.equal(t.i.actor, 'Eigenaar'); assert.equal(t.a2.actor, '');
  assert.equal(t.r1.amount_cents, 1000);
  const up = G.giftTimeline([{ id: 'x', type: 'adjust', amount_cents: 700, balance_after_cents: 1700, created_at: '2' }, { id: 'y', type: 'issue', amount_cents: 1000, balance_after_cents: 1000, created_at: '1' }]);
  assert.equal(up[0].sign, 1, 'correctie omhoog');
  assert.equal(G.balancePercent({ initial_amount_cents: 5000, balance_cents: 1250 }), 25);
  assert.equal(G.balancePercent({ initial_amount_cents: 0, balance_cents: 0 }), 0);
  assert.deepEqual(G.blockConflictCard('already_blocked', { gift_card: { id: 'g' } }), { id: 'g' });
  assert.equal(G.blockConflictCard('owner_only', { gift_card: { id: 'g' } }), null);
});

test('laatste transacties (backend e8b0952): tekens per type, correctie alleen met eerdere regel, waar', () => {
  assert.equal(G.REPORT_TX_FIELD, 'recent_transactions');
  // Precies de vorm uit server.js e8b0952; note alleen als er iets staat.
  const row = (id, type, amount, after, at, bon, extra) => Object.assign({ id, type, amount_cents: amount, balance_after_cents: after, reference_number: 'CB-' + id,
    created_at: at, gift_card_id: bon, short_code_display: bon === 'g1' ? 'ABCD-EFGH-JK' : 'BZKD-0000-01', location_id: null, location_name: null }, extra || {});
  const list = [
    row('7', 'unblock', 0, 2500, '2026-10-07T10:00:00Z', 'g2'),
    row('6', 'block', 0, 2500, '2026-10-06T10:00:00Z', 'g2', { note: 'kwijt' }),
    row('5', 'adjust', 300, 4000, '2026-10-05T10:00:00Z', 'g1', { note: 'kassaverschil' }),
    row('4', 'reverse', 1000, 4300, '2026-10-04T10:00:00Z', 'g1'),
    row('3', 'redeem', 1000, 3300, '2026-10-03T10:00:00Z', 'g1', { location_id: 'L1', location_name: 'Centrum' }),
    row('2', 'adjust', 500, 3000, '2026-10-02T10:00:00Z', 'g2'),
    row('1', 'issue', 4300, 4300, '2026-10-01T10:00:00Z', 'g1', { location_id: 'L9', location_name: null }),
  ];
  const r = Object.fromEntries(G.recentTxRows(list).map(x => [x.tx.id, x]));
  assert.deepEqual(G.recentTxRows(list).map(x => x.tx.id), ['7', '6', '5', '4', '3', '2', '1']);   // volgorde van de backend
  assert.equal(r['1'].sign, 1, 'uitgifte +'); assert.equal(r['3'].sign, -1, 'afschrijving −'); assert.equal(r['4'].sign, 1, 'terugdraaien +');
  assert.equal(r['5'].sign, -1, 'correctie van 4300 naar 4000 is eraf (eerdere regel van dezelfde bon)');
  assert.equal(r['2'].sign, 0, 'correctie zonder eerdere regel van die bon: geen teken');
  assert.equal(r['6'].hasAmount, false); assert.equal(r['7'].hasAmount, false); assert.equal(r['3'].hasAmount, true);
  assert.equal(r['3'].where, 'Centrum'); assert.equal(r['5'].where, 'Eigenaar'); assert.equal(r['1'].where, 'Verwijderde vestiging');
  assert.equal(r['3'].amount_cents, 1000);
  assert.deepEqual(G.recentTxRows(null), []);
});
