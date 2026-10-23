const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../importer.js');
const C = require('../calc.js');

// Text as pdf.js extracts it from an ADP-style earnings statement.
const ADP_STUB = [
  'Company Code ABC 123456 Loc/Dept 01/ Number 0000012345 Page 1 of 1',
  'ACME CORP',
  'Earnings Statement',
  'Period Starting: 10/01/2026',
  'Period Ending: 10/14/2026',
  'Pay Date: 10/17/2026',
  'Taxable Marital Status: Single',
  'Earnings rate hours this period year to date',
  'Regular 15.0000 80.00 1,200.00 18,450.00',
  'Overtime 22.5000 2.50 56.25 412.50',
  'Gross Pay $1,256.25 19,862.50',
  'Deductions Statutory',
  'Federal Income Tax -98.12 1,402.10',
  'Social Security Tax -77.89 1,231.48',
  'Medicare Tax -18.22 288.01',
  'Net Pay $1,062.02',
  'Your federal taxable wages this period are $1,256.25'
];

test('pay stub (ADP-style PDF text)', () => {
  assert.deepEqual(I.parsePayStub(ADP_STUB), {
    payDate: '2026-10-17', periodStart: '2026-10-01', periodEnd: '2026-10-14',
    hours: 82.5, rateCents: 1500, grossCents: 125625, netCents: 106202
  });
  assert.equal(I.classify(ADP_STUB), 'paystub');
});

test('pay stub from a photo (noisy OCR, other labels)', () => {
  const ocr = [
    'BIG BOX STORES INC',
    'PAY STATEMENT',
    'Pay Period: 09/14/2026 - 09/27/2026  Check Date: 10/02/2026',
    'Hours and Earnings',
    'REG 14.25 61.5O 876.38',          // letter O in 61.50
    'GROSS PAY S876.38 9,120.00',      // S for $
    'FED W/H 61.20',
    'NET PAY 1.701,22'                 // nonsense on purpose: no match for a sane value
  ];
  const r = I.parsePayStub(ocr);
  assert.equal(r.periodStart, '2026-09-14');
  assert.equal(r.periodEnd, '2026-09-27');
  assert.equal(r.payDate, '2026-10-02');
  assert.equal(r.hours, 61.5);
  assert.equal(r.rateCents, 1425);
  assert.equal(r.grossCents, 87638);
  assert.equal(I.classify(ocr), 'paystub');
});

test('pay stub with only "Total Hours" and Take Home', () => {
  const r = I.parsePayStub(['Pay date Oct 17, 2026', 'Total Hours 38.75', 'Gross Earnings 600.63', 'Take Home Pay 512.40']);
  assert.deepEqual([r.payDate, r.hours, r.grossCents, r.netCents], ['2026-10-17', 38.75, 60063, 51240]);
});

test('time card: labeled clock in/out with lunch', () => {
  const lines = ['ACME CORP TIME RECORD', 'Employee: 1234', 'Clock In: 10/19/2026 08:02 AM',
    'Lunch 12:00 PM - 12:30 PM', 'Clock Out: 10/19/2026 04:31 PM', 'Total Hours: 7.98'];
  assert.deepEqual(I.parseTimeCard(lines), { date: '2026-10-19', start: '08:02', end: '16:31', breakMinutes: 30, hours: 7.98 });
  assert.equal(I.classify(lines), 'timecard');
});

test('time card: punch list with a lunch punch out and back in', () => {
  const r = I.parseTimeCard(['Mon 10/19/26', 'IN 7:58a', 'OUT 12:01p', 'IN 12:31p', 'OUT 4:30p']);
  assert.deepEqual([r.date, r.start, r.end, r.breakMinutes], ['2026-10-19', '07:58', '16:30', 30]);
  assert.equal(C.hoursFromTimes(r.start, r.end, r.breakMinutes), 8.03);
});

test('time card: in and out on one line', () => {
  const r = I.parseTimeCard(['10/20/2026', 'IN 08:00 AM   OUT 04:30 PM']);
  assert.deepEqual([r.start, r.end], ['08:00', '16:30']);
});

test('receipt: grand total, not subtotal or tax', () => {
  const lines = ['Walmart', 'Save money. Live better.', 'ST# 01234 OP# 0012 TE# 12',
    'BANANAS 1.24', 'MILK 3.48', 'SUBTOTAL 23.45', 'TAX 1 7.000 % 1.64', 'TOTAL 25.09',
    'VISA TEND 25.09', 'CHANGE DUE 0.00', '10/19/26 14:22:11', '# ITEMS SOLD 6'];
  assert.deepEqual(I.parseReceipt(lines), { date: '2026-10-19', totalCents: 2509, merchant: 'Walmart', category: 'Groceries' });
  assert.equal(I.classify(lines), 'receipt');
});

test('receipt: OCR comma decimals and amount on the next line', () => {
  const r = I.parseReceipt(['STARBUCKS', 'Oct 18, 2026', 'Grande Latte 5,45', 'Total', '$5,95']);
  assert.equal(r.totalCents, 595);
  assert.equal(r.category, 'Food');
});

test('classify: bank statement and unknown text', () => {
  assert.equal(I.classify(['Statement Period 10/01/2026 through 10/31/2026', 'Beginning Balance 1,000.00', 'Ending Balance 900.00']), 'statement');
  assert.equal(I.classify(['Dear customer, thanks for your letter.']), 'other');
});

// ---- Data model ----

test('pay-stub entries use the actual net pay instead of the tax estimate', () => {
  const s = C.defaultState();
  s.settings.taxPercent = 20;
  s.shifts.push({ id: 'a', date: '2026-10-05', hours: 10, rateCents: 2000, tipsCents: 0, note: '', accountId: '', updatedAt: 1 });
  s.shifts.push({ id: 'b', date: '2026-10-17', hours: 82.5, rateCents: 1500, tipsCents: 1875, netCents: 106202,
    periodStart: '2026-10-01', periodEnd: '2026-10-14', note: '', accountId: '', updatedAt: 1 });
  const sum = C.summarize(s, { start: null, end: null });
  assert.equal(sum.gross, 20000 + 125625);
  assert.equal(sum.taxes, 4000 + (125625 - 106202));
  assert.equal(sum.takeHome, 16000 + 106202);
  const v = C.validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(v.shifts[1].netCents, 106202);
  assert.equal(v.shifts[1].periodEnd, '2026-10-14');
  assert.equal(v.shifts[0].netCents, undefined);
  // 82.5 hours is fine for a 14-day period, but not for a single day.
  const oneDay = JSON.parse(JSON.stringify(s));
  delete oneDay.shifts[1].periodStart;
  delete oneDay.shifts[1].periodEnd;
  assert.throws(() => C.validateState(oneDay), /Work entry #2/);
});

test('documents validate, merge and are removed by replaceAll', () => {
  const s = C.defaultState();
  s.documents.push({ id: 'd1', date: '2026-10-17', name: 'stub.pdf', mime: 'application/pdf', size: 1234, kind: 'paystub',
    note: '', entryId: 'b', cloudPath: 'user/d1', updatedAt: 5 });
  s.documents.push({ id: 'd2', date: '2026-10-18', name: 'x', mime: 'image/jpeg', size: 1, kind: 'weird', updatedAt: 1 });
  const v = C.validateState(JSON.parse(JSON.stringify(s)));
  assert.equal(v.documents[1].kind, 'other');
  assert.throws(() => C.validateState(Object.assign(C.defaultState(), { documents: [{ date: 'x', size: 1 }] })), /File #1/);
  const other = C.defaultState();
  other.deleted = { d2: 9 };
  const m = C.mergeStates(v, other);
  assert.deepEqual(m.documents.map(d => d.id), ['d1']);
  const wiped = C.mergeStates(m, C.replaceAll(m, C.defaultState(), 50));
  assert.deepEqual(wiped.documents, []);
});
