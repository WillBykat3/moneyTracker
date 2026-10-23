/*
 * Turns bank statements (CSV exports or the text of a PDF) into a list of
 * transactions for the user to review before importing.
 *
 * Bank statements have no standard layout, so this is best-effort guessing:
 * nothing is imported until the user has checked each row.
 *
 * A transaction: { date: 'YYYY-MM-DD', description, amountCents (> 0),
 *                  direction: 'out' | 'in' }
 *
 * Works in the browser (window.MoneyImport) and in Node (for tests).
 */
(function (root) {
  'use strict';

  const MAX_ROWS = 2000;

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function monthNumber(name) { return MONTHS[name.toLowerCase().slice(0, 3)]; }
  const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';

  function pad(n) { return String(n).padStart(2, '0'); }

  function validDate(y, m, d) {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function fullYear(y) {
    if (y >= 100) return y;
    return y + 2000; // "26" -> 2026
  }

  /*
   * Reads a date at the very start of `text`. US order (month first) is
   * assumed for numeric dates. Returns { y (may be null), m, d, length } or null.
   */
  function readDate(text) {
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?![\d])/.exec(text))) {
      return { y: +m[1], m: +m[2], d: +m[3], length: m[0].length };
    }
    if ((m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?(?![\d/])/.exec(text))) {
      return { y: m[3] ? fullYear(+m[3]) : null, m: +m[1], d: +m[2], length: m[0].length };
    }
    if ((m = new RegExp('^' + MONTH_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![\\d])', 'i').exec(text))) {
      return { y: m[3] ? +m[3] : null, m: monthNumber(m[1]), d: +m[2], length: m[0].length };
    }
    if ((m = new RegExp('^(\\d{1,2})\\s+' + MONTH_RE + '(?:,?\\s+(\\d{4}))?(?![\\d])', 'i').exec(text))) {
      return { y: m[3] ? +m[3] : null, m: monthNumber(m[2]), d: +m[1], length: m[0].length };
    }
    return null;
  }

  // Money with exactly two decimals, so account and reference numbers don't match.
  // Handles $, commas, a leading or trailing minus, (parentheses) and CR/DR.
  const AMOUNT_RE = /(^|[\s$])(\+|-|\()?\s?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(\))?(-)?(?:\s?(CR|DR)\b)?(?=\s|$)/gi;

  function findAmounts(text) {
    const found = [];
    AMOUNT_RE.lastIndex = 0;
    let m;
    while ((m = AMOUNT_RE.exec(text))) {
      const cents = parseInt(m[3].replace(/,/g, ''), 10) * 100 + parseInt(m[4], 10);
      const negative = m[2] === '-' || (m[2] === '(' && m[5] === ')') || m[6] === '-' || /dr/i.test(m[7] || '');
      const positive = m[2] === '+' || /cr/i.test(m[7] || '');
      found.push({ cents: cents, sign: negative ? -1 : positive ? 1 : 0, index: m.index + m[1].length });
    }
    return found;
  }

  // Parses one money value from a CSV cell. Returns { cents, sign } or null.
  function parseMoneyCell(cell) {
    const t = String(cell || '').trim();
    if (!t) return null;
    const m = /^(\+|-|\()?\s?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(\))?(-)?(?:\s?(CR|DR))?$/i.exec(t);
    if (!m) return null;
    const cents = parseInt(m[2].replace(/,/g, ''), 10) * 100 + parseInt(((m[3] || '') + '00').slice(0, 2), 10);
    const negative = m[1] === '-' || (m[1] === '(' && m[4] === ')') || m[5] === '-' || /dr/i.test(m[6] || '');
    const positive = m[1] === '+' || /cr/i.test(m[6] || '');
    return { cents: cents, sign: negative ? -1 : positive ? 1 : 0 };
  }

  const SKIP_LINE = /\b(beginning|ending|opening|closing|previous|new|available|daily|average)\s+(ledger\s+)?balance\b|\bbalance\s+(forward|brought|carried)\b|\b(sub)?total\b|\bminimum payment\b|\bpayment due\b|\bcredit limit\b|\bstatement (period|date)\b/i;
  const INCOME_WORDS = /\b(deposit|payroll|direct dep|dir dep|ach credit|ach cr|refund|interest (paid|earned|payment)|cash ?back|reversal|zelle from|zelle payment from|venmo cashout|received|credit adjustment|salary|wages)\b/i;
  const PAYCHECK_WORDS = /\b(payroll|direct dep|dir dep|salary|wages|paycheck|adp)\b/i;
  const TRANSFER_WORDS = /\b(transfer (to|from)|online transfer|xfer|payment to|payment thank you|card payment|cc payment|crd pmt|autopay|auto pay|epay|credit card payment|online payment)\b/i;

  // Infers the year for dates printed without one (e.g. "09/03"), using the
  // latest full date in the statement as its end. A December entry on a
  // statement ending in January belongs to the year before.
  function makeYearResolver(endDate) {
    const end = endDate || (function () { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1 }; })();
    return function (d) {
      if (d.y) return d.y;
      return d.m > end.m ? end.y - 1 : end.y;
    };
  }

  function latestFullDate(lines) {
    let best = null;
    lines.forEach(function (line) {
      const re = new RegExp('(\\d{4})-(\\d{1,2})-(\\d{1,2})|(\\d{1,2})/(\\d{1,2})/(\\d{4}|\\d{2})(?![\\d])|' + MONTH_RE + '\\s+\\d{1,2},?\\s+\\d{4}', 'gi');
      let m;
      while ((m = re.exec(line))) {
        const d = readDate(m[0]);
        if (!d || !d.y || !validDate(d.y, d.m, d.d)) continue;
        if (d.y > new Date().getFullYear() + 1) continue;
        if (!best || d.y * 10000 + d.m * 100 + d.d > best.y * 10000 + best.m * 100 + best.d) best = d;
      }
    });
    return best;
  }

  function finish(date, description, cents, direction) {
    return {
      date: date,
      description: description.replace(/\s+/g, ' ').trim().slice(0, 200),
      amountCents: cents,
      direction: direction
    };
  }

  function directionFrom(sign, description) {
    if (sign < 0) return 'out';
    if (sign > 0) return 'in';
    return INCOME_WORDS.test(description) ? 'in' : 'out';
  }

  /*
   * PDF statements: `lines` is the statement's text, one printed line per
   * entry. A transaction line starts with a date and contains an amount; if
   * a line has two amounts, the last is usually the running balance.
   */
  function fromTextLines(lines) {
    const resolveYear = makeYearResolver(latestFullDate(lines));
    const out = [];
    let skipped = 0;
    lines.forEach(function (raw) {
      const line = raw.replace(/\s+/g, ' ').trim();
      const d = readDate(line);
      if (!d) return;
      let rest = line.slice(d.length).trim();
      const second = readDate(rest); // posting date after the transaction date
      if (second) rest = rest.slice(second.length).trim();
      const amounts = findAmounts(rest);
      if (amounts.length === 0) return;
      const amount = amounts[0];
      const description = rest.slice(0, amount.index).trim();
      if (!description || SKIP_LINE.test(description) || amount.cents === 0) { skipped++; return; }
      const y = resolveYear(d);
      if (!validDate(y, d.m, d.d)) { skipped++; return; }
      out.push(finish(y + '-' + pad(d.m) + '-' + pad(d.d), description, amount.cents, directionFrom(amount.sign, description)));
    });
    return { transactions: out.slice(0, MAX_ROWS), skipped: skipped, truncated: out.length > MAX_ROWS };
  }

  // ---- CSV ----

  // RFC 4180-style parser: quoted fields, "" escapes, commas/newlines in quotes.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    text = String(text).replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(function (x) { return x.trim() !== ''; })) rows.push(row);
    return rows;
  }

  function findColumn(header, patterns) {
    for (let p = 0; p < patterns.length; p++) {
      for (let i = 0; i < header.length; i++) {
        if (patterns[p].test(header[i].trim())) return i;
      }
    }
    return -1;
  }

  // A CSV cell holding a full date, optionally followed by a time.
  function cellDate(cell) {
    const t = String(cell || '').trim();
    const d = readDate(t);
    if (!d || !d.y) return null;
    if (!/^([T\s]+\d{1,2}:\d{2}.*)?$/.test(t.slice(d.length))) return null;
    return validDate(d.y, d.m, d.d) ? d.y + '-' + pad(d.m) + '-' + pad(d.d) : null;
  }

  function fromCsv(text) {
    const rows = parseCsv(text);
    if (rows.length === 0) return { transactions: [], skipped: 0, truncated: false, error: 'The file is empty.' };

    // Find the header row (some banks put account info above it).
    let headerIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      if (rows[i].some(function (c) { return /date/i.test(c); }) &&
          rows[i].some(function (c) { return /amount|debit|credit|withdrawal|deposit/i.test(c); })) {
        headerIndex = i;
        break;
      }
    }

    let col;
    if (headerIndex >= 0) {
      const h = rows[headerIndex];
      col = {
        date: findColumn(h, [/^(transaction|trans\.?|posted|posting)?\s*date$/i, /date/i]),
        desc: findColumn(h, [/^description$/i, /desc/i, /payee|merchant|memo|name|details|narrative/i]),
        amount: findColumn(h, [/^amount$/i, /^amount/i, /amount/i]),
        debit: findColumn(h, [/debit|withdrawal|outflow|money out|paid out|charge/i]),
        credit: findColumn(h, [/credit|deposit|inflow|money in|paid in|payment/i]),
        type: findColumn(h, [/^(transaction )?type$/i, /debit\/credit|dr\/cr/i])
      };
      if (col.amount >= 0) { if (col.debit === col.amount) col.debit = -1; if (col.credit === col.amount) col.credit = -1; }
      if (col.type === col.debit || col.type === col.credit) col.type = -1;
    } else {
      // No header (e.g. some banks): guess from the first row's contents.
      const r = rows[0];
      col = { date: -1, desc: -1, amount: -1, debit: -1, credit: -1, type: -1 };
      r.forEach(function (c, i) {
        if (col.date < 0 && cellDate(c)) col.date = i;
        else if (col.amount < 0 && parseMoneyCell(c) && /\./.test(c)) col.amount = i;
      });
      let longest = 0;
      r.forEach(function (c, i) {
        if (i !== col.date && i !== col.amount && c.trim().length > longest && !parseMoneyCell(c)) { longest = c.trim().length; col.desc = i; }
      });
    }

    if (col.date < 0 || (col.amount < 0 && col.debit < 0 && col.credit < 0)) {
      return { transactions: [], skipped: rows.length, truncated: false,
        error: 'Couldn\'t find the date and amount columns in this CSV.' };
    }

    // With one Amount column: if any amount is negative, negatives are money
    // out (bank exports). If none are, it's likely a credit card export where
    // charges are positive. Either way the user can swap on the review screen.
    const dataRows = rows.slice(headerIndex + 1);
    const hasNegative = col.amount >= 0 && dataRows.some(function (r) {
      const v = parseMoneyCell(r[col.amount]);
      return v && v.sign < 0;
    });

    const out = [];
    let skipped = 0;
    dataRows.forEach(function (r) {
      const date = cellDate(r[col.date]);
      const description = col.desc >= 0 ? String(r[col.desc] || '') : '';
      let money = null;
      let direction = null;
      if (col.debit >= 0 || col.credit >= 0) {
        const debit = col.debit >= 0 ? parseMoneyCell(r[col.debit]) : null;
        const credit = col.credit >= 0 ? parseMoneyCell(r[col.credit]) : null;
        if (debit && debit.cents > 0) { money = debit; direction = 'out'; }
        else if (credit && credit.cents > 0) { money = credit; direction = 'in'; }
      }
      if (!money && col.amount >= 0) {
        money = parseMoneyCell(r[col.amount]);
        if (money) {
          const type = col.type >= 0 ? String(r[col.type] || '') : '';
          if (/debit|withdrawal|purchase|sale|charge|fee/i.test(type)) direction = 'out';
          else if (/credit|deposit|refund|return/i.test(type)) direction = 'in';
          else if (money.sign < 0) direction = 'out';
          else if (hasNegative || money.sign > 0) direction = 'in';
          else direction = INCOME_WORDS.test(description) ? 'in' : 'out';
        }
      }
      if (!date || !money || money.cents === 0 || SKIP_LINE.test(description)) { skipped++; return; }
      out.push(finish(date, description || '(no description)', money.cents, direction));
    });
    return { transactions: out.slice(0, MAX_ROWS), skipped: skipped, truncated: out.length > MAX_ROWS };
  }

  // ---- Suggestions for the review screen ----

  const CATEGORY_RULES = [
    [/uber eats|doordash|grubhub|postmates|mcdonald|burger|wendy|taco bell|chick-?fil|chipotle|subway|starbucks|dunkin|pizza|domino|kfc|panera|restaurant|cafe|coffee|grill|diner|bar & grill|sonic|arby|popeyes|five guys|jersey mike/i, 'Food'],
    [/kroger|aldi|safeway|publix|whole foods|trader joe|heb\b|h-e-b|wegmans|food lion|giant|meijer|grocery|market|costco|sam'?s club|walmart|wal-mart/i, 'Groceries'],
    [/shell|exxon|mobil|chevron|bp\b|sunoco|marathon|speedway|circle k|wawa|sheetz|valero|citgo|76\b|quiktrip|qt\b|racetrac|fuel|gas/i, 'Gas'],
    [/uber|lyft|transit|metro|parking|toll|amtrak|airline|delta|united|southwest|american air/i, 'Transport'],
    [/netflix|spotify|hulu|disney\+?|apple\.com|icloud|youtube|prime video|max\.com|hbo|paramount|peacock|xbox|playstation|patreon|subscription/i, 'Subscriptions'],
    [/verizon|at&t|t-mobile|tmobile|cricket|mint mobile|visible/i, 'Phone'],
    [/electric|water|utility|comcast|xfinity|spectrum|internet|insurance|geico|progressive|state farm/i, 'Bills'],
    [/rent|apartment|property|leasing/i, 'Rent'],
    [/amazon|amzn|target|best buy|ebay|etsy|shein|temu|nike|old navy|tj ?maxx|marshalls|ross\b|mall/i, 'Shopping'],
    [/cvs|walgreens|pharmacy|rite aid|doctor|dental|clinic|hospital|medical/i, 'Health'],
    [/movie|cinema|amc\b|regal|steam|game|ticketmaster|stubhub|concert/i, 'Fun']
  ];

  function guessCategory(description) {
    for (let i = 0; i < CATEGORY_RULES.length; i++) {
      if (CATEGORY_RULES[i][0].test(description)) return CATEGORY_RULES[i][1];
    }
    return 'Other';
  }

  function guessSource(description) {
    if (/refund|return|reversal/i.test(description)) return 'Refund';
    if (/interest/i.test(description)) return 'Interest';
    if (/zelle|venmo|cash ?app|paypal/i.test(description)) return 'Transfer in';
    if (PAYCHECK_WORDS.test(description)) return 'Paycheck';
    return 'Deposit';
  }

  /*
   * Adds review hints to each transaction:
   *   include  - pre-ticked on the review screen
   *   reason   - why it isn't pre-ticked (shown to the user)
   *   category / source - suggested values
   * `state` is used to spot entries that were already logged.
   */
  function prepareForReview(transactions, state) {
    const existing = {};
    state.expenses.forEach(function (e) { existing['out|' + e.date + '|' + e.amountCents] = true; });
    (state.incomes || []).forEach(function (x) { existing['in|' + x.date + '|' + x.amountCents] = true; });
    return transactions.map(function (t) {
      const r = Object.assign({}, t, { include: true, reason: '' });
      r.category = guessCategory(t.description);
      r.source = guessSource(t.description);
      if (existing[t.direction + '|' + t.date + '|' + t.amountCents]) {
        r.include = false;
        r.reason = 'Possible duplicate: an entry with this date and amount already exists.';
      } else if (TRANSFER_WORDS.test(t.description)) {
        r.include = false;
        r.reason = 'Looks like a transfer or card payment between your own accounts, not real spending or income.';
      } else if (t.direction === 'in' && PAYCHECK_WORDS.test(t.description)) {
        r.include = false;
        r.reason = 'Looks like a paycheck. Your pay is already counted from the hours you log.';
      }
      return r;
    });
  }

  // ---- Pay stubs, time cards and receipts (PDF text or photo text via OCR) ----

  // Text read from photos is noisy: "S12.50" for "$12.50", "1.234.56" for
  // "1,234.56", letter O for zero inside numbers.
  function cleanOcrLine(line) {
    return String(line)
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/\bS(?=\d)/g, '$')
      .replace(/(\d)[Oo](?=\d|[.,]\d\d\b)/g, function (m, d) { return d + '0'; })
      .replace(/\b(\d{1,3})\.(\d{3})[.,](\d{2})\b/g, '$1,$2.$3')
      .replace(/(\d),(\d{2})\b(?![,\d])/g, '$1.$2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const FULL_DATE_RE = new RegExp('(\\d{4})-(\\d{1,2})-(\\d{1,2})|(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4}|\\d{2})(?![\\d])|' +
    MONTH_RE + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}', 'gi');

  // All full dates (with a year) in a piece of text, as YYYY-MM-DD.
  function datesIn(text) {
    const out = [];
    FULL_DATE_RE.lastIndex = 0;
    let m;
    while ((m = FULL_DATE_RE.exec(text))) {
      const d = readDate(m[0].replace(/\./g, '/'));
      if (d && d.y && validDate(d.y, d.m, d.d)) out.push(d.y + '-' + pad(d.m) + '-' + pad(d.d));
    }
    return out;
  }

  // Money values with two decimals, in order, as cents (sign ignored).
  function moneyIn(text) {
    const out = [];
    const re = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;
    let m;
    while ((m = re.exec(text))) out.push(parseInt(m[1].replace(/,/g, ''), 10) * 100 + parseInt(m[2], 10));
    return out;
  }

  // The first amount on the line with `label` (after the label), or on the next line.
  function labeledAmount(lines, label) {
    for (let i = 0; i < lines.length; i++) {
      const m = label.exec(lines[i]);
      if (!m) continue;
      const after = moneyIn(lines[i].slice(m.index + m[0].length));
      if (after.length) return after[0];
      if (i + 1 < lines.length) {
        const next = moneyIn(lines[i + 1]);
        if (next.length) return next[0];
      }
    }
    return null;
  }

  function labeledDate(lines, label) {
    for (let i = 0; i < lines.length; i++) {
      const m = label.exec(lines[i]);
      if (!m) continue;
      const after = datesIn(lines[i].slice(m.index + m[0].length));
      if (after.length) return after[0];
      if (i + 1 < lines.length && datesIn(lines[i + 1]).length) return datesIn(lines[i + 1])[0];
    }
    return null;
  }

  const EARNING_LINE = /^(regular|reg\b|hourly|base pay|overtime|ot\b|double ?time|holiday|hol\b|vacation|pto|sick|bonus hours)/i;

  // On an earnings row, finds rate x hours = amount among the first numbers,
  // so year-to-date columns aren't mistaken for this period.
  function earningRow(line) {
    const nums = (line.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+/g) || [])
      .map(function (t) { return parseFloat(t.replace(/,/g, '')); }).slice(0, 5);
    for (let i = 0; i < nums.length; i++) {
      for (let j = 0; j < nums.length; j++) {
        for (let k = Math.max(i, j) + 1; k < nums.length; k++) {
          if (i === j) continue;
          const rate = nums[i];
          const hours = nums[j];
          const amount = nums[k];
          if (!(rate > 0 && hours > 0 && hours <= 400 && amount > 0)) continue;
          if (Math.abs(rate * hours - amount) <= Math.max(0.02, amount * 0.005)) {
            return { rateCents: Math.round(rate * 100), hours: hours, amountCents: Math.round(amount * 100) };
          }
        }
      }
    }
    return null;
  }

  function parsePayStub(rawLines) {
    const lines = rawLines.map(cleanOcrLine).filter(Boolean);
    const out = { payDate: null, periodStart: null, periodEnd: null, hours: null, rateCents: null, grossCents: null, netCents: null };
    out.payDate = labeledDate(lines, /\b(pay|check|advice|deposit)\s*date\b/i);
    out.periodStart = labeledDate(lines, /\bperiod\s*(beginning|starting|start|begin|from)\b/i);
    out.periodEnd = labeledDate(lines, /\bperiod\s*(ending|end|to|thru|through)\b/i);
    if (!out.periodStart || !out.periodEnd) {
      for (let i = 0; i < lines.length; i++) {
        if (!/\bpay\s*period\b|\bperiod\b/i.test(lines[i])) continue;
        const d = datesIn(lines[i]);
        if (d.length >= 2 && d[0] <= d[1]) { out.periodStart = d[0]; out.periodEnd = d[1]; break; }
      }
    }
    out.netCents = labeledAmount(lines, /\b(net\s*pay|net\s*check|net\s*amount|take[\s-]?home(\s*pay)?|net\s*earnings)\b/i);
    out.grossCents = labeledAmount(lines, /\b(gross\s*pay|gross\s*earnings|total\s*gross|gross\s*wages|gross)\b/i);

    let hours = 0;
    let rows = 0;
    lines.forEach(function (line) {
      if (!EARNING_LINE.test(line)) return;
      const row = earningRow(line);
      if (!row) return;
      hours += row.hours;
      rows++;
      if (out.rateCents == null && /^(regular|reg\b|hourly|base pay)/i.test(line)) out.rateCents = row.rateCents;
    });
    if (rows) out.hours = Math.round(hours * 100) / 100;
    if (out.hours == null) {
      for (let i = 0; i < lines.length; i++) {
        const m = /\btotal\s*hours(?:\s*worked)?\b\D{0,10}(\d+(?:\.\d+)?)/i.exec(lines[i]);
        if (m) { out.hours = parseFloat(m[1]); break; }
      }
    }
    return out;
  }

  // Times like "8:02 AM", "08:02", "16:31", "4:31p".
  const TIME_RE = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?m?\.?|p\.?m?\.?)?(?![\d:])/gi;

  function timesIn(text) {
    const out = [];
    TIME_RE.lastIndex = 0;
    let m;
    while ((m = TIME_RE.exec(text))) {
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      if (min > 59 || h > 23) continue;
      const ap = (m[3] || '').toLowerCase();
      if (ap.startsWith('p') && h < 12) h += 12;
      if (ap.startsWith('a') && h === 12) h = 0;
      if (!ap && h > 23) continue;
      out.push({ minutes: h * 60 + min, text: pad(h) + ':' + pad(min), index: m.index });
    }
    return out;
  }

  function parseTimeCard(rawLines) {
    const lines = rawLines.map(cleanOcrLine).filter(Boolean);
    const out = { date: null, start: null, end: null, breakMinutes: 0, hours: null };
    for (let i = 0; i < lines.length && !out.date; i++) {
      const d = datesIn(lines[i]);
      if (d.length) out.date = d[0];
    }
    const IN = /\b(clock(?:ed)?[\s-]*in|time[\s-]*in|punch(?:ed)?[\s-]*in|start(?:ed)?|in)\b/i;
    const OUT = /\b(clock(?:ed)?[\s-]*out|time[\s-]*out|punch(?:ed)?[\s-]*out|end(?:ed)?|out)\b/i;
    const BREAK = /\b(lunch|break|meal)\b/i;
    let ins = [];
    let outs = [];
    const all = [];
    lines.forEach(function (line) {
      const t = timesIn(line);
      t.forEach(function (x) { all.push(x); });
      if (!t.length) return;
      if (BREAK.test(line)) {
        if (t.length >= 2) out.breakMinutes += Math.max(0, t[1].minutes - t[0].minutes);
        return;
      }
      const hasOut = OUT.test(line);
      const hasIn = IN.test(line.replace(new RegExp(OUT.source, 'gi'), ''));
      if (hasIn && hasOut && t.length >= 2) {
        // "IN 08:00 AM  OUT 04:30 PM" on one line: whichever label comes first.
        const inFirst = line.search(IN) < line.search(OUT);
        ins.push(inFirst ? t[0] : t[1]);
        outs.push(inFirst ? t[1] : t[0]);
      } else if (hasOut && !hasIn) outs = outs.concat(t);
      else if (IN.test(line)) ins = ins.concat(t);
    });
    if (!out.breakMinutes) {
      const m = /\b(lunch|break|meal)\b\D{0,12}(\d{1,3})\s*(m|min|mins|minutes)\b/i.exec(lines.join(' '));
      if (m) out.breakMinutes = parseInt(m[2], 10);
    }
    if (ins.length && outs.length) {
      out.start = ins[0].text;
      out.end = outs[outs.length - 1].text;
      // Clock out for lunch and back in: the gap between them is unpaid.
      if (!out.breakMinutes && ins.length >= 2 && outs.length >= 2) {
        out.breakMinutes = Math.max(0, ins[1].minutes - outs[0].minutes);
      }
    } else if (all.length >= 2) {
      out.start = all[0].text;
      out.end = all[all.length - 1].text;
      if (all.length === 4) out.breakMinutes = Math.max(0, all[2].minutes - all[1].minutes);
    }
    const total = /\b(total(?:\s*hours)?|hours\s*worked|hrs\s*worked|total\s*hrs)\b\D{0,10}(\d{1,2}(?:\.\d{1,2})?|\d{1,2}:\d{2})\b/i.exec(lines.join(' '));
    if (total) {
      const v = total[2];
      out.hours = v.indexOf(':') !== -1
        ? Math.round((parseInt(v, 10) + parseInt(v.split(':')[1], 10) / 60) * 100) / 100
        : parseFloat(v);
    }
    return out;
  }

  function parseReceipt(rawLines) {
    const lines = rawLines.map(cleanOcrLine).filter(Boolean);
    const out = { date: null, totalCents: null, merchant: '', category: 'Other' };
    for (let i = 0; i < lines.length && !out.date; i++) {
      const d = datesIn(lines[i]);
      if (d.length) out.date = d[0];
    }
    // The grand total: the largest amount on a "total" line that isn't a
    // subtotal, tax, savings or item count.
    let best = null;
    lines.forEach(function (line, i) {
      if (!/\b(total|amount due|balance due|amount charged|charged|grand total)\b/i.test(line)) return;
      if (/\b(sub[\s-]?total|total\s*(tax|savings|saved|discount|items?|qty|quantity)|tax\s*total|you saved)\b/i.test(line)) return;
      let amounts = moneyIn(line);
      if (!amounts.length && i + 1 < lines.length) amounts = moneyIn(lines[i + 1]);
      if (!amounts.length) return;
      const v = amounts[amounts.length - 1];
      if (best == null || v > best) best = v;
    });
    out.totalCents = best;
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const l = lines[i];
      if (/[a-z]{3,}/i.test(l) && !/receipt|welcome|thank|store\s*#|tel|phone|www\.|http|^\d/i.test(l)) {
        out.merchant = l.replace(/[^\w &'.,#-]/g, '').trim().slice(0, 60);
        break;
      }
    }
    out.category = guessCategory(out.merchant + ' ' + lines.slice(0, 8).join(' '));
    return out;
  }

  // Best guess at what kind of document some text came from.
  function classify(rawLines) {
    const text = rawLines.join('\n');
    const score = {
      paystub: (/(net\s*pay|gross\s*pay|earnings\s*statement|pay\s*statement|pay\s*stub|ytd|year\s*to\s*date|federal\s*income\s*tax|social\s*security|medicare)/gi.exec(text) ? 1 : 0) +
        (text.match(/net\s*pay|gross\s*pay|earnings|deductions|ytd|medicare|social\s*security|withholding/gi) || []).length,
      timecard: (text.match(/clock(?:ed)?[\s-]*(in|out)|time[\s-]*(in|out)|punch|time\s*card|timesheet|\bin\b[^\n]{0,12}\d{1,2}:\d{2}|\bout\b[^\n]{0,12}\d{1,2}:\d{2}/gi) || []).length * 2,
      statement: (text.match(/beginning\s*balance|ending\s*balance|statement\s*period|account\s*summary|deposits\s*(and|&)\s*(other\s*)?(additions|credits)|withdrawals|daily\s*balance/gi) || []).length * 2,
      receipt: (text.match(/sub[\s-]?total|\btotal\b|\btax\b|change\s*due|cash\b|visa|mastercard|debit\s*card|approved|auth(orization)?\s*(code|#)|items?\s*sold/gi) || []).length
    };
    let best = 'other';
    let top = 1;
    Object.keys(score).forEach(function (k) { if (score[k] > top) { top = score[k]; best = k; } });
    return best;
  }

  const api = {
    cleanOcrLine: cleanOcrLine,
    parsePayStub: parsePayStub,
    parseTimeCard: parseTimeCard,
    parseReceipt: parseReceipt,
    classify: classify,
    readDate: readDate,
    findAmounts: findAmounts,
    parseMoneyCell: parseMoneyCell,
    fromTextLines: fromTextLines,
    parseCsv: parseCsv,
    fromCsv: fromCsv,
    guessCategory: guessCategory,
    prepareForReview: prepareForReview,
    MAX_ROWS: MAX_ROWS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoneyImport = api;
})(typeof window !== 'undefined' ? window : this);
