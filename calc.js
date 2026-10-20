/*
 * Pure calculation helpers for Money Tracker.
 *
 * All money is stored and computed as integer cents to avoid floating point
 * drift (e.g. 0.1 + 0.2 !== 0.3). Dates are plain "YYYY-MM-DD" strings in the
 * user's local time zone, which sort and compare correctly as strings.
 *
 * Works both in the browser (window.MoneyCalc) and in Node (module.exports)
 * so it can be unit tested without a browser.
 */
(function (root) {
  'use strict';

  // Removes binary floating point noise before rounding, so that
  // 1.005 * 100 (= 100.49999999999999) rounds to 101, not 100.
  function roundClean(n) {
    return Math.round(parseFloat(n.toPrecision(12)));
  }

  // "12.34", "$1,234.5", 12.34 -> cents. Returns NaN for anything unparseable.
  function toCents(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? roundClean(value * 100) : NaN;
    }
    const cleaned = String(value == null ? '' : value).replace(/[$,\s]/g, '');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return NaN;
    return roundClean(parseFloat(cleaned) * 100);
  }

  function centsToInput(cents) {
    return (cents / 100).toFixed(2);
  }

  // Pay for a shift in cents: hours * hourly rate, plus tips/bonus.
  function shiftEarningsCents(shift) {
    return roundClean(shift.hours * shift.rateCents) + (shift.tipsCents || 0);
  }

  function percentOf(cents, percent) {
    return roundClean((cents * percent) / 100);
  }

  // Hours between two "HH:MM" times minus an unpaid break, in hours.
  // If the end is not after the start the shift is assumed to cross midnight.
  function hoursFromTimes(start, end, breakMinutes) {
    const re = /^([01]?\d|2[0-3]):([0-5]\d)$/;
    const s = re.exec(start || '');
    const e = re.exec(end || '');
    if (!s || !e) return NaN;
    const startMin = Number(s[1]) * 60 + Number(s[2]);
    let endMin = Number(e[1]) * 60 + Number(e[2]);
    if (endMin <= startMin) endMin += 24 * 60;
    const worked = endMin - startMin - (Number(breakMinutes) || 0);
    if (worked <= 0) return NaN;
    return Math.round((worked / 60) * 100) / 100;
  }

  // ---- Dates (local time, never UTC) ----

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Reject impossible dates such as 2026-02-31 (which JS rolls over).
    if (formatDate(d) !== str) return null;
    return d;
  }

  function today() {
    return formatDate(new Date());
  }

  function addDays(dateStr, days) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + days);
    return formatDate(d);
  }

  /*
   * The inclusive date range for a period containing `refDate`.
   * period: 'week' | 'month' | 'year' | 'all'
   * weekStart: 0 = Sunday, 1 = Monday
   * Returns { start, end } as "YYYY-MM-DD" strings, or nulls for 'all'.
   */
  function periodRange(period, refDate, weekStart) {
    const d = parseDate(refDate);
    if (period === 'week') {
      const offset = (d.getDay() - (weekStart || 0) + 7) % 7;
      const start = addDays(refDate, -offset);
      return { start: start, end: addDays(start, 6) };
    }
    if (period === 'month') {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { start: formatDate(start), end: formatDate(end) };
    }
    if (period === 'year') {
      return { start: d.getFullYear() + '-01-01', end: d.getFullYear() + '-12-31' };
    }
    return { start: null, end: null };
  }

  // Moves a reference date forward/back by whole periods (step = +1 / -1).
  function stepPeriod(period, refDate, step) {
    const d = parseDate(refDate);
    if (period === 'week') return addDays(refDate, 7 * step);
    if (period === 'month') {
      // Use the 1st so that e.g. Jan 31 + 1 month doesn't skip February.
      return formatDate(new Date(d.getFullYear(), d.getMonth() + step, 1));
    }
    if (period === 'year') return formatDate(new Date(d.getFullYear() + step, 0, 1));
    return refDate;
  }

  function inRange(dateStr, range) {
    if (range.start && dateStr < range.start) return false;
    if (range.end && dateStr > range.end) return false;
    return true;
  }

  /*
   * Everything the dashboard shows for a date range.
   *
   *   gross      = sum of (hours * rate + tips) for each shift
   *   taxes      = gross * taxPercent            (an estimate set by the user)
   *   takeHome   = gross - taxes
   *   spendable  = takeHome * spendPercent       (what you allow yourself to spend)
   *   savings    = takeHome - spendable
   *   remaining  = spendable - spent            (negative = over budget)
   */
  function summarize(state, range) {
    const settings = state.settings;
    const shifts = state.shifts.filter(function (s) { return inRange(s.date, range); });
    const expenses = state.expenses.filter(function (e) { return inRange(e.date, range); });

    let hours = 0;
    let gross = 0;
    shifts.forEach(function (s) {
      hours += s.hours;
      gross += shiftEarningsCents(s);
    });
    hours = Math.round(hours * 100) / 100;

    const taxes = percentOf(gross, settings.taxPercent);
    const takeHome = gross - taxes;
    const spendable = percentOf(takeHome, settings.spendPercent);
    const savings = takeHome - spendable;

    let spent = 0;
    const categoryTotals = {};
    expenses.forEach(function (e) {
      spent += e.amountCents;
      const cat = e.category || 'Other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + e.amountCents;
    });
    const byCategory = Object.keys(categoryTotals)
      .map(function (name) { return { name: name, cents: categoryTotals[name] }; })
      .sort(function (a, b) { return b.cents - a.cents || a.name.localeCompare(b.name); });

    return {
      shiftCount: shifts.length,
      expenseCount: expenses.length,
      hours: hours,
      gross: gross,
      taxes: taxes,
      takeHome: takeHome,
      spendable: spendable,
      savings: savings,
      spent: spent,
      remaining: spendable - spent,
      // Share of the spendable budget already used (can exceed 100).
      usedPercent: spendable > 0 ? (spent / spendable) * 100 : (spent > 0 ? Infinity : 0),
      // Take-home pay per hour worked, in cents (0 if no hours).
      takeHomePerHour: hours > 0 ? Math.round(takeHome / hours) : 0,
      byCategory: byCategory
    };
  }

  // How many hours of work an expense costs at a given take-home hourly rate.
  function hoursOfWork(amountCents, takeHomePerHourCents) {
    if (!(takeHomePerHourCents > 0)) return null;
    return amountCents / takeHomePerHourCents;
  }

  // ---- Data validation (used when loading saved data and importing) ----

  const DEFAULT_SETTINGS = {
    hourlyRateCents: 1500,
    taxPercent: 0,
    spendPercent: 50,
    currency: 'USD',
    weekStart: 1
  };

  function defaultState() {
    return {
      version: 1,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      shifts: [],
      expenses: []
    };
  }

  function isPercent(n) {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;
  }

  function isNonNegInt(n) {
    return Number.isInteger(n) && n >= 0;
  }

  function cleanText(v, max) {
    return typeof v === 'string' ? v.slice(0, max) : '';
  }

  // Returns a sanitized copy of `raw`, or throws an Error describing the problem.
  function validateState(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Not a Money Tracker backup.');
    if (!Array.isArray(raw.shifts) || !Array.isArray(raw.expenses) || !raw.settings) {
      throw new Error('Backup is missing shifts, expenses or settings.');
    }
    const s = raw.settings;
    const settings = {
      hourlyRateCents: isNonNegInt(s.hourlyRateCents) ? s.hourlyRateCents : DEFAULT_SETTINGS.hourlyRateCents,
      taxPercent: isPercent(s.taxPercent) ? s.taxPercent : DEFAULT_SETTINGS.taxPercent,
      spendPercent: isPercent(s.spendPercent) ? s.spendPercent : DEFAULT_SETTINGS.spendPercent,
      currency: typeof s.currency === 'string' && /^[A-Z]{3}$/.test(s.currency) ? s.currency : DEFAULT_SETTINGS.currency,
      weekStart: s.weekStart === 0 || s.weekStart === 1 ? s.weekStart : DEFAULT_SETTINGS.weekStart
    };

    const shifts = raw.shifts.map(function (x, i) {
      if (!x || !parseDate(x.date) || typeof x.hours !== 'number' || !(x.hours > 0) || x.hours > 24 ||
          !isNonNegInt(x.rateCents) || (x.tipsCents != null && !isNonNegInt(x.tipsCents))) {
        throw new Error('Work entry #' + (i + 1) + ' is invalid.');
      }
      return {
        id: String(x.id || newId()),
        date: x.date,
        hours: x.hours,
        rateCents: x.rateCents,
        tipsCents: x.tipsCents || 0,
        note: cleanText(x.note, 200)
      };
    });

    const expenses = raw.expenses.map(function (x, i) {
      if (!x || !parseDate(x.date) || !isNonNegInt(x.amountCents) || x.amountCents === 0) {
        throw new Error('Spending entry #' + (i + 1) + ' is invalid.');
      }
      return {
        id: String(x.id || newId()),
        date: x.date,
        amountCents: x.amountCents,
        category: cleanText(x.category, 40) || 'Other',
        note: cleanText(x.note, 200)
      };
    });

    return { version: 1, settings: settings, shifts: shifts, expenses: expenses };
  }

  function newId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try { return crypto.randomUUID(); } catch (e) { /* insecure context: fall through */ }
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---- CSV export ----

  function csvCell(value) {
    let s = value == null ? '' : String(value);
    // Stop spreadsheet apps from treating text like "=SUM(...)" as a formula.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(state) {
    const rows = [['type', 'date', 'hours', 'hourly_rate', 'tips', 'amount', 'category', 'note']];
    state.shifts.forEach(function (s) {
      rows.push(['work', s.date, s.hours, centsToInput(s.rateCents), centsToInput(s.tipsCents || 0),
        centsToInput(shiftEarningsCents(s)), '', csvCell(s.note)]);
    });
    state.expenses.forEach(function (e) {
      rows.push(['expense', e.date, '', '', '', centsToInput(e.amountCents), csvCell(e.category), csvCell(e.note)]);
    });
    return rows.map(function (r) { return r.join(','); }).join('\r\n') + '\r\n';
  }

  const api = {
    toCents: toCents,
    centsToInput: centsToInput,
    shiftEarningsCents: shiftEarningsCents,
    percentOf: percentOf,
    hoursFromTimes: hoursFromTimes,
    formatDate: formatDate,
    parseDate: parseDate,
    today: today,
    addDays: addDays,
    periodRange: periodRange,
    stepPeriod: stepPeriod,
    inRange: inRange,
    summarize: summarize,
    hoursOfWork: hoursOfWork,
    defaultState: defaultState,
    validateState: validateState,
    newId: newId,
    toCsv: toCsv,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.MoneyCalc = api;
  }
})(typeof window !== 'undefined' ? window : this);
