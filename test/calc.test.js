const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calc.js');

test('toCents parses money without floating point errors', () => {
  assert.equal(C.toCents('12.34'), 1234);
  assert.equal(C.toCents('$1,234.5'), 123450);
  assert.equal(C.toCents('1.005'), 101);
  assert.equal(C.toCents('.5'), 50);
  assert.equal(C.toCents('10.'), 1000);
  assert.equal(C.toCents(0.1 + 0.2), 30);
  assert.ok(Number.isNaN(C.toCents('abc')));
  assert.ok(Number.isNaN(C.toCents('')));
  assert.ok(Number.isNaN(C.toCents('1.2.3')));
  assert.ok(Number.isNaN(C.toCents(Infinity)));
});

test('shift earnings = hours x rate + tips, rounded to the cent', () => {
  assert.equal(C.shiftEarningsCents({ hours: 7.5, rateCents: 1525, tipsCents: 0 }), 11438); // 114.375 -> 114.38
  assert.equal(C.shiftEarningsCents({ hours: 8, rateCents: 1500, tipsCents: 2000 }), 14000);
  assert.equal(C.shiftEarningsCents({ hours: 0.1, rateCents: 1000 }), 100);
});

test('hoursFromTimes handles breaks and overnight shifts', () => {
  assert.equal(C.hoursFromTimes('09:00', '17:00', 30), 7.5);
  assert.equal(C.hoursFromTimes('22:00', '06:00', 0), 8);
  assert.equal(C.hoursFromTimes('09:15', '09:45', 0), 0.5);
  assert.ok(Number.isNaN(C.hoursFromTimes('09:00', '10:00', 90)));
  assert.ok(Number.isNaN(C.hoursFromTimes('', '10:00', 0)));
});

test('parseDate rejects impossible dates', () => {
  assert.equal(C.parseDate('2026-02-31'), null);
  assert.equal(C.parseDate('2026-13-01'), null);
  assert.equal(C.parseDate('nope'), null);
  assert.ok(C.parseDate('2028-02-29'));
});

test('week ranges respect the chosen first day of the week', () => {
  // 2026-10-20 is a Tuesday.
  assert.deepEqual(C.periodRange('week', '2026-10-20', 1), { start: '2026-10-19', end: '2026-10-25' });
  assert.deepEqual(C.periodRange('week', '2026-10-20', 0), { start: '2026-10-18', end: '2026-10-24' });
  // Sunday with Monday-start weeks belongs to the week that began 6 days earlier.
  assert.deepEqual(C.periodRange('week', '2026-10-25', 1), { start: '2026-10-19', end: '2026-10-25' });
  // Crosses a year boundary.
  assert.deepEqual(C.periodRange('week', '2027-01-01', 1), { start: '2026-12-28', end: '2027-01-03' });
});

test('month and year ranges', () => {
  assert.deepEqual(C.periodRange('month', '2028-02-10', 1), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(C.periodRange('month', '2026-02-10', 1), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(C.periodRange('month', '2026-12-31', 1), { start: '2026-12-01', end: '2026-12-31' });
  assert.deepEqual(C.periodRange('year', '2026-06-15', 1), { start: '2026-01-01', end: '2026-12-31' });
  assert.deepEqual(C.periodRange('all', '2026-06-15', 1), { start: null, end: null });
});

test('stepPeriod does not skip short months', () => {
  assert.equal(C.stepPeriod('month', '2026-01-31', 1), '2026-02-01');
  assert.equal(C.stepPeriod('month', '2026-01-15', -1), '2025-12-01');
  assert.equal(C.stepPeriod('week', '2026-10-20', -1), '2026-10-13');
  assert.equal(C.stepPeriod('year', '2026-10-20', 1), '2027-01-01');
});

test('addDays is correct across DST changes', () => {
  // US DST ends 2026-11-01; EU DST ends 2026-10-25.
  assert.equal(C.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(C.addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(C.addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(C.addDays('2026-03-08', 1), '2026-03-09');
});

function sampleState() {
  const s = C.defaultState();
  s.settings.taxPercent = 10;
  s.settings.spendPercent = 40;
  s.shifts.push({ id: 'a', date: '2026-10-05', hours: 8, rateCents: 1500, tipsCents: 0, note: '' });
  s.shifts.push({ id: 'b', date: '2026-10-12', hours: 4.5, rateCents: 1500, tipsCents: 1000, note: '' });
  s.shifts.push({ id: 'c', date: '2026-09-30', hours: 5, rateCents: 1500, tipsCents: 0, note: '' });
  s.expenses.push({ id: 'x', date: '2026-10-06', amountCents: 2500, category: 'Food', note: '' });
  s.expenses.push({ id: 'y', date: '2026-10-07', amountCents: 4000, category: 'Gas', note: '' });
  s.expenses.push({ id: 'z', date: '2026-10-31', amountCents: 1000, category: 'Food', note: '' });
  s.expenses.push({ id: 'w', date: '2026-11-01', amountCents: 9999, category: 'Fun', note: '' });
  return s;
}

test('summarize computes the budget for a period', () => {
  const sum = C.summarize(sampleState(), C.periodRange('month', '2026-10-20', 1));
  // Gross: 8*15 = 120 + 4.5*15 = 67.50 + 10 tips = 197.50
  assert.equal(sum.shiftCount, 2);
  assert.equal(sum.hours, 12.5);
  assert.equal(sum.gross, 19750);
  assert.equal(sum.taxes, 1975);          // 10%
  assert.equal(sum.takeHome, 17775);
  assert.equal(sum.spendable, 7110);      // 40% of 177.75
  assert.equal(sum.savings, 10665);
  assert.equal(sum.spendable + sum.savings, sum.takeHome);
  assert.equal(sum.spent, 7500);          // 25 + 40 + 10 (Nov 1 excluded)
  assert.equal(sum.remaining, -390);      // over budget by 3.90
  assert.ok(sum.usedPercent > 100);
  assert.equal(sum.takeHomePerHour, 1422); // 177.75 / 12.5
  assert.deepEqual(sum.byCategory, [{ name: 'Gas', cents: 4000 }, { name: 'Food', cents: 3500 }]);
});

test('summarize with no data', () => {
  const sum = C.summarize(C.defaultState(), { start: null, end: null });
  assert.equal(sum.gross, 0);
  assert.equal(sum.remaining, 0);
  assert.equal(sum.usedPercent, 0);
  assert.equal(sum.takeHomePerHour, 0);
});

test('summarize flags spending with no income as fully used', () => {
  const s = C.defaultState();
  s.expenses.push({ id: 'x', date: '2026-10-06', amountCents: 500, category: 'Food', note: '' });
  const sum = C.summarize(s, { start: null, end: null });
  assert.equal(sum.remaining, -500);
  assert.equal(sum.usedPercent, Infinity);
});

test('validateState accepts its own output and rejects bad data', () => {
  const s = sampleState();
  assert.deepEqual(C.validateState(JSON.parse(JSON.stringify(s))), s);
  assert.throws(() => C.validateState(null));
  assert.throws(() => C.validateState({ settings: {}, shifts: [], expenses: 'x' }));
  assert.throws(() => C.validateState({ settings: {}, shifts: [{ date: '2026-01-01', hours: -1, rateCents: 1 }], expenses: [] }), /Work entry #1/);
  assert.throws(() => C.validateState({ settings: {}, shifts: [], expenses: [{ date: '2026-02-30', amountCents: 5 }] }), /Spending entry #1/);
  assert.throws(() => C.validateState({ settings: {}, shifts: [], expenses: [{ date: '2026-02-03', amountCents: 1.5 }] }));
  // Bad settings fall back to defaults instead of failing.
  const fixed = C.validateState({ settings: { spendPercent: 400, currency: '<b>', weekStart: 5 }, shifts: [], expenses: [] });
  assert.equal(fixed.settings.spendPercent, 50);
  assert.equal(fixed.settings.currency, 'USD');
  assert.equal(fixed.settings.weekStart, 1);
});

test('CSV export quotes text and neutralizes formulas', () => {
  const s = C.defaultState();
  s.shifts.push({ id: 'a', date: '2026-10-05', hours: 7.5, rateCents: 1525, tipsCents: 0, note: 'Closing, late' });
  s.expenses.push({ id: 'x', date: '2026-10-06', amountCents: 1999, category: 'Food', note: '=HYPERLINK("x")' });
  const lines = C.toCsv(s).trim().split('\r\n');
  assert.equal(lines[0], 'type,date,hours,hourly_rate,tips,amount,category,note');
  assert.equal(lines[1], 'work,2026-10-05,7.5,15.25,0.00,114.38,,"Closing, late"');
  assert.equal(lines[2], 'expense,2026-10-06,,,,19.99,Food,"\'=HYPERLINK(""x"")"');
});

test('hoursOfWork', () => {
  assert.equal(C.hoursOfWork(3000, 1500), 2);
  assert.equal(C.hoursOfWork(3000, 0), null);
});
