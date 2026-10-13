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

test('normalizeShortCode', () => {
  assert.equal(G.normalizeShortCode('abcd-efgh-jk'), 'ABCD-EFGH-JK');
  assert.equal(G.normalizeShortCode('ABCDEFGHJK'), 'ABCD-EFGH-JK');
  assert.equal(G.normalizeShortCode(' AB CD-EF GH-JK '), 'ABCD-EFGH-JK');
  assert.equal(G.normalizeShortCode('ABCD-EFGH-J'), null);
  assert.equal(G.normalizeShortCode('ABCD-EFGH-JKL'), null);
});

test('classifyScan: cadeaubon-links en korte codes', () => {
  assert.deepEqual(G.classifyScan('https://omrzdigital.nl/cadeaubon/k9X2pQ7vLm3a'), { kind: 'gift', code: 'k9X2pQ7vLm3a' });
  assert.deepEqual(G.classifyScan('https://api.omrzdigital.nl/cadeaubon/AbC123?utm=wa#x'), { kind: 'gift', code: 'AbC123' });
  assert.deepEqual(G.classifyScan('HTTPS://OMRZDIGITAL.NL/CADEAUBON/XYZ'), { kind: 'gift', code: 'XYZ' });
  assert.deepEqual(G.classifyScan('abcd-efgh-jk'), { kind: 'gift', code: 'ABCD-EFGH-JK' });
});

test('classifyScan: stempelkaart-QR (UUID) en andere tekst blijven stempelflow', () => {
  const uuid = '3f2b8c1e-9a4d-4e6f-b7c2-1d0e5a9f8b34';
  assert.deepEqual(G.classifyScan(uuid), { kind: 'stamp', code: uuid });
  assert.equal(G.classifyScan('https://omrzdigital.nl/stamp/card/abc').kind, 'stamp');
  assert.equal(G.classifyScan('QR-SANNE').kind, 'stamp');
  assert.equal(G.classifyScan('').kind, 'stamp');
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
  assert.deepEqual(G.mailStateOf({ pass_mail_sent_at: 't1' }, 'recipient'), { state: 'sent', at: 't1', error: null });
  assert.deepEqual(G.mailStateOf({ buyer_mail_error: 'bounce' }, 'buyer'), { state: 'failed', at: null, error: 'bounce' });
  assert.deepEqual(G.mailStateOf({}, 'buyer'), { state: 'none', at: null, error: null });
  const o = G.mailOutcome({ pass: { to: 'a@b.nl', status: 'failed', error: 'SMTP' }, buyer: { status: 'skipped' } });
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
