/* Money Tracker UI. All math lives in calc.js (window.MoneyCalc). */
(function () {
  'use strict';

  const C = window.MoneyCalc;
  const STORAGE_KEY = 'moneyTracker.v1';
  const UI_KEY = 'moneyTracker.ui';
  const DEFAULT_CATEGORIES = ['Food', 'Groceries', 'Transport', 'Gas', 'Rent', 'Bills', 'Phone',
    'Fun', 'Shopping', 'Subscriptions', 'Health', 'Gifts', 'Other'];

  const $ = function (sel) { return document.querySelector(sel); };

  // ---------- Storage ----------

  function loadState() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return C.defaultState();
    }
    if (!raw) return C.defaultState();
    try {
      return C.validateState(JSON.parse(raw));
    } catch (e) {
      if (e.code === 'NEWER_VERSION') {
        // This is an old cached copy of the app. Stop before it can overwrite
        // data saved by the newer version.
        document.querySelector('main').textContent = 'This copy of the app is out of date. Please reload the page to update it.';
        throw e;
      }
      // Keep the unreadable data instead of silently overwriting it.
      try { localStorage.setItem(STORAGE_KEY + '.unreadable-' + Date.now(), raw); } catch (ignored) { /* full */ }
      setTimeout(function () {
        toast('Saved data could not be read, so the app started fresh. The old data was kept as a copy.');
      }, 0);
      return C.defaultState();
    }
  }

  // fromCloud: the change came from syncing, so don't trigger another sync.
  function saveState(fromCloud) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!fromCloud) window.dispatchEvent(new Event('moneytracker:changed'));
      return true;
    } catch (e) {
      toast('Could not save. Your browser storage may be full or turned off (e.g. private browsing).');
      return false;
    }
  }

  function loadUi() {
    const ui = { period: 'month', refDate: C.today(), lastAccount: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      if (['week', 'month', 'year', 'all'].indexOf(saved.period) !== -1) ui.period = saved.period;
      if (saved.lastAccount && typeof saved.lastAccount === 'object') ui.lastAccount = saved.lastAccount;
    } catch (e) { /* use defaults */ }
    return ui;
  }

  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ period: ui.period, lastAccount: ui.lastAccount })); } catch (e) { /* optional */ }
  }

  let state = loadState();
  const ui = loadUi();
  let editingShiftId = null;
  let editingExpenseId = null;
  let editingIncomeId = null;

  // ---------- Formatting ----------

  let moneyFormatter = null;
  let moneyFormatterCurrency = null;
  function money(cents) {
    if (moneyFormatterCurrency !== state.settings.currency) {
      moneyFormatterCurrency = state.settings.currency;
      moneyFormatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: moneyFormatterCurrency });
    }
    return moneyFormatter.format(cents / 100);
  }

  function hoursText(h) {
    const rounded = Math.round(h * 100) / 100;
    return rounded + (rounded === 1 ? ' hr' : ' hrs');
  }

  function prettyDate(dateStr, opts) {
    return C.parseDate(dateStr).toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function periodLabel(range) {
    if (ui.period === 'all') return 'Everything';
    if (ui.period === 'year') return range.start.slice(0, 4);
    if (ui.period === 'month') return prettyDate(range.start, { month: 'long', year: 'numeric' });
    const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
    return prettyDate(range.start, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' – ' + prettyDate(range.end, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Builds a DOM element. Text is always set via textContent (never innerHTML)
  // so notes and categories can't inject markup.
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (k === 'className') node.className = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // ---------- Toast with optional Undo ----------

  let toastTimer = null;
  function toast(message, undo) {
    const t = $('#toast');
    t.textContent = '';
    t.appendChild(el('span', { text: message }));
    if (undo) {
      t.appendChild(el('button', {
        type: 'button', className: 'toast-undo', text: 'Undo',
        onclick: function () { undo(); t.hidden = true; }
      }));
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, undo ? 6000 : 3500);
  }

  // ---------- Navigation ----------

  const VIEWS = ['dashboard', 'work', 'spending', 'settings'];

  let currentView = null;
  function showView(name) {
    if (VIEWS.indexOf(name) === -1) name = 'dashboard';
    if (name === currentView) return;
    currentView = name;
    VIEWS.forEach(function (v) {
      $('#view-' + v).hidden = v !== name;
    });
    document.querySelectorAll('.tab').forEach(function (tab) {
      if (tab.dataset.view === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    if (name === 'settings') fillSettingsForm();
  }

  function routeFromHash() {
    showView(location.hash.replace('#', '') || 'dashboard');
  }

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      location.hash = tab.dataset.view === 'dashboard' ? '' : tab.dataset.view;
      routeFromHash(); // switch now rather than waiting for the hashchange event
      window.scrollTo(0, 0);
    });
  });
  window.addEventListener('hashchange', routeFromHash);

  // ---------- Period controls ----------

  function currentRange() {
    return C.periodRange(ui.period, ui.refDate, state.settings.weekStart);
  }

  $('#period-select').addEventListener('change', function (e) {
    ui.period = e.target.value;
    ui.refDate = C.today();
    saveUi();
    render();
  });
  $('#period-prev').addEventListener('click', function () {
    ui.refDate = C.stepPeriod(ui.period, ui.refDate, -1);
    render();
  });
  $('#period-next').addEventListener('click', function () {
    ui.refDate = C.stepPeriod(ui.period, ui.refDate, 1);
    render();
  });
  $('#period-label').addEventListener('click', function () {
    ui.refDate = C.today();
    render();
  });

  // ---------- Rendering ----------

  function render() {
    const range = currentRange();
    const sum = C.summarize(state, range);
    const isCurrent = ui.period === 'all' || C.inRange(C.today(), range);

    $('#period-select').value = ui.period;
    const label = $('#period-label');
    label.textContent = periodLabel(range) + (isCurrent ? '' : ' · back to today');
    label.classList.toggle('clickable', !isCurrent);
    $('#period-prev').disabled = ui.period === 'all';
    $('#period-next').disabled = ui.period === 'all';

    renderAccountSelects();
    renderDashboard(sum);
    renderAccountBreakdown(range);
    renderShiftList(range);
    renderIncomeList(range);
    renderExpenseList(range);
    renderAccountsSettings();
    renderCategoryOptions();
    updateShiftPreview();
    updateExpensePreview();
  }

  function renderDashboard(sum) {
    const s = state.settings;

    // Hero: what's left of the spending budget.
    const over = sum.remaining < 0;
    $('#hero-remaining').textContent = money(Math.abs(sum.remaining));
    $('#hero-remaining').classList.toggle('negative', over);
    document.querySelector('.hero-label').textContent = over ? 'Over your spending budget by' : 'Left to spend';

    const used = Number.isFinite(sum.usedPercent) ? sum.usedPercent : 100;
    const fill = $('#budget-meter-fill');
    fill.style.width = Math.min(used, 100) + '%';
    fill.classList.toggle('warn', used >= 80 && used < 100);
    fill.classList.toggle('over', used >= 100 && sum.spent > 0);
    $('#budget-meter').setAttribute('aria-valuenow', String(Math.round(Math.min(used, 100))));

    let detail = 'Spent ' + money(sum.spent) + ' of ' + money(sum.spendable);
    if (sum.spendable > 0) detail += ' (' + Math.round(sum.usedPercent) + '%)';
    $('#hero-detail').textContent = detail;

    // Spend % slider and split.
    $('#spend-slider').value = s.spendPercent;
    $('#spend-percent-out').textContent = formatPercent(s.spendPercent);
    $('#save-percent-out').textContent = formatPercent(100 - s.spendPercent);
    $('#split-spend').textContent = money(sum.spendable);
    $('#split-save').textContent = money(sum.savings);

    // Stat tiles.
    const tiles = [
      ['Hours worked', hoursText(sum.hours), sum.shiftCount + (sum.shiftCount === 1 ? ' shift' : ' shifts')],
      ['Earned', money(sum.gross), 'before taxes']
    ];
    if (s.taxPercent > 0) {
      tiles.push(['Taxes & deductions', money(sum.taxes), 'estimated at ' + formatPercent(s.taxPercent) + '%']);
    }
    if (sum.incomeCount > 0) {
      tiles.push(['Other income', money(sum.otherIncome), sum.incomeCount + (sum.incomeCount === 1 ? ' entry' : ' entries')]);
    }
    tiles.push(['Take-home pay', money(sum.takeHome), sum.otherIncome > 0 ? 'pay + other income'
      : sum.hours > 0 ? money(sum.takeHomePerHour) + ' per hour' : '']);
    tiles.push(['Spent', money(sum.spent), sum.expenseCount + (sum.expenseCount === 1 ? ' purchase' : ' purchases')]);
    tiles.push(['Saved', money(sum.takeHome - sum.spent), 'take-home minus spending']);

    const stats = $('#stats');
    stats.textContent = '';
    tiles.forEach(function (t) {
      stats.appendChild(el('div', { className: 'stat' + (t[0] === 'Saved' && sum.takeHome - sum.spent < 0 ? ' negative' : '') }, [
        el('div', { className: 'stat-name', text: t[0] }),
        el('div', { className: 'stat-value', text: t[1] }),
        t[2] ? el('div', { className: 'stat-sub', text: t[2] }) : null
      ]));
    });

    // Category breakdown.
    const box = $('#category-breakdown');
    box.textContent = '';
    if (sum.byCategory.length === 0) {
      box.appendChild(el('p', { className: 'muted', text: 'No spending logged in this period.' }));
    } else {
      sum.byCategory.forEach(function (c) {
        const pct = (c.cents / sum.spent) * 100;
        const bar = el('div', { className: 'bar-fill' });
        bar.style.width = pct + '%';
        box.appendChild(el('div', { className: 'bar-row' }, [
          el('div', { className: 'bar-top' }, [
            el('span', { text: c.name }),
            el('span', { text: money(c.cents) + ' · ' + Math.round(pct) + '%' })
          ]),
          el('div', { className: 'bar' }, [bar])
        ]));
      });
    }

    $('#onboarding').hidden = state.shifts.length > 0 || state.expenses.length > 0 || state.incomes.length > 0;
  }

  // ---------- Accounts ----------

  function accountName(id) {
    const a = id && state.accounts.find(function (x) { return x.id === id; });
    return a ? a.name : '';
  }

  // Which remembered account a select should start on (per form, per device).
  function selectKey(select) {
    const form = select.closest('form');
    return form ? form.id : select.id;
  }

  function hasOption(select, value) {
    return Array.prototype.some.call(select.options, function (o) { return o.value === value; });
  }

  function applyLastAccount(select) {
    const last = ui.lastAccount[selectKey(select)] || '';
    select.value = hasOption(select, last) ? last : '';
  }

  function rememberAccount(key, id) {
    ui.lastAccount[key] = id;
    saveUi();
  }

  function renderAccountSelects() {
    document.querySelectorAll('.account-select').forEach(function (select) {
      const keep = select.dataset.ready ? select.value : null;
      select.textContent = '';
      select.appendChild(el('option', { value: '', text: state.accounts.length ? 'No account' : 'No accounts yet' }));
      state.accounts.forEach(function (a) { select.appendChild(el('option', { value: a.id, text: a.name })); });
      if (keep !== null && hasOption(select, keep)) select.value = keep;
      else applyLastAccount(select);
      select.dataset.ready = '1';
    });
    document.querySelectorAll('.no-accounts-hint').forEach(function (hint) {
      hint.hidden = state.accounts.length > 0;
    });
  }

  function renderAccountBreakdown(range) {
    const rows = C.accountSummary(state, range).filter(function (r) { return r.id || r.count > 0; });
    const card = $('#account-breakdown-card');
    card.hidden = state.accounts.length === 0;
    if (card.hidden) return;
    const box = $('#account-breakdown');
    box.textContent = '';
    rows.forEach(function (r) {
      box.appendChild(el('div', { className: 'acct-row' }, [
        el('div', { className: 'acct-name', text: r.name || 'No account' }),
        el('div', { className: 'acct-figures' }, [
          el('span', { className: 'acct-in', text: '+' + money(r.moneyIn) }),
          el('span', { className: 'acct-out', text: '−' + money(r.moneyOut) }),
          el('span', { className: 'acct-net' + (r.net < 0 ? ' negative' : ''), text: (r.net < 0 ? '−' : '') + money(Math.abs(r.net)) })
        ])
      ]));
    });
  }

  function renderAccountsSettings() {
    const list = $('#accounts-list');
    list.textContent = '';
    if (state.accounts.length === 0) {
      list.appendChild(el('li', { className: 'empty', text: 'No accounts yet.' }));
      return;
    }
    state.accounts.forEach(function (a) {
      list.appendChild(el('li', { className: 'entry account-entry' }, [
        el('div', { className: 'entry-main' }, [el('div', { className: 'entry-title', text: a.name })]),
        el('div', { className: 'entry-actions' }, [
          el('button', { type: 'button', className: 'link-btn', text: 'Rename', 'aria-label': 'Rename ' + a.name, onclick: function () { renameAccount(a.id); } }),
          el('button', { type: 'button', className: 'link-btn danger-text', text: 'Delete', 'aria-label': 'Delete ' + a.name, onclick: function () { deleteAccount(a.id); } })
        ])
      ]));
    });
  }

  function cleanAccountName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  function nameTaken(name, exceptId) {
    return state.accounts.some(function (a) { return a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase(); });
  }

  $('#account-form').addEventListener('input', function () { $('#account-error').textContent = ''; });

  $('#account-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const name = cleanAccountName(e.target.name.value);
    const errorBox = $('#account-error');
    errorBox.textContent = '';
    if (!name) { errorBox.textContent = 'Type a name, like "Chase Checking".'; return; }
    if (/\d{6,}/.test(name)) { errorBox.textContent = 'Please use a nickname, not an account or card number.'; return; }
    if (nameTaken(name)) { errorBox.textContent = 'You already have an account with that name.'; return; }
    state.accounts.push({ id: C.newId(), name: name, updatedAt: Date.now() });
    e.target.reset();
    saveState();
    render();
    toast('Added ' + name + '.');
  });

  function renameAccount(id) {
    const a = state.accounts.find(function (x) { return x.id === id; });
    if (!a) return;
    const answer = window.prompt('New name for "' + a.name + '":', a.name);
    if (answer === null) return;
    const name = cleanAccountName(answer);
    if (!name || name === a.name) return;
    if (/\d{6,}/.test(name)) { toast('Please use a nickname, not an account or card number.'); return; }
    if (nameTaken(name, id)) { toast('You already have an account with that name.'); return; }
    a.name = name;
    a.updatedAt = Date.now();
    saveState();
    render();
  }

  function deleteAccount(id) {
    const a = state.accounts.find(function (x) { return x.id === id; });
    if (!a) return;
    const used = state.shifts.concat(state.expenses, state.incomes).filter(function (x) { return x.accountId === id; }).length;
    const ok = window.confirm('Delete "' + a.name + '"?' + (used
      ? '\n\nYour ' + used + (used === 1 ? ' entry' : ' entries') + ' linked to it will be kept and show as "No account".'
      : ''));
    if (!ok) return;
    state.accounts = state.accounts.filter(function (x) { return x.id !== id; });
    state.deleted[id] = Date.now();
    saveState();
    render();
  }

  function formatPercent(p) {
    return String(Math.round(p * 10) / 10);
  }

  function sortNewestFirst(list) {
    // Newest date first; within a day, most recently added first.
    return list
      .map(function (item, i) { return { item: item, i: i }; })
      .sort(function (a, b) {
        if (a.item.date !== b.item.date) return a.item.date < b.item.date ? 1 : -1;
        return b.i - a.i;
      })
      .map(function (x) { return x.item; });
  }

  function entryRow(opts) {
    return el('li', { className: 'entry' + (opts.editing ? ' editing' : '') }, [
      el('div', { className: 'entry-main' }, [
        el('div', { className: 'entry-title', text: opts.title }),
        el('div', { className: 'entry-sub', text: opts.sub })
      ]),
      el('div', { className: 'entry-amount', text: opts.amount }),
      el('div', { className: 'entry-actions' }, [
        el('button', { type: 'button', className: 'link-btn', text: 'Edit', 'aria-label': 'Edit ' + opts.label, onclick: opts.onEdit }),
        el('button', { type: 'button', className: 'link-btn danger-text', text: 'Delete', 'aria-label': 'Delete ' + opts.label, onclick: opts.onDelete })
      ])
    ]);
  }

  function renderShiftList(range) {
    const list = $('#shift-list');
    list.textContent = '';
    const items = sortNewestFirst(state.shifts.filter(function (s) { return C.inRange(s.date, range); }));
    if (items.length === 0) {
      list.appendChild(el('li', { className: 'empty', text: 'No hours logged in this period.' }));
      return;
    }
    items.forEach(function (s) {
      let sub = hoursText(s.hours) + ' × ' + money(s.rateCents);
      if (s.tipsCents) sub += ' + ' + money(s.tipsCents) + ' tips';
      if (accountName(s.accountId)) sub += ' → ' + accountName(s.accountId);
      if (s.note) sub += ' · ' + s.note;
      list.appendChild(entryRow({
        title: prettyDate(s.date),
        sub: sub,
        amount: money(C.shiftEarningsCents(s)),
        label: 'hours on ' + prettyDate(s.date),
        editing: s.id === editingShiftId,
        onEdit: function () { startEditShift(s.id); },
        onDelete: function () { deleteItem('shifts', s.id, 'Hours deleted.'); }
      }));
    });
  }

  function renderExpenseList(range) {
    const list = $('#expense-list');
    list.textContent = '';
    const items = sortNewestFirst(state.expenses.filter(function (e) { return C.inRange(e.date, range); }));
    if (items.length === 0) {
      list.appendChild(el('li', { className: 'empty', text: 'No spending logged in this period.' }));
      return;
    }
    items.forEach(function (e) {
      list.appendChild(entryRow({
        title: e.category + (e.note ? ' · ' + e.note : ''),
        sub: prettyDate(e.date) + (accountName(e.accountId) ? ' · ' + accountName(e.accountId) : ''),
        amount: money(e.amountCents),
        label: e.category + ' on ' + prettyDate(e.date),
        editing: e.id === editingExpenseId,
        onEdit: function () { startEditExpense(e.id); },
        onDelete: function () { deleteItem('expenses', e.id, 'Spending deleted.'); }
      }));
    });
  }

  function renderIncomeList(range) {
    const list = $('#income-list');
    list.textContent = '';
    const items = sortNewestFirst(state.incomes.filter(function (x) { return C.inRange(x.date, range); }));
    if (items.length === 0) {
      list.appendChild(el('li', { className: 'empty', text: 'No other income in this period.' }));
      return;
    }
    items.forEach(function (x) {
      list.appendChild(entryRow({
        title: x.source + (x.note ? ' · ' + x.note : ''),
        sub: prettyDate(x.date) + (accountName(x.accountId) ? ' → ' + accountName(x.accountId) : ''),
        amount: '+' + money(x.amountCents),
        label: x.source + ' on ' + prettyDate(x.date),
        editing: x.id === editingIncomeId,
        onEdit: function () { startEditIncome(x.id); },
        onDelete: function () { deleteItem('incomes', x.id, 'Income deleted.'); }
      }));
    });
  }

  function renderCategoryOptions() {
    const used = state.expenses.map(function (e) { return e.category; });
    const all = DEFAULT_CATEGORIES.concat(used).filter(function (c, i, arr) { return c && arr.indexOf(c) === i; });
    const dl = $('#category-options');
    dl.textContent = '';
    all.forEach(function (c) { dl.appendChild(el('option', { value: c })); });
  }

  function deleteItem(listName, id, message) {
    const index = state[listName].findIndex(function (x) { return x.id === id; });
    if (index === -1) return;
    const removed = state[listName].splice(index, 1)[0];
    state.deleted[id] = Date.now();
    if (listName === 'shifts' && editingShiftId === id) cancelShiftEdit();
    if (listName === 'expenses' && editingExpenseId === id) cancelExpenseEdit();
    if (listName === 'incomes' && editingIncomeId === id) cancelIncomeEdit();
    saveState();
    render();
    toast(message, function () {
      delete state.deleted[id];
      removed.updatedAt = Date.now(); // newer than the deletion, so syncing keeps it
      state[listName].splice(Math.min(index, state[listName].length), 0, removed);
      saveState();
      render();
    });
  }

  function addedOutsidePeriodNote(date) {
    return C.inRange(date, currentRange()) ? '' : ' (it’s outside the period shown)';
  }

  // ---------- Work form ----------

  const shiftForm = $('#shift-form');

  function resetShiftForm(keepDate) {
    const date = shiftForm.date.value;
    shiftForm.reset();
    shiftForm.date.value = keepDate && date ? date : C.today();
    shiftForm.rate.value = C.centsToInput(state.settings.hourlyRateCents);
    shiftForm.break.value = '0';
    applyLastAccount(shiftForm.account);
    $('#shift-error').textContent = '';
    updateShiftPreview();
  }

  function readShiftForm() {
    const date = shiftForm.date.value;
    const hours = parseFloat(shiftForm.hours.value);
    const rateCents = C.toCents(shiftForm.rate.value);
    const tipsCents = shiftForm.tips.value.trim() === '' ? 0 : C.toCents(shiftForm.tips.value);
    if (!C.parseDate(date)) return { error: 'Pick a date.' };
    if (!(hours > 0) || hours > 24) return { error: 'Hours must be more than 0 and at most 24.' };
    if (!(rateCents >= 0)) return { error: 'Enter your hourly pay as a number, like 15.50.' };
    if (!(tipsCents >= 0)) return { error: 'Tips must be a number, like 20 or 12.50.' };
    return {
      value: {
        date: date,
        hours: Math.round(hours * 100) / 100,
        rateCents: rateCents,
        tipsCents: tipsCents,
        note: shiftForm.note.value.trim().slice(0, 200),
        accountId: shiftForm.account.value
      }
    };
  }

  function updateShiftPreview() {
    const r = readShiftForm();
    $('#shift-preview').textContent = r.value ? '= ' + money(C.shiftEarningsCents(r.value)) + ' earned' : '';
  }

  function updateHoursFromTimes() {
    const h = C.hoursFromTimes(shiftForm.start.value, shiftForm.end.value, shiftForm.break.value);
    if (Number.isFinite(h)) shiftForm.hours.value = h;
    updateShiftPreview();
  }

  ['start', 'end', 'break'].forEach(function (name) {
    shiftForm[name].addEventListener('input', updateHoursFromTimes);
  });
  shiftForm.addEventListener('input', function (e) {
    $('#shift-error').textContent = '';
    if (['start', 'end', 'break'].indexOf(e.target.name) === -1) updateShiftPreview();
  });

  shiftForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const r = readShiftForm();
    if (r.error) {
      $('#shift-error').textContent = r.error;
      return;
    }
    $('#shift-error').textContent = '';
    rememberAccount('shift-form', r.value.accountId);
    if (editingShiftId) {
      const existing = state.shifts.find(function (s) { return s.id === editingShiftId; });
      if (existing) Object.assign(existing, r.value, { updatedAt: Date.now() });
      cancelShiftEdit();
      toast('Hours updated.' + addedOutsidePeriodNote(r.value.date));
    } else {
      r.value.id = C.newId();
      r.value.updatedAt = Date.now();
      state.shifts.push(r.value);
      resetShiftForm(true);
      toast('Added ' + hoursText(r.value.hours) + ' · ' + money(C.shiftEarningsCents(r.value)) + addedOutsidePeriodNote(r.value.date));
    }
    saveState();
    render();
  });

  function startEditShift(id) {
    const s = state.shifts.find(function (x) { return x.id === id; });
    if (!s) return;
    editingShiftId = id;
    shiftForm.reset();
    shiftForm.date.value = s.date;
    shiftForm.hours.value = s.hours;
    shiftForm.rate.value = C.centsToInput(s.rateCents);
    shiftForm.tips.value = s.tipsCents ? C.centsToInput(s.tipsCents) : '';
    shiftForm.note.value = s.note;
    shiftForm.account.value = hasOption(shiftForm.account, s.accountId) ? s.accountId : '';
    shiftForm.break.value = '0';
    $('#shift-form-title').textContent = 'Edit hours';
    $('#shift-submit').textContent = 'Save changes';
    $('#shift-cancel').hidden = false;
    $('#shift-error').textContent = '';
    render();
    shiftForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelShiftEdit() {
    editingShiftId = null;
    $('#shift-form-title').textContent = 'Log hours worked';
    $('#shift-submit').textContent = 'Add hours';
    $('#shift-cancel').hidden = true;
    resetShiftForm(false);
  }

  $('#shift-cancel').addEventListener('click', function () { cancelShiftEdit(); render(); });

  // ---------- Spending form ----------

  const expenseForm = $('#expense-form');

  function resetExpenseForm(keepDate) {
    const date = expenseForm.date.value;
    expenseForm.reset();
    expenseForm.date.value = keepDate && date ? date : C.today();
    applyLastAccount(expenseForm.account);
    $('#expense-error').textContent = '';
    updateExpensePreview();
  }

  function readExpenseForm() {
    const date = expenseForm.date.value;
    const amountCents = C.toCents(expenseForm.amount.value);
    if (!C.parseDate(date)) return { error: 'Pick a date.' };
    if (!(amountCents > 0)) return { error: 'Enter an amount more than 0, like 12.50.' };
    return {
      value: {
        date: date,
        amountCents: amountCents,
        category: expenseForm.category.value.trim().slice(0, 40) || 'Other',
        note: expenseForm.note.value.trim().slice(0, 200),
        accountId: expenseForm.account.value
      }
    };
  }

  function updateExpensePreview() {
    const r = readExpenseForm();
    const s = state.settings;
    const takeHomeRate = s.hourlyRateCents - C.percentOf(s.hourlyRateCents, s.taxPercent);
    const h = r.value ? C.hoursOfWork(r.value.amountCents, takeHomeRate) : null;
    $('#expense-preview').textContent = h == null ? ''
      : '≈ ' + hoursText(h) + ' of work at your usual take-home pay';
  }

  expenseForm.addEventListener('input', function () {
    $('#expense-error').textContent = '';
    updateExpensePreview();
  });

  expenseForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const r = readExpenseForm();
    if (r.error) {
      $('#expense-error').textContent = r.error;
      return;
    }
    $('#expense-error').textContent = '';
    rememberAccount('expense-form', r.value.accountId);
    if (editingExpenseId) {
      const existing = state.expenses.find(function (x) { return x.id === editingExpenseId; });
      if (existing) Object.assign(existing, r.value, { updatedAt: Date.now() });
      cancelExpenseEdit();
      toast('Spending updated.' + addedOutsidePeriodNote(r.value.date));
    } else {
      r.value.id = C.newId();
      r.value.updatedAt = Date.now();
      state.expenses.push(r.value);
      resetExpenseForm(true);
      toast('Added ' + money(r.value.amountCents) + ' for ' + r.value.category + addedOutsidePeriodNote(r.value.date));
    }
    saveState();
    render();
  });

  function startEditExpense(id) {
    const x = state.expenses.find(function (e) { return e.id === id; });
    if (!x) return;
    editingExpenseId = id;
    expenseForm.date.value = x.date;
    expenseForm.amount.value = C.centsToInput(x.amountCents);
    expenseForm.category.value = x.category;
    expenseForm.note.value = x.note;
    expenseForm.account.value = hasOption(expenseForm.account, x.accountId) ? x.accountId : '';
    $('#expense-form-title').textContent = 'Edit spending';
    $('#expense-submit').textContent = 'Save changes';
    $('#expense-cancel').hidden = false;
    $('#expense-error').textContent = '';
    render();
    expenseForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelExpenseEdit() {
    editingExpenseId = null;
    $('#expense-form-title').textContent = 'Log spending';
    $('#expense-submit').textContent = 'Add spending';
    $('#expense-cancel').hidden = true;
    resetExpenseForm(false);
  }

  $('#expense-cancel').addEventListener('click', function () { cancelExpenseEdit(); render(); });

  // ---------- Other income form ----------

  const incomeForm = $('#income-form');

  function resetIncomeForm(keepDate) {
    const date = incomeForm.date.value;
    incomeForm.reset();
    incomeForm.date.value = keepDate && date ? date : C.today();
    applyLastAccount(incomeForm.account);
    $('#income-error').textContent = '';
  }

  function readIncomeForm() {
    const date = incomeForm.date.value;
    const amountCents = C.toCents(incomeForm.amount.value);
    if (!C.parseDate(date)) return { error: 'Pick a date.' };
    if (!(amountCents > 0)) return { error: 'Enter an amount more than 0, like 25.00.' };
    return {
      value: {
        date: date,
        amountCents: amountCents,
        source: incomeForm.source.value.trim().slice(0, 40) || 'Other',
        note: incomeForm.note.value.trim().slice(0, 200),
        accountId: incomeForm.account.value
      }
    };
  }

  incomeForm.addEventListener('input', function () { $('#income-error').textContent = ''; });

  incomeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const r = readIncomeForm();
    if (r.error) {
      $('#income-error').textContent = r.error;
      return;
    }
    rememberAccount('income-form', r.value.accountId);
    if (editingIncomeId) {
      const existing = state.incomes.find(function (x) { return x.id === editingIncomeId; });
      if (existing) Object.assign(existing, r.value, { updatedAt: Date.now() });
      cancelIncomeEdit();
      toast('Income updated.' + addedOutsidePeriodNote(r.value.date));
    } else {
      r.value.id = C.newId();
      r.value.updatedAt = Date.now();
      state.incomes.push(r.value);
      resetIncomeForm(true);
      toast('Added ' + money(r.value.amountCents) + ' from ' + r.value.source + addedOutsidePeriodNote(r.value.date));
    }
    saveState();
    render();
  });

  function startEditIncome(id) {
    const x = state.incomes.find(function (i) { return i.id === id; });
    if (!x) return;
    editingIncomeId = id;
    incomeForm.date.value = x.date;
    incomeForm.amount.value = C.centsToInput(x.amountCents);
    incomeForm.source.value = x.source;
    incomeForm.note.value = x.note;
    incomeForm.account.value = hasOption(incomeForm.account, x.accountId) ? x.accountId : '';
    $('#income-form-title').textContent = 'Edit income';
    $('#income-submit').textContent = 'Save changes';
    $('#income-cancel').hidden = false;
    $('#income-error').textContent = '';
    render();
    incomeForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelIncomeEdit() {
    editingIncomeId = null;
    $('#income-form-title').textContent = 'Other income';
    $('#income-submit').textContent = 'Add income';
    $('#income-cancel').hidden = true;
    resetIncomeForm(false);
  }

  $('#income-cancel').addEventListener('click', function () { cancelIncomeEdit(); render(); });

  // ---------- Spend % slider ----------

  $('#spend-slider').addEventListener('input', function (e) {
    state.settings.spendPercent = Number(e.target.value);
    state.settingsUpdatedAt = Date.now();
    saveState();
    render();
  });

  // ---------- Settings ----------

  const settingsForm = $('#settings-form');

  function fillSettingsForm() {
    const s = state.settings;
    settingsForm.rate.value = C.centsToInput(s.hourlyRateCents);
    settingsForm.tax.value = s.taxPercent;
    settingsForm.spend.value = s.spendPercent;
    settingsForm.currency.value = s.currency;
    settingsForm.weekStart.value = String(s.weekStart);
    $('#settings-error').textContent = '';
    $('#settings-saved').textContent = '';
  }

  settingsForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const rate = C.toCents(settingsForm.rate.value);
    const tax = parseFloat(settingsForm.tax.value);
    const spend = parseFloat(settingsForm.spend.value);
    let error = '';
    if (!(rate >= 0)) error = 'Enter your hourly pay as a number, like 15.50.';
    else if (!(tax >= 0 && tax <= 100)) error = 'Taxes must be between 0 and 100%.';
    else if (!(spend >= 0 && spend <= 100)) error = 'Spending % must be between 0 and 100.';
    $('#settings-error').textContent = error;
    if (error) return;

    const oldRate = state.settings.hourlyRateCents;
    state.settings.hourlyRateCents = rate;
    state.settings.taxPercent = Math.round(tax * 10) / 10;
    state.settings.spendPercent = Math.round(spend);
    state.settings.currency = settingsForm.currency.value;
    state.settings.weekStart = Number(settingsForm.weekStart.value);
    state.settingsUpdatedAt = Date.now();
    const saved = saveState();
    // Update the default pay in the work form unless the user is editing a shift.
    if (!editingShiftId && C.toCents(shiftForm.rate.value) === oldRate) {
      shiftForm.rate.value = C.centsToInput(rate);
    }
    fillSettingsForm();
    if (saved) $('#settings-saved').textContent = 'Saved ✓';
    render();
  });

  // ---------- Backup / restore / export ----------

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  $('#export-json').addEventListener('click', function () {
    download('money-tracker-backup-' + C.today() + '.json', JSON.stringify(state, null, 2), 'application/json');
    $('#data-status').textContent = 'Backup downloaded.';
  });

  $('#export-csv').addEventListener('click', function () {
    download('money-tracker-' + C.today() + '.csv', C.toCsv(state), 'text/csv');
    $('#data-status').textContent = 'Spreadsheet downloaded.';
  });

  $('#import-json').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      let incoming;
      try {
        incoming = C.validateState(JSON.parse(String(reader.result)));
      } catch (err) {
        $('#data-status').textContent = 'Could not restore: ' + (err instanceof SyntaxError ? 'the file is not valid JSON.' : err.message);
        return;
      }
      const ok = window.confirm('Replace everything in the app with this backup?\n\n' +
        incoming.shifts.length + ' work entries, ' + incoming.incomes.length + ' other income entries, ' +
        incoming.expenses.length + ' spending entries and ' + incoming.accounts.length + ' accounts.\n\n' +
        'Your current data will be overwritten.');
      if (!ok) return;
      state = C.replaceAll(state, incoming, Date.now());
      cancelShiftEdit();
      cancelExpenseEdit();
      cancelIncomeEdit();
      saveState();
      fillSettingsForm();
      render();
      $('#data-status').textContent = 'Backup restored.';
    };
    reader.onerror = function () { $('#data-status').textContent = 'Could not read that file.'; };
    reader.readAsText(file);
  });

  $('#clear-all').addEventListener('click', function () {
    const everywhere = window.MoneyCloud && window.MoneyCloud.isSignedIn();
    const ok = window.confirm('Delete ALL hours, spending and settings ' +
      (everywhere ? 'from your account, on every device you\'re signed in on?' : 'from this device?') +
      '\n\nThis cannot be undone. Download a backup first if you might want it later.');
    if (!ok) return;
    state = C.replaceAll(state, C.defaultState(), Date.now());
    cancelShiftEdit();
    cancelExpenseEdit();
    cancelIncomeEdit();
    saveState();
    fillSettingsForm();
    render();
    $('#data-status').textContent = 'All data deleted.';
  });

  // Keep multiple open tabs in sync.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    state = loadState();
    render();
  });

  // In-page links like "Settings" in the getting-started card.
  document.addEventListener('click', function (e) {
    const link = e.target.closest('[data-goto]');
    if (!link) return;
    e.preventDefault();
    location.hash = link.dataset.goto;
  });

  // ---------- Bank statement import ----------

  const PDFJS_URL = 'vendor/pdfjs/pdf.min.js';
  const PDFJS_WORKER_URL = 'vendor/pdfjs/pdf.worker.min.js';
  let importRows = [];

  // Extracts the text of a PDF as printed lines (pieces of text at the same
  // height on the page, read left to right). Everything happens on this device.
  async function pdfLines(file) {
    const pdfjs = await import(new URL(PDFJS_URL, document.baseURI).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(PDFJS_WORKER_URL, document.baseURI).href;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    task.onPassword = function (updatePassword, reason) {
      const password = window.prompt(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD
        ? 'That password didn\'t work. Try again:'
        : 'This statement is password-protected. Enter its password (it stays on this device):');
      if (password === null) task.destroy();
      else updatePassword(password);
    };
    const doc = await task.promise;
    const lines = [];
    try {
      for (let p = 1; p <= Math.min(doc.numPages, 50); p++) {
        const content = await (await doc.getPage(p)).getTextContent();
        const rows = [];
        content.items.forEach(function (item) {
          if (!item.str || !item.str.trim()) return;
          const x = item.transform[4];
          const y = item.transform[5];
          const tolerance = Math.max(2, (item.height || 10) * 0.4);
          let row = rows.find(function (r) { return Math.abs(r.y - y) <= tolerance; });
          if (!row) { row = { y: y, parts: [] }; rows.push(row); }
          row.parts.push({ x: x, str: item.str });
        });
        rows.sort(function (a, b) { return b.y - a.y; });
        rows.forEach(function (r) {
          r.parts.sort(function (a, b) { return a.x - b.x; });
          lines.push(r.parts.map(function (part) { return part.str; }).join(' '));
        });
      }
    } finally {
      task.destroy(); // frees the PDF worker and its memory
    }
    return lines;
  }

  function closeImport() {
    importRows = [];
    $('#import-review').hidden = true;
    $('#import-list').textContent = '';
    $('#import-error').textContent = '';
  }

  $('#statement-file').addEventListener('change', async function (e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    closeImport();
    const status = $('#import-status');
    if (file.size > 20 * 1024 * 1024) { status.textContent = 'That file is over 20 MB, which is too big to read here.'; return; }
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (isPdf && location.protocol === 'file:') {
      status.textContent = 'Reading PDFs only works when the app is opened from its website, not as a file on your computer.';
      return;
    }
    status.textContent = 'Reading ' + file.name + '…';
    let result;
    try {
      if (isPdf) {
        const lines = await pdfLines(file);
        if (lines.join('').replace(/\s/g, '').length < 20) {
          status.textContent = 'No text found in that PDF. It may be a scanned image. Try downloading a CSV from your bank instead.';
          return;
        }
        result = window.MoneyImport.fromTextLines(lines);
      } else {
        result = window.MoneyImport.fromCsv(await file.text());
      }
    } catch (err) {
      console.warn('Statement import failed:', err);
      status.textContent = /password/i.test(String(err && (err.name + err.message)))
        ? 'Couldn\'t open that PDF without its password.'
        : 'Couldn\'t read that file. Make sure it\'s a PDF or CSV statement.';
      return;
    }
    if (result.error) { status.textContent = result.error; return; }
    if (result.transactions.length === 0) {
      status.textContent = 'No transactions found in that file. If it\'s a PDF, your bank\'s layout may not be supported. ' +
        'Most banks also let you download transactions as a CSV file, which works more reliably.';
      return;
    }
    importRows = window.MoneyImport.prepareForReview(result.transactions, state);
    const dates = importRows.map(function (r) { return r.date; }).sort();
    status.textContent = 'Found ' + importRows.length + (importRows.length === 1 ? ' transaction' : ' transactions') +
      ' from ' + prettyDate(dates[0]) + ' to ' + prettyDate(dates[dates.length - 1]) +
      '. Check them below, then tap Import.' +
      (result.truncated ? ' (Only the first ' + window.MoneyImport.MAX_ROWS + ' are shown.)' : '');
    $('#import-review').hidden = false;
    renderImportList();
  });

  function renderImportList() {
    const list = $('#import-list');
    list.textContent = '';
    importRows.forEach(function (r, i) {
      const isOut = r.direction === 'out';
      const check = el('input', { type: 'checkbox', 'aria-label': 'Import ' + r.description });
      check.checked = r.include;
      check.addEventListener('change', function () { r.include = check.checked; updateImportButton(); });

      const type = el('select', { 'aria-label': 'Type for ' + r.description });
      type.appendChild(el('option', { value: 'out', text: 'Spending' }));
      type.appendChild(el('option', { value: 'in', text: 'Income' }));
      type.value = r.direction;
      type.addEventListener('change', function () { r.direction = type.value; renderImportList(); });

      const label = el('input', {
        type: 'text', maxlength: '40', autocomplete: 'off',
        list: isOut ? 'category-options' : 'source-options',
        'aria-label': (isOut ? 'Category' : 'Source') + ' for ' + r.description
      });
      label.value = isOut ? r.category : r.source;
      label.addEventListener('input', function () {
        if (isOut) r.category = label.value; else r.source = label.value;
      });

      list.appendChild(el('li', { className: 'import-row' + (r.include ? '' : ' excluded'), 'data-index': String(i) }, [
        el('div', { className: 'import-top' }, [
          check,
          el('div', { className: 'import-main' }, [
            el('div', { className: 'entry-title', text: r.description }),
            el('div', { className: 'entry-sub', text: prettyDate(r.date) })
          ]),
          el('div', { className: 'entry-amount' + (isOut ? '' : ' income-amount'), text: (isOut ? '−' : '+') + money(r.amountCents) })
        ]),
        el('div', { className: 'import-controls' }, [type, label]),
        r.reason ? el('p', { className: 'import-reason', text: r.reason }) : null
      ]));
      check.addEventListener('change', function () {
        check.closest('.import-row').classList.toggle('excluded', !check.checked);
      });
    });
    updateImportButton();
  }

  function updateImportButton() {
    const n = importRows.filter(function (r) { return r.include; }).length;
    $('#import-confirm').textContent = 'Import ' + n + (n === 1 ? ' transaction' : ' transactions');
    $('#import-toggle-all').textContent = n === importRows.length ? 'Unselect all' : 'Select all';
  }

  $('#import-swap').addEventListener('click', function () {
    importRows.forEach(function (r) { r.direction = r.direction === 'out' ? 'in' : 'out'; });
    renderImportList();
  });

  $('#import-toggle-all').addEventListener('click', function () {
    const all = importRows.every(function (r) { return r.include; });
    importRows.forEach(function (r) { r.include = !all; });
    renderImportList();
  });

  $('#import-cancel').addEventListener('click', function () {
    closeImport();
    $('#import-status').textContent = '';
  });

  $('#import-confirm').addEventListener('click', function () {
    const chosen = importRows.filter(function (r) { return r.include; });
    if (chosen.length === 0) { $('#import-error').textContent = 'Nothing is selected.'; return; }
    const accountId = $('#import-account').value;
    rememberAccount('import-account', accountId);
    const now = Date.now();
    let spending = 0;
    let income = 0;
    chosen.forEach(function (r) {
      const base = { id: C.newId(), date: r.date, amountCents: r.amountCents, note: r.description.slice(0, 200), accountId: accountId, updatedAt: now };
      if (r.direction === 'out') {
        state.expenses.push(Object.assign(base, { category: (r.category || '').trim().slice(0, 40) || 'Other' }));
        spending++;
      } else {
        state.incomes.push(Object.assign(base, { source: (r.source || '').trim().slice(0, 40) || 'Other' }));
        income++;
      }
    });
    saveState();
    closeImport();
    $('#import-status').textContent = '';
    render();
    toast('Imported ' + spending + ' spending and ' + income + ' income ' + (spending + income === 1 ? 'entry' : 'entries') + '.');
  });

  // ---------- Hooks used by cloud.js (sign-in and sync) ----------

  window.MoneyApp = {
    getState: function () { return state; },
    // Replaces the data with a copy merged from the cloud (or a fresh state
    // after signing out) and redraws everything.
    setState: function (next) {
      const settingsChanged = JSON.stringify(next.settings) !== JSON.stringify(state.settings);
      state = next;
      saveState(true);
      if (editingShiftId && !state.shifts.some(function (x) { return x.id === editingShiftId; })) cancelShiftEdit();
      if (editingExpenseId && !state.expenses.some(function (x) { return x.id === editingExpenseId; })) cancelExpenseEdit();
      if (editingIncomeId && !state.incomes.some(function (x) { return x.id === editingIncomeId; })) cancelIncomeEdit();
      // Only refill the settings form when settings changed, so a background
      // sync doesn't wipe out something being typed there.
      if (settingsChanged) fillSettingsForm();
      render();
    },
    toast: toast,
    showView: function (name) { location.hash = name; }
  };

  // ---------- Start ----------

  renderAccountSelects();
  resetShiftForm(false);
  resetExpenseForm(false);
  resetIncomeForm(false);
  fillSettingsForm();
  routeFromHash();
  render();

  // Offline support / installable app. Service workers only work over http(s).
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* app still works online */ });
    });
  }
})();
