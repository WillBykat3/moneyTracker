const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../importer.js');
const C = require('../calc.js');

const brief = r => r.transactions.map(t => [t.date, t.description, t.amountCents, t.direction]);

test('readDate understands common statement formats', () => {
  assert.deepEqual(I.readDate('09/03 STARBUCKS'), { y: null, m: 9, d: 3, length: 5 });
  assert.deepEqual(I.readDate('09/03/2026 x'), { y: 2026, m: 9, d: 3, length: 10 });
  assert.deepEqual(I.readDate('9/3/26 x'), { y: 2026, m: 9, d: 3, length: 6 });
  assert.deepEqual(I.readDate('2026-09-03'), { y: 2026, m: 9, d: 3, length: 10 });
  assert.equal(I.readDate('Sep 3 Uber').m, 9);
  assert.equal(I.readDate('Sept 03, 2026 x').y, 2026);
  assert.equal(I.readDate('03 Oct 2026').m, 10);
  assert.equal(I.readDate('Total 09/03'), null);
  assert.equal(I.readDate('123/45'), null);
});

test('findAmounts reads signs, parentheses, CR/DR and ignores reference numbers', () => {
  const a = I.findAmounts('Card 1234 ref 98765 -5.25 1,234.56');
  assert.deepEqual(a.map(x => [x.cents, x.sign]), [[525, -1], [123456, 0]]);
  assert.deepEqual(I.findAmounts('($12.00)').map(x => [x.cents, x.sign]), [[1200, -1]]);
  assert.deepEqual(I.findAmounts('45.00-').map(x => [x.cents, x.sign]), [[4500, -1]]);
  assert.deepEqual(I.findAmounts('45.00 CR').map(x => [x.cents, x.sign]), [[4500, 1]]);
  assert.deepEqual(I.findAmounts('+$1,000.00').map(x => [x.cents, x.sign]), [[100000, 1]]);
  assert.deepEqual(I.findAmounts('ZIP 30301 PHONE 5551234'), []);
});

test('PDF text: checking statement with running balance and year inference', () => {
  const lines = [
    'Example Bank Checking Statement',
    'Statement Period 09/01/2026 through 09/30/2026',
    'Account Number 000123456789',
    'Beginning Balance 1,000.00',
    'DATE DESCRIPTION AMOUNT BALANCE',
    '09/02 STARBUCKS STORE 1234 SEATTLE WA -5.25 994.75',
    '09/05 DIRECT DEP ACME CORP PAYROLL 812.40 1,807.15',
    '09/07 09/08 SHELL OIL 57444 -42.10 1,765.05',
    '09/15 ONLINE TRANSFER TO SAVINGS -200.00 1,565.05',
    '09/20 AMAZON.COM*AB12C (19.99) 1,545.06',
    '09/30 Ending Balance 1,545.06',
    'Total withdrawals 267.34',
    'Page 1 of 2'
  ];
  const r = I.fromTextLines(lines);
  assert.deepEqual(brief(r), [
    ['2026-09-02', 'STARBUCKS STORE 1234 SEATTLE WA', 525, 'out'],
    ['2026-09-05', 'DIRECT DEP ACME CORP PAYROLL', 81240, 'in'],
    ['2026-09-07', 'SHELL OIL 57444', 4210, 'out'],
    ['2026-09-15', 'ONLINE TRANSFER TO SAVINGS', 20000, 'out'],
    ['2026-09-20', 'AMAZON.COM*AB12C', 1999, 'out']
  ]);
  assert.equal(r.skipped, 1); // the "Ending Balance" line
});

test('PDF text: unsigned withdrawals default to spending; December on a January statement', () => {
  const lines = [
    'Statement closing date January 12, 2027',
    'Dec 28 Netflix.com 15.49',
    'Jan 03 Kroger #123 64.20',
    'Jan 05 Refund from Target 12.00',
    'Jan 10 Interest paid 0.42'
  ];
  assert.deepEqual(brief(I.fromTextLines(lines)), [
    ['2026-12-28', 'Netflix.com', 1549, 'out'],
    ['2027-01-03', 'Kroger #123', 6420, 'out'],
    ['2027-01-05', 'Refund from Target', 1200, 'in'],
    ['2027-01-10', 'Interest paid', 42, 'in']
  ]);
});

test('parseCsv handles quotes, commas, newlines and a BOM', () => {
  assert.deepEqual(I.parseCsv('﻿a,"b, c","say ""hi"""\r\n1,"two\nlines",3\n\n'), [
    ['a', 'b, c', 'say "hi"'], ['1', 'two\nlines', '3']
  ]);
});

test('CSV: Chase-style checking export (signed amounts)', () => {
  const csv = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n' +
    'DEBIT,09/02/2026,"STARBUCKS STORE 1234",-5.25,DEBIT_CARD,994.75,,\n' +
    'CREDIT,09/05/2026,"ACME CORP PAYROLL PPD ID: 123",812.40,ACH_CREDIT,1807.15,,\n';
  assert.deepEqual(brief(I.fromCsv(csv)), [
    ['2026-09-02', 'STARBUCKS STORE 1234', 525, 'out'],
    ['2026-09-05', 'ACME CORP PAYROLL PPD ID: 123', 81240, 'in']
  ]);
});

test('CSV: Bank of America style with summary lines above the header', () => {
  const csv = 'Description,,Summary Amt.\nBeginning balance as of 09/01/2026,,"1,000.00"\n\n' +
    'Date,Description,Amount,Running Bal.\n' +
    '09/01/2026,Beginning balance as of 09/01/2026,,"1,000.00"\n' +
    '09/03/2026,"KROGER #123","-64.20","935.80"\n' +
    '09/04/2026,"Zelle payment from SAM","25.00","960.80"\n';
  assert.deepEqual(brief(I.fromCsv(csv)), [
    ['2026-09-03', 'KROGER #123', 6420, 'out'],
    ['2026-09-04', 'Zelle payment from SAM', 2500, 'in']
  ]);
});

test('CSV: Capital One style with separate Debit and Credit columns', () => {
  const csv = 'Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n' +
    '2026-09-03,2026-09-04,1234,UBER TRIP,Other Travel,18.40,\n' +
    '2026-09-10,2026-09-10,1234,CAPITAL ONE MOBILE PYMT,Payment/Credit,,250.00\n';
  assert.deepEqual(brief(I.fromCsv(csv)), [
    ['2026-09-03', 'UBER TRIP', 1840, 'out'],
    ['2026-09-10', 'CAPITAL ONE MOBILE PYMT', 25000, 'in']
  ]);
});

test('CSV: credit card export where charges are positive', () => {
  const csv = 'Date,Description,Amount\n09/03/2026,SPOTIFY USA,11.99\n09/09/2026,AMAZON MARKETPLACE,42.50\n09/12/2026,REFUND AMAZON,10.00\n';
  assert.deepEqual(brief(I.fromCsv(csv)).map(t => t[3]), ['out', 'out', 'in']);
});

test('CSV: Wells Fargo style with no header row', () => {
  const csv = '"09/03/2026","-5.25","*","","STARBUCKS STORE 1234"\n"09/05/2026","812.40","*","","PAYROLL ACME"\n';
  assert.deepEqual(brief(I.fromCsv(csv)), [
    ['2026-09-03', 'STARBUCKS STORE 1234', 525, 'out'],
    ['2026-09-05', 'PAYROLL ACME', 81240, 'in']
  ]);
});

test('CSV: unreadable files give a clear error', () => {
  assert.match(I.fromCsv('').error, /empty/);
  assert.match(I.fromCsv('name,notes\nfoo,bar\n').error, /date and amount/);
});

test('review hints: categories, duplicates, paychecks and transfers', () => {
  const state = C.defaultState();
  state.expenses.push({ id: 'e', date: '2026-09-03', amountCents: 6420, category: 'Food', note: '', accountId: '', updatedAt: 1 });
  const rows = I.prepareForReview([
    { date: '2026-09-02', description: 'STARBUCKS 1234', amountCents: 525, direction: 'out' },
    { date: '2026-09-03', description: 'KROGER #123', amountCents: 6420, direction: 'out' },
    { date: '2026-09-05', description: 'ACME CORP PAYROLL', amountCents: 81240, direction: 'in' },
    { date: '2026-09-06', description: 'ONLINE TRANSFER TO SAVINGS', amountCents: 20000, direction: 'out' },
    { date: '2026-09-07', description: 'Payment Thank You', amountCents: 9000, direction: 'in' },
    { date: '2026-09-08', description: 'REFUND TARGET', amountCents: 1200, direction: 'in' }
  ], state);
  assert.deepEqual(rows.map(r => [r.include, r.category]), [
    [true, 'Food'], [false, 'Groceries'], [false, 'Other'], [false, 'Other'], [false, 'Other'], [true, 'Shopping']
  ]);
  assert.match(rows[1].reason, /duplicate/);
  assert.match(rows[2].reason, /paycheck/);
  assert.match(rows[3].reason, /transfer/);
  assert.equal(rows[5].source, 'Refund');
});
