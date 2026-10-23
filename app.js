/* The app's screens. Math lives in calc.js, document reading in importer.js,
   file storage and text recognition in files.js. */
(function () {
  'use strict';

  const C = window.MoneyCalc;
  const I = window.MoneyImport;
  const F = window.MoneyFiles;
  const CFG = window.MONEY_TRACKER_CONFIG || {};
  const APP_NAME = CFG.appName || 'Payday';
  const STORAGE_KEY = 'moneyTracker.v1';
  const UI_KEY = 'moneyTracker.ui';
  const DEFAULT_CATEGORIES = ['Food', 'Groceries', 'Transport', 'Gas', 'Rent', 'Bills', 'Phone',
    'Fun', 'Shopping', 'Subscriptions', 'Health', 'Gifts', 'Other'];
  const KIND_LABELS = { paystub: 'Pay stub', timecard: 'Time card', receipt: 'Receipt', statement: 'Statement', other: 'Other' };
  const RING = 2 * Math.PI * 52;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------- Icons (static, trusted markup) ----------

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
    folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M7 12h10"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    clip: '<path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13"/>',
    doc: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 17.8 9.5 4.25 4.25 0 0 1 17.5 18z"/>',
    device: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
    bank: '<path d="M3 10 12 4.5 21 10M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20.5h18"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'
  };

  function icon(name) {
    const span = document.createElement('span');
    span.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
    return span.firstChild;
  }

  function hydrateIcons(root) {
    $$('[data-icon]', root).forEach(function (node) {
      if (node.firstChild) return;
      node.appendChild(icon(node.dataset.icon));
    });
  }

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
    const ui = { period: 'month', refDate: C.today(), lastAccount: {}, accountFilter: '', fileFilter: '' };
    try {
      const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      if (['week', 'month', 'year', 'all'].indexOf(saved.period) !== -1) ui.period = saved.period;
      if (saved.lastAccount && typeof saved.lastAccount === 'object') ui.lastAccount = saved.lastAccount;
      if (typeof saved.accountFilter === 'string') ui.accountFilter = saved.accountFilter;
    } catch (e) { /* use defaults */ }
    return ui;
  }

  function saveUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ period: ui.period, lastAccount: ui.lastAccount, accountFilter: ui.accountFilter }));
    } catch (e) { /* optional */ }
  }

  let state = loadState();
  const ui = loadUi();
  const editing = { shift: null, expense: null, income: null };

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

  function dayLabel(dateStr) {
    const today = C.today();
    if (dateStr === today) return 'Today';
    if (dateStr === C.addDays(today, -1)) return 'Yesterday';
    if (dateStr.slice(0, 4) !== today.slice(0, 4)) return prettyDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    return prettyDate(dateStr);
  }

  function periodLabel(range) {
    if (ui.period === 'all') return 'All time';
    if (ui.period === 'year') return range.start.slice(0, 4);
    if (ui.period === 'month') return prettyDate(range.start, { month: 'long', year: 'numeric' });
    const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
    return prettyDate(range.start, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' – ' + prettyDate(range.end, { month: 'short', day: 'numeric' });
  }

  function fileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // Builds a DOM element. Text is always set via textContent, never as HTML,
  // so notes, names and text read from files can't inject markup.
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'className') node.className = v;
        else if (k === 'style') node.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // Counts a money figure up or down to its new value.
  function setMoney(node, cents, prefix) {
    prefix = prefix || '';
    const from = typeof node._cents === 'number' ? node._cents : 0;
    node._cents = cents;
    cancelAnimationFrame(node._raf);
    if (reduceMotion || from === cents || document.hidden) {
      node.textContent = prefix + money(cents);
      return;
    }
    const start = performance.now();
    const duration = 650;
    (function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = prefix + money(Math.round(from + (cents - from) * eased));
      if (t < 1) node._raf = requestAnimationFrame(step);
    })(start);
  }

  // ---------- Toast ----------

  let toastTimer = null;
  function toast(message, undo) {
    const t = $('#toast');
    t.textContent = '';
    t.appendChild(el('span', { text: message }));
    if (undo) {
      t.appendChild(el('button', {
        type: 'button', className: 'toast-undo', text: 'Undo',
        onclick: function () { undo(); hideToast(); }
      }));
    }
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 6000 : 3200);
  }
  function hideToast() {
    const t = $('#toast');
    t.classList.remove('show');
    setTimeout(function () { if (!t.classList.contains('show')) t.hidden = true; }, 350);
  }

  // ---------- Navigation ----------

  const VIEWS = ['home', 'hours', 'spending', 'files', 'settings'];
  let currentView = null;

  function showView(name) {
    if (VIEWS.indexOf(name) === -1) name = 'home';
    if (name === currentView) return;
    currentView = name;
    VIEWS.forEach(function (v) { $('#view-' + v).hidden = v !== name; });
    $$('.tab').forEach(function (tab) {
      if (tab.dataset.nav === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    $('.period-bar').hidden = name === 'settings' || name === 'files';
    if (name === 'settings') fillSettingsForm();
    if (name === 'files') renderFiles();
    window.scrollTo(0, 0);
  }

  function routeFromHash() {
    showView(location.hash.replace('#', '') || 'home');
  }

  function navigate(name) {
    const hash = name === 'home' ? '' : name;
    if (location.hash.replace('#', '') !== hash) {
      if (hash) location.hash = hash;
      else history.pushState(null, '', location.pathname + location.search);
    }
    showView(name);
  }

  window.addEventListener('hashchange', routeFromHash);
  window.addEventListener('popstate', routeFromHash);

  // ---------- Sheets ----------

  let openSheetEl = null;
  let sheetReturnFocus = null;

  function openSheet(id) {
    if (openSheetEl && openSheetEl.id !== id) closeSheet(true);
    const sheet = $('#' + id);
    const backdrop = $('#backdrop');
    sheetReturnFocus = document.activeElement;
    backdrop.hidden = false;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    openSheetEl = sheet;
    document.body.classList.add('sheet-open');
    $('#fab').classList.toggle('open', id === 'sheet-add');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        backdrop.classList.add('show');
        sheet.classList.add('show');
      });
    });
    setTimeout(function () {
      if (openSheetEl !== sheet || sheet.contains(document.activeElement)) return; // already typing somewhere
      const focusable = sheet.querySelector('input:not([type=hidden]):not([type=file]):not([type=checkbox]), select, .add-tile, .pick-tile, button:not([data-close])');
      if (focusable && window.matchMedia('(hover: hover)').matches) focusable.focus({ preventScroll: true });
    }, 60);
  }

  function closeSheet(immediate) {
    const sheet = openSheetEl;
    if (!sheet) return;
    openSheetEl = null;
    document.body.classList.remove('sheet-open');
    $('#fab').classList.remove('open');
    sheet.classList.remove('show');
    const backdrop = $('#backdrop');
    backdrop.classList.remove('show');
    const finish = function () {
      if (openSheetEl === sheet) return;
      sheet.hidden = true;
      if (!openSheetEl) backdrop.hidden = true;
    };
    if (immediate || reduceMotion) finish(); else setTimeout(finish, 380);
    if (sheet.id === 'sheet-viewer') releaseViewer();
    if (sheet.id === 'sheet-upload') upload = null;
    if (sheetReturnFocus && sheetReturnFocus.focus) sheetReturnFocus.focus({ preventScroll: true });
  }

  $('#backdrop').addEventListener('click', function () { closeSheet(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openSheetEl) closeSheet();
  });

  // Buttons anywhere: data-nav="view", data-open="shift|expense|income|upload", data-close.
  document.addEventListener('click', function (e) {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      e.preventDefault();
      closeSheet(true);
      navigate(nav.dataset.nav);
      return;
    }
    const opener = e.target.closest('[data-open]');
    if (opener) {
      e.preventDefault();
      const what = opener.dataset.open;
      if (what === 'shift') openShiftSheet(null);
      else if (what === 'expense') openExpenseSheet(null);
      else if (what === 'income') openIncomeSheet(null);
      else if (what === 'upload') openUpload(opener.dataset.kind || '');
      return;
    }
    if (e.target.closest('[data-close]')) closeSheet();
  });

  $('#fab').addEventListener('click', function () {
    if (openSheetEl && openSheetEl.id === 'sheet-add') closeSheet();
    else openSheet('sheet-add');
  });

  // ---------- Period ----------

  function currentRange() {
    return C.periodRange(ui.period, ui.refDate, state.settings.weekStart);
  }

  $$('#period-select button').forEach(function (b) {
    b.addEventListener('click', function () {
      ui.period = b.dataset.period;
      ui.refDate = C.today();
      saveUi();
      render();
    });
  });
  $('#period-prev').addEventListener('click', function () { ui.refDate = C.stepPeriod(ui.period, ui.refDate, -1); render(); });
  $('#period-next').addEventListener('click', function () { ui.refDate = C.stepPeriod(ui.period, ui.refDate, 1); render(); });
  $('#period-label').addEventListener('click', function () { ui.refDate = C.today(); render(); });

  // ---------- Account filter ("which account am I looking at?") ----------

  function accountName(id) {
    const a = id && state.accounts.find(function (x) { return x.id === id; });
    return a ? a.name : '';
  }

  // The data the screens show: everything, or just one account's entries.
  function visibleState() {
    if (!ui.accountFilter) return state;
    const keep = function (x) { return x.accountId === ui.accountFilter; };
    return Object.assign({}, state, {
      shifts: state.shifts.filter(keep),
      expenses: state.expenses.filter(keep),
      incomes: state.incomes.filter(keep)
    });
  }

  $('#account-filter').addEventListener('click', function () {
    const list = $('#account-choices');
    list.textContent = '';
    [{ id: '', name: 'All accounts' }].concat(state.accounts).forEach(function (a) {
      const selected = ui.accountFilter === a.id;
      list.appendChild(el('button', {
        type: 'button', className: 'choice', role: 'radio', 'aria-checked': String(selected),
        onclick: function () {
          ui.accountFilter = a.id;
          saveUi();
          closeSheet();
          render();
        }
      }, [el('span', { text: a.name }), selected ? icon('check') : null]));
    });
    openSheet('sheet-accounts');
  });

  // ---------- Rendering ----------

  function render() {
    if (ui.accountFilter && !accountName(ui.accountFilter)) { ui.accountFilter = ''; saveUi(); }
    const range = currentRange();
    const vs = visibleState();
    const sum = C.summarize(vs, range);
    const isCurrent = ui.period === 'all' || C.inRange(C.today(), range);

    $$('#period-select button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.period === ui.period)); });
    const label = $('#period-label');
    label.textContent = periodLabel(range) + (isCurrent ? '' : ' · Today');
    label.classList.toggle('clickable', !isCurrent);
    $('#period-prev').disabled = ui.period === 'all';
    $('#period-next').disabled = ui.period === 'all';

    const chip = $('#account-filter');
    chip.hidden = state.accounts.length === 0;
    chip.classList.toggle('active', !!ui.accountFilter);
    $('#account-filter-label').textContent = ui.accountFilter ? accountName(ui.accountFilter) : 'All accounts';

    renderAccountSelects();
    renderHome(sum, vs, range);
    renderHours(vs, range);
    renderSpending(vs, range);
    if (currentView === 'files') renderFiles();
    renderAccountsSettings();
    renderCategoryOptions();
  }

  function renderHome(sum, vs, range) {
    const s = state.settings;
    const over = sum.remaining < 0;
    $('#hero-label').textContent = over ? 'Over budget by' : 'Left to spend';
    setMoney($('#hero-remaining'), Math.abs(sum.remaining));
    $('#hero-remaining').classList.toggle('negative', over);
    let detail = money(sum.spent) + ' of ' + money(sum.spendable) + ' spent';
    if (sum.spendable > 0) detail += ' · ' + Math.round(sum.usedPercent) + '%';
    $('#hero-detail').textContent = detail;

    const used = Number.isFinite(sum.usedPercent) ? sum.usedPercent : 100;
    const ring = $('#ring-fill');
    ring.style.strokeDashoffset = String(RING * (1 - Math.min(used, 100) / 100));
    ring.style.opacity = used > 0 ? '1' : '0'; // a zero-length round cap would still show a dot
    ring.classList.toggle('warn', used >= 80 && used < 100);
    ring.classList.toggle('over', used >= 100 && sum.spent > 0);

    $('#spend-slider').value = s.spendPercent;
    $('#spend-percent-out').textContent = formatPercent(s.spendPercent);
    $('#save-percent-out').textContent = formatPercent(100 - s.spendPercent);
    setMoney($('#split-spend'), sum.spendable);
    setMoney($('#split-save'), sum.savings);

    const tiles = [
      ['Hours', hoursText(sum.hours), sum.shiftCount + (sum.shiftCount === 1 ? ' entry' : ' entries')],
      ['Earned', money(sum.gross), 'before taxes']
    ];
    if (sum.taxes !== 0) tiles.push(['Taxes', money(sum.taxes), 'estimated or from stubs']);
    if (sum.incomeCount > 0) tiles.push(['Other income', money(sum.otherIncome), sum.incomeCount + (sum.incomeCount === 1 ? ' entry' : ' entries')]);
    tiles.push(['Take-home', money(sum.takeHome), sum.hours > 0 ? money(sum.takeHomePerHour) + ' / hr' : '']);
    tiles.push(['Spent', money(sum.spent), sum.expenseCount + (sum.expenseCount === 1 ? ' purchase' : ' purchases')]);
    tiles.push(['Saved', money(sum.takeHome - sum.spent), 'take-home − spent']);
    const stats = $('#stats');
    stats.textContent = '';
    tiles.forEach(function (t, i) {
      stats.appendChild(el('div', { className: 'stat' + (t[0] === 'Saved' && sum.takeHome - sum.spent < 0 ? ' negative' : ''), style: '--i:' + i }, [
        el('div', { className: 'stat-name', text: t[0] }),
        el('div', { className: 'stat-value', text: t[1] }),
        t[2] ? el('div', { className: 'stat-sub', text: t[2] }) : null
      ]));
    });

    const box = $('#category-breakdown');
    box.textContent = '';
    if (sum.byCategory.length === 0) {
      box.appendChild(el('p', { className: 'muted small', text: 'Nothing spent in this period.' }));
    } else {
      sum.byCategory.forEach(function (c) {
        const pct = (c.cents / sum.spent) * 100;
        const bar = el('div', { className: 'bar-fill' });
        box.appendChild(el('div', { className: 'bar-row' }, [
          el('div', { className: 'bar-top' }, [el('span', { text: c.name }), el('span', { text: money(c.cents) + ' · ' + Math.round(pct) + '%' })]),
          el('div', { className: 'bar' }, [bar])
        ]));
        requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.width = pct + '%'; }); });
      });
    }

    const card = $('#account-breakdown-card');
    card.hidden = state.accounts.length === 0 || !!ui.accountFilter;
    if (!card.hidden) {
      const rows = C.accountSummary(state, range).filter(function (r) { return r.id || r.count > 0; });
      const ab = $('#account-breakdown');
      ab.textContent = '';
      rows.forEach(function (r) {
        ab.appendChild(el('div', { className: 'acct-row' }, [
          el('div', { className: 'acct-name', text: r.name || 'No account' }),
          el('div', { className: 'acct-figures' }, [
            el('span', { className: 'acct-in', text: '+' + money(r.moneyIn) }),
            el('span', { className: 'acct-out', text: '−' + money(r.moneyOut) }),
            el('span', { className: 'acct-net' + (r.net < 0 ? ' negative' : ''), text: (r.net < 0 ? '−' : '') + money(Math.abs(r.net)) })
          ])
        ]));
      });
    }

    const recent = []
      .concat(vs.shifts.map(function (x) { return { type: 'shift', item: x }; }))
      .concat(vs.incomes.map(function (x) { return { type: 'income', item: x }; }))
      .concat(vs.expenses.map(function (x) { return { type: 'expense', item: x }; }))
      .sort(function (a, b) {
        if (a.item.date !== b.item.date) return a.item.date < b.item.date ? 1 : -1;
        return b.item.updatedAt - a.item.updatedAt;
      })
      .slice(0, 6);
    const list = $('#recent-list');
    list.textContent = '';
    if (!recent.length) list.appendChild(el('li', { className: 'empty', text: 'Nothing yet. Tap + to add something.' }));
    recent.forEach(function (r, i) { list.appendChild(rowFor(r.type, r.item, i, true)); });

    $('#onboarding').hidden = state.shifts.length + state.expenses.length + state.incomes.length + state.documents.length > 0;
  }

  function formatPercent(p) {
    return String(Math.round(p * 10) / 10);
  }

  function docsFor(entryId) {
    return state.documents.filter(function (d) { return d.entryId === entryId; });
  }

  function rowFor(type, x, i, showDate) {
    let iconNode;
    let title;
    let sub;
    let amount;
    let amountClass = 'row-amount';
    if (type === 'shift') {
      iconNode = el('span', { className: 'row-icon' }, [icon(x.periodStart ? 'doc' : 'clock')]);
      title = x.periodStart ? 'Pay stub · ' + hoursText(x.hours) : hoursText(x.hours);
      const bits = [];
      if (x.periodStart) bits.push(prettyDate(x.periodStart, { month: 'short', day: 'numeric' }) + '–' + prettyDate(x.periodEnd, { month: 'short', day: 'numeric' }));
      else bits.push(money(x.rateCents) + '/hr' + (x.tipsCents ? ' + ' + money(x.tipsCents) : ''));
      if (typeof x.netCents === 'number') bits.push(money(x.netCents) + ' take-home');
      if (accountName(x.accountId)) bits.push(accountName(x.accountId));
      if (x.note && !x.periodStart) bits.push(x.note);
      sub = bits.join(' · ');
      amount = money(C.shiftEarningsCents(x));
    } else if (type === 'income') {
      iconNode = el('span', { className: 'row-icon in' }, [icon('arrowDown')]);
      title = x.source;
      sub = [x.note, accountName(x.accountId)].filter(Boolean).join(' · ') || 'Other income';
      amount = '+' + money(x.amountCents);
      amountClass += ' in';
    } else {
      iconNode = el('span', { className: 'row-icon', text: (x.category || '?').trim().charAt(0).toUpperCase() });
      title = x.note || x.category;
      sub = [x.note ? x.category : '', accountName(x.accountId)].filter(Boolean).join(' · ') || x.category;
      amount = money(x.amountCents);
    }
    if (showDate) sub = dayLabel(x.date) + (sub ? ' · ' + sub : '');
    const hasDocs = docsFor(x.id).length > 0;
    return el('li', null, [el('button', {
      type: 'button', className: 'row-item', style: '--i:' + (i || 0),
      onclick: function () {
        if (type === 'shift') openShiftSheet(x.id);
        else if (type === 'income') openIncomeSheet(x.id);
        else openExpenseSheet(x.id);
      }
    }, [
      iconNode,
      el('span', { className: 'row-main' }, [
        el('span', { className: 'row-title' }, [el('span', { text: title }), hasDocs ? icon('clip') : null]),
        el('span', { className: 'row-sub', text: sub })
      ]),
      el('span', { className: amountClass, text: amount })
    ])]);
  }

  // A list grouped under day headings, newest first.
  function renderGrouped(list, type, items, emptyText) {
    list.textContent = '';
    if (!items.length) {
      list.appendChild(el('li', { className: 'empty', text: emptyText }));
      return;
    }
    const sorted = items.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.updatedAt - a.updatedAt;
    });
    let lastDay = null;
    sorted.forEach(function (x, i) {
      if (x.date !== lastDay) {
        lastDay = x.date;
        list.appendChild(el('li', { className: 'day-head', text: dayLabel(x.date) }));
      }
      list.appendChild(rowFor(type, x, i, false));
    });
  }

  function renderHours(vs, range) {
    const shifts = vs.shifts.filter(function (s) { return C.inRange(s.date, range); });
    const incomes = vs.incomes.filter(function (x) { return C.inRange(x.date, range); });
    const w = C.wages(shifts, state.settings.taxPercent);
    const hours = shifts.reduce(function (t, s) { return t + s.hours; }, 0);
    $('#hours-summary').textContent = hoursText(hours) + ' · ' + money(w.gross) + ' earned';
    renderGrouped($('#shift-list'), 'shift', shifts, 'No hours in this period.');
    renderGrouped($('#income-list'), 'income', incomes, 'No other income in this period.');
  }

  function renderSpending(vs, range) {
    const items = vs.expenses.filter(function (e) { return C.inRange(e.date, range); });
    const total = items.reduce(function (t, e) { return t + e.amountCents; }, 0);
    $('#spending-summary').textContent = money(total) + ' · ' + items.length + (items.length === 1 ? ' purchase' : ' purchases');
    renderGrouped($('#expense-list'), 'expense', items, 'Nothing spent in this period.');
  }

  function renderCategoryOptions() {
    const used = state.expenses.map(function (e) { return e.category; });
    const all = DEFAULT_CATEGORIES.concat(used).filter(function (c, i, arr) { return c && arr.indexOf(c) === i; });
    const dl = $('#category-options');
    dl.textContent = '';
    all.forEach(function (c) { dl.appendChild(el('option', { value: c })); });
  }

  // ---------- Account selects in forms ----------

  function selectKey(select) {
    const form = select.closest('form');
    return form ? form.id : select.id;
  }
  function hasOption(select, value) {
    return Array.prototype.some.call(select.options, function (o) { return o.value === value; });
  }
  function applyLastAccount(select) {
    // Looking at one account? New entries default to it.
    const last = ui.accountFilter || ui.lastAccount[selectKey(select)] || '';
    select.value = hasOption(select, last) ? last : '';
  }
  function rememberAccount(key, id) {
    ui.lastAccount[key] = id;
    saveUi();
  }
  function renderAccountSelects() {
    $$('.account-select').forEach(function (select) {
      const keep = select.dataset.ready ? select.value : null;
      select.textContent = '';
      select.appendChild(el('option', { value: '', text: state.accounts.length ? 'No account' : 'No accounts yet (add in Settings)' }));
      state.accounts.forEach(function (a) { select.appendChild(el('option', { value: a.id, text: a.name })); });
      if (keep !== null && hasOption(select, keep)) select.value = keep;
      else applyLastAccount(select);
      select.dataset.ready = '1';
    });
  }

  // ---------- Deleting with undo ----------

  function deleteItem(listName, id, message) {
    const index = state[listName].findIndex(function (x) { return x.id === id; });
    if (index === -1) return;
    const removed = state[listName].splice(index, 1)[0];
    state.deleted[id] = Date.now();
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
    return C.inRange(date, currentRange()) ? '' : ' (outside the period shown)';
  }

  function renderAttachments(box, entryId) {
    const docs = entryId ? docsFor(entryId) : [];
    box.hidden = docs.length === 0;
    box.textContent = '';
    docs.forEach(function (d) {
      box.appendChild(el('button', { type: 'button', className: 'attachment', onclick: function () { openViewer(d.id); } },
        [icon('clip'), el('span', { text: KIND_LABELS[d.kind] + ' · ' + d.name })]));
    });
  }

  // ---------- Hours sheet ----------

  const shiftForm = $('#shift-form');

  function openShiftSheet(id) {
    const s = id ? state.shifts.find(function (x) { return x.id === id; }) : null;
    editing.shift = s ? s.id : null;
    shiftForm.reset();
    $('#shift-error').textContent = '';
    const src = s || {};
    shiftForm.date.value = src.date || C.today();
    shiftForm.hours.value = src.hours != null ? src.hours : '';
    shiftForm.rate.value = C.centsToInput(src.rateCents != null ? src.rateCents : state.settings.hourlyRateCents);
    shiftForm.tips.value = src.tipsCents ? C.centsToInput(src.tipsCents) : '';
    shiftForm.note.value = src.note || '';
    shiftForm.break.value = '0';
    const isStub = !!(src.periodStart && src.periodEnd);
    $('#shift-paystub-fields').hidden = !isStub;
    $('#shift-net-field').hidden = typeof src.netCents !== 'number';
    shiftForm.periodStart.value = src.periodStart || '';
    shiftForm.periodEnd.value = src.periodEnd || '';
    shiftForm.net.value = typeof src.netCents === 'number' ? C.centsToInput(src.netCents) : '';
    $('.times', shiftForm).hidden = isStub;
    if (s) shiftForm.account.value = hasOption(shiftForm.account, s.accountId) ? s.accountId : '';
    else applyLastAccount(shiftForm.account);
    $('#shift-form-title').textContent = s ? (isStub ? 'Pay stub' : 'Edit hours') : 'Log hours';
    $('#shift-submit').textContent = s ? 'Save' : 'Add hours';
    $('#shift-delete').hidden = !s;
    renderAttachments($('#shift-attachments'), editing.shift);
    updateShiftPreview();
    openSheet('sheet-shift');
  }

  function readShiftForm() {
    const date = shiftForm.date.value;
    const hours = parseFloat(shiftForm.hours.value);
    const rateCents = C.toCents(shiftForm.rate.value);
    const tipsCents = shiftForm.tips.value.trim() === '' ? 0 : C.toCents(shiftForm.tips.value);
    const isStub = !$('#shift-paystub-fields').hidden;
    const periodStart = isStub ? shiftForm.periodStart.value : '';
    const periodEnd = isStub ? shiftForm.periodEnd.value : '';
    const hasNet = !$('#shift-net-field').hidden && shiftForm.net.value.trim() !== '';
    const netCents = hasNet ? C.toCents(shiftForm.net.value) : null;
    if (!C.parseDate(date)) return { error: 'Pick a date.' };
    if (isStub && (!C.parseDate(periodStart) || !C.parseDate(periodEnd) || periodStart > periodEnd)) return { error: 'Check the pay period dates.' };
    const maxHours = isStub ? 24 * (Math.round((C.parseDate(periodEnd) - C.parseDate(periodStart)) / 86400000) + 1) : 24;
    if (!(hours > 0) || hours > maxHours) return { error: 'Hours must be more than 0 and at most ' + maxHours + '.' };
    if (!(rateCents >= 0)) return { error: 'Enter your hourly pay as a number, like 15.50.' };
    if (!(tipsCents >= 0)) return { error: 'Tips must be a number, like 20 or 12.50.' };
    if (hasNet && !(netCents >= 0)) return { error: 'Net pay must be a number, like 812.40.' };
    const value = {
      date: date,
      hours: Math.round(hours * 100) / 100,
      rateCents: rateCents,
      tipsCents: tipsCents,
      note: shiftForm.note.value.trim().slice(0, 200),
      accountId: shiftForm.account.value
    };
    if (isStub) { value.periodStart = periodStart; value.periodEnd = periodEnd; }
    if (hasNet) value.netCents = netCents;
    return { value: value };
  }

  function updateShiftPreview() {
    const r = readShiftForm();
    $('#shift-preview').textContent = r.value ? '= ' + money(C.shiftEarningsCents(r.value)) + ' earned' : '';
  }

  ['start', 'end', 'break'].forEach(function (name) {
    shiftForm[name].addEventListener('input', function () {
      const h = C.hoursFromTimes(shiftForm.start.value, shiftForm.end.value, shiftForm.break.value);
      if (Number.isFinite(h)) shiftForm.hours.value = h;
      updateShiftPreview();
    });
  });
  shiftForm.addEventListener('input', function (e) {
    $('#shift-error').textContent = '';
    if (['start', 'end', 'break'].indexOf(e.target.name) === -1) updateShiftPreview();
  });

  shiftForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const r = readShiftForm();
    if (r.error) { $('#shift-error').textContent = r.error; return; }
    rememberAccount('shift-form', r.value.accountId);
    if (editing.shift) {
      const existing = state.shifts.find(function (s) { return s.id === editing.shift; });
      if (existing) {
        if (r.value.netCents == null) delete existing.netCents;
        Object.assign(existing, r.value, { updatedAt: Date.now() });
      }
      toast('Saved.' + addedOutsidePeriodNote(r.value.date));
    } else {
      r.value.id = C.newId();
      r.value.updatedAt = Date.now();
      state.shifts.push(r.value);
      toast('Added ' + hoursText(r.value.hours) + ' · ' + money(C.shiftEarningsCents(r.value)) + addedOutsidePeriodNote(r.value.date));
    }
    saveState();
    closeSheet();
    render();
  });

  $('#shift-delete').addEventListener('click', function () {
    const id = editing.shift;
    closeSheet();
    deleteItem('shifts', id, 'Hours deleted.');
  });

  // ---------- Spending sheet ----------

  const expenseForm = $('#expense-form');

  function openExpenseSheet(id) {
    const x = id ? state.expenses.find(function (e) { return e.id === id; }) : null;
    editing.expense = x ? x.id : null;
    expenseForm.reset();
    $('#expense-error').textContent = '';
    expenseForm.date.value = x ? x.date : C.today();
    expenseForm.amount.value = x ? C.centsToInput(x.amountCents) : '';
    expenseForm.category.value = x ? x.category : '';
    expenseForm.note.value = x ? x.note : '';
    if (x) expenseForm.account.value = hasOption(expenseForm.account, x.accountId) ? x.accountId : '';
    else applyLastAccount(expenseForm.account);
    $('#expense-form-title').textContent = x ? 'Edit spending' : 'Add spending';
    $('#expense-submit').textContent = x ? 'Save' : 'Add spending';
    $('#expense-delete').hidden = !x;
    renderAttachments($('#expense-attachments'), editing.expense);
    updateExpensePreview();
    openSheet('sheet-expense');
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
    $('#expense-preview').textContent = h == null ? '' : '≈ ' + hoursText(h) + ' of work';
  }

  expenseForm.addEventListener('input', function () {
    $('#expense-error').textContent = '';
    updateExpensePreview();
  });

  expenseForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const r = readExpenseForm();
    if (r.error) { $('#expense-error').textContent = r.error; return; }
    rememberAccount('expense-form', r.value.accountId);
    if (editing.expense) {
      const existing = state.expenses.find(function (x) { return x.id === editing.expense; });
      if (existing) Object.assign(existing, r.value, { updatedAt: Date.now() });
      toast('Saved.' + addedOutsidePeriodNote(r.value.date));
    } else {
      r.value.id = C.newId();
      r.value.updatedAt = Date.now();
      state.expenses.push(r.value);
      toast('Added ' + money(r.value.amountCents) + ' · ' + r.value.category + addedOutsidePeriodNote(r.value.date));
    }
    saveState();
    closeSheet();
    render();
  });

  $('#expense-delete').addEventListener('click', function () {
    const id = editing.expense;
    closeSheet();
    deleteItem('expenses', id, 'Spending deleted.');
  });

  // ---------- Other income sheet ----------

  const incomeForm = $('#income-form');

  function openIncomeSheet(id) {
    const x = id ? state.incomes.find(function (i) { return i.id === id; }) : null;
    editing.income = x ? x.id : null;
    incomeForm.reset();
    $('#income-error').textContent = '';
    incomeForm.date.value = x ? x.date : C.today();
    incomeForm.amount.value = x ? C.centsToInput(x.amountCents) : '';
    incomeForm.source.value = x ? x.source : '';
    incomeForm.note.value = x ? x.note : '';
    if (x) incomeForm.account.value = hasOption(incomeForm.account, x.accountId) ? x.accountId : '';
    else applyLastAccount(incomeForm.account);
    $('#income-form-title').textContent = x ? 'Edit income' : 'Other income';
    $('#income-submit').textContent = x ? 'Save' : 'Add income';
    $('#income-delete').hidden = !x;
    renderAttachments($('#income-attachments'), editing.income);
    openSheet('sheet-income');
  }

  incomeForm.addEventListener('input', function () { $('#income-error').textContent = ''; });

  incomeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const date = incomeForm.date.value;
    const amountCents = C.toCents(incomeForm.amount.value);
    if (!C.parseDate(date)) { $('#income-error').textContent = 'Pick a date.'; return; }
    if (!(amountCents > 0)) { $('#income-error').textContent = 'Enter an amount more than 0, like 25.00.'; return; }
    const value = {
      date: date,
      amountCents: amountCents,
      source: incomeForm.source.value.trim().slice(0, 40) || 'Other',
      note: incomeForm.note.value.trim().slice(0, 200),
      accountId: incomeForm.account.value
    };
    rememberAccount('income-form', value.accountId);
    if (editing.income) {
      const existing = state.incomes.find(function (x) { return x.id === editing.income; });
      if (existing) Object.assign(existing, value, { updatedAt: Date.now() });
      toast('Saved.' + addedOutsidePeriodNote(value.date));
    } else {
      value.id = C.newId();
      value.updatedAt = Date.now();
      state.incomes.push(value);
      toast('Added ' + money(value.amountCents) + ' from ' + value.source + addedOutsidePeriodNote(value.date));
    }
    saveState();
    closeSheet();
    render();
  });

  $('#income-delete').addEventListener('click', function () {
    const id = editing.income;
    closeSheet();
    deleteItem('incomes', id, 'Income deleted.');
  });

  // ---------- Spend % slider ----------

  $('#spend-slider').addEventListener('input', function (e) {
    state.settings.spendPercent = Number(e.target.value);
    state.settingsUpdatedAt = Date.now();
    saveState();
    render();
  });

  // ---------- Scan & upload ----------

  let upload = null; // the file being reviewed

  function uploadStep(step) {
    ['pick', 'reading', 'review'].forEach(function (s) { $('#upload-' + s).hidden = s !== step; });
  }

  function openUpload(kindHint) {
    upload = { hint: kindHint || '' };
    $('#upload-title').textContent = kindHint === 'statement' ? 'Import a statement' : kindHint === 'paystub' ? 'Scan a pay stub' : 'Scan or upload';
    uploadStep('pick');
    openSheet('sheet-upload');
  }

  function setReading(text, fraction, hint) {
    $('#reading-text').textContent = text;
    $('#reading-progress').style.width = Math.round(Math.max(0.04, Math.min(1, fraction || 0)) * 100) + '%';
    if (hint != null) $('#reading-hint').textContent = hint;
  }

  ['#upload-camera', '#upload-file'].forEach(function (sel) {
    $(sel).addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) readUpload(file);
    });
  });

  async function readUpload(file) {
    const job = upload = { hint: upload ? upload.hint : '', name: file.name || 'Photo', lines: [], csv: null };
    if (file.size > 60 * 1024 * 1024) { toast('That file is over 60 MB, which is too big.'); return; }
    uploadStep('reading');
    setReading('Reading ' + job.name + '…', 0.05, '');
    try {
      if (F.isCsv(file)) {
        job.csv = I.fromCsv(await file.text());
        job.blob = null;
        job.kind = 'statement';
      } else if (F.isPdf(file)) {
        job.blob = file;
        job.lines = await F.pdfLines(file);
        if (job.lines.join('').replace(/\s/g, '').length < 20) {
          // A scanned PDF has no text layer: read page 1 as a picture instead.
          setReading('This PDF is a scan. Reading it as a photo…', 0.1, 'The first time, this downloads about 7 MB for text recognition.');
          const canvas = await F.pdfPreview(file, 1600);
          const png = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
          job.lines = await F.ocrLines(png, function (f, label) { if (upload === job) setReading(label + '…', f); });
        }
      } else if (F.isImage(file)) {
        setReading('Preparing photo…', 0.05, 'Text is read on this device. The first time, this downloads about 7 MB.');
        job.blob = await F.prepareImage(file);
        job.lines = await F.ocrLines(job.blob, function (f, label) { if (upload === job) setReading(label + '…', f); });
      } else {
        throw new Error('Use a photo, PDF or CSV file.');
      }
    } catch (err) {
      console.warn('Reading the file failed:', err);
      if (upload !== job) return;
      if (job.blob || F.isImage(file)) {
        // Couldn't read it, but it can still be kept as a file.
        job.blob = job.blob || file;
        job.lines = [];
        job.readError = /password/i.test(String(err && (err.name + err.message)))
          ? 'Couldn\'t open it without its password.'
          : 'Couldn\'t read the text in this file, so fill in the details yourself.';
      } else {
        uploadStep('pick');
        toast(err && err.message ? err.message : 'Couldn\'t read that file.');
        return;
      }
    }
    if (upload !== job) return; // the sheet was closed or another file picked
    if (job.blob && job.blob.size > F.MAX_BYTES) job.tooBig = true;
    if (!job.kind) {
      const guess = job.lines.length ? I.classify(job.lines) : 'other';
      job.kind = guess !== 'other' ? guess : (job.hint || 'other');
    }
    parseUpload(job);
    showReview(job);
  }

  function parseUpload(job) {
    job.parsed = null;
    if (job.kind === 'paystub') job.parsed = I.parsePayStub(job.lines);
    else if (job.kind === 'timecard') job.parsed = I.parseTimeCard(job.lines);
    else if (job.kind === 'receipt') job.parsed = I.parseReceipt(job.lines);
    else if (job.kind === 'statement') {
      const result = job.csv || I.fromTextLines(job.lines);
      job.statement = result;
      job.rows = I.prepareForReview(result.transactions || [], state);
    }
  }

  function showReview(job) {
    uploadStep('review');
    $('#review-name').textContent = job.name;
    $('#review-meta').textContent = job.blob ? fileSize(job.blob.size) + (job.blob.type ? ' · ' + job.blob.type.split('/')[1].toUpperCase() : '') : 'CSV';
    const thumb = $('#review-thumb');
    thumb.textContent = '';
    if (job.blob && /^image\//.test(job.blob.type)) {
      job.thumbUrl = job.thumbUrl || URL.createObjectURL(job.blob);
      thumb.appendChild(el('img', { src: job.thumbUrl, alt: '' }));
    } else {
      thumb.appendChild(icon(job.blob ? 'doc' : 'receipt'));
    }
    $$('#review-kind button').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.kind === job.kind));
      // A CSV can only be a statement.
      b.disabled = !!job.csv && b.dataset.kind !== 'statement';
    });
    $('#keep-file-row').hidden = !job.blob;
    $('#keep-file').checked = !!job.blob && !job.tooBig;
    $('#keep-file').disabled = !!job.tooBig;
    $('#review-error').textContent = job.tooBig ? 'This file is over 15 MB, so it can be read but not kept.' : '';
    buildReviewForm(job);
  }

  $$('#review-kind button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!upload || b.disabled) return;
      upload.kind = b.dataset.kind;
      parseUpload(upload);
      showReview(upload);
    });
  });

  $('#review-back').addEventListener('click', function () {
    upload = { hint: upload ? upload.hint : '' };
    uploadStep('pick');
  });

  function field(label, input, attrs) {
    return el('label', attrs || null, [label, input]);
  }
  function inputEl(name, type, value, attrs) {
    const node = el('input', Object.assign({ name: name, type: type, autocomplete: 'off' }, attrs || {}));
    if (value != null) node.value = value;
    return node;
  }
  function accountSelect(name, label) {
    const select = el('select', { name: name, className: 'account-select' });
    return { wrap: field(label, select), select: select };
  }

  function foundNote(found, total) {
    const note = $('#review-found');
    note.className = 'found-note small' + (found ? ' good' : '');
    if (upload.readError) note.textContent = upload.readError;
    else if (!upload.lines.length && !upload.csv) note.textContent = 'No text to read. Fill in the details yourself.';
    else if (total == null) note.textContent = '';
    else note.textContent = found ? 'Read ' + found + ' of ' + total + ' details from the file. Check them before saving.'
      : 'Couldn\'t find the details automatically. Fill them in below.';
  }

  function buildReviewForm(job) {
    // A fresh form each time, so listeners from a previous type don't pile up.
    const old = $('#review-form');
    const form = el('form', { id: 'review-form', className: 'form', novalidate: true });
    old.replaceWith(form);
    form.addEventListener('submit', function (e) { e.preventDefault(); $('#review-save').click(); });
    $('#statement-review').hidden = job.kind !== 'statement';
    form.hidden = job.kind === 'statement';
    const p = job.parsed || {};
    let acct = null;

    if (job.kind === 'paystub') {
      const found = ['payDate', 'periodStart', 'periodEnd', 'hours', 'grossCents', 'netCents'].filter(function (k) { return p[k] != null; }).length;
      foundNote(found, 6);
      form.appendChild(el('div', { className: 'row' }, [
        field('Pay date', inputEl('payDate', 'date', p.payDate || p.periodEnd || C.today())),
        field('Hours paid', inputEl('hours', 'number', p.hours, { inputmode: 'decimal', step: '0.01', min: '0.01' }))
      ]));
      form.appendChild(el('div', { className: 'row' }, [
        field('Period start', inputEl('periodStart', 'date', p.periodStart)),
        field('Period end', inputEl('periodEnd', 'date', p.periodEnd))
      ]));
      form.appendChild(el('div', { className: 'row' }, [
        field('Gross pay', inputEl('gross', 'text', p.grossCents != null ? C.centsToInput(p.grossCents) : '', { inputmode: 'decimal', placeholder: '0.00' })),
        field('Net pay (take-home)', inputEl('net', 'text', p.netCents != null ? C.centsToInput(p.netCents) : '', { inputmode: 'decimal', placeholder: '0.00' }))
      ]));
      acct = accountSelect('account', 'Deposited to');
      form.appendChild(acct.wrap);
      form.appendChild(el('div', { id: 'overlap-notice' }));
      form.addEventListener('input', updateOverlap);
    } else if (job.kind === 'timecard') {
      const found = ['date', 'start', 'end'].filter(function (k) { return p[k]; }).length + (p.hours != null ? 1 : 0);
      foundNote(found, 4);
      const hours = p.hours != null ? p.hours : (p.start && p.end ? C.hoursFromTimes(p.start, p.end, p.breakMinutes) : null);
      form.appendChild(el('div', { className: 'row' }, [
        field('Date', inputEl('date', 'date', p.date || C.today())),
        field('Hours', inputEl('hours', 'number', Number.isFinite(hours) ? hours : '', { inputmode: 'decimal', step: '0.01', min: '0.01' }))
      ]));
      form.appendChild(el('div', { className: 'row three' }, [
        field('Clock in', inputEl('start', 'time', p.start)),
        field('Clock out', inputEl('end', 'time', p.end)),
        field('Break (min)', inputEl('break', 'number', p.breakMinutes || 0, { inputmode: 'numeric', min: '0' }))
      ]));
      form.appendChild(field('Hourly pay', inputEl('rate', 'text', C.centsToInput(state.settings.hourlyRateCents), { inputmode: 'decimal' })));
      acct = accountSelect('account', 'Deposited to');
      form.appendChild(acct.wrap);
      ['start', 'end', 'break'].forEach(function (n) {
        form.elements[n].addEventListener('input', function () {
          const h = C.hoursFromTimes(form.elements.start.value, form.elements.end.value, form.elements['break'].value);
          if (Number.isFinite(h)) form.elements.hours.value = h;
        });
      });
    } else if (job.kind === 'receipt') {
      const found = (p.totalCents != null ? 1 : 0) + (p.date ? 1 : 0) + (p.merchant ? 1 : 0);
      foundNote(found, 3);
      form.appendChild(field('Total', inputEl('amount', 'text', p.totalCents != null ? C.centsToInput(p.totalCents) : '', { inputmode: 'decimal', placeholder: '0.00' }), { className: 'amount-field' }));
      form.appendChild(el('div', { className: 'row' }, [
        field('Date', inputEl('date', 'date', p.date || C.today())),
        field('Category', inputEl('category', 'text', p.category && p.category !== 'Other' ? p.category : '', { list: 'category-options', maxlength: '40', placeholder: 'Food' }))
      ]));
      form.appendChild(field('Store / note', inputEl('note', 'text', p.merchant || '', { maxlength: '200' })));
      acct = accountSelect('account', 'Paid from');
      form.appendChild(acct.wrap);
    } else if (job.kind === 'statement') {
      foundNote(null, null);
      renderStatementRows(job);
    } else {
      foundNote(null, null);
      form.appendChild(el('p', { className: 'muted small', text: 'Saved to Files only. It isn\'t added to your hours or spending.' }));
      form.appendChild(el('div', { className: 'row' }, [
        field('Date', inputEl('date', 'date', C.today())),
        field('Note', inputEl('note', 'text', '', { maxlength: '200', placeholder: 'Optional' }))
      ]));
    }
    renderAccountSelects();
    if (acct) {
      // Default to the account last used for this kind of entry.
      const remembered = ui.accountFilter || ui.lastAccount[job.kind === 'receipt' ? 'expense-form' : 'shift-form'] || '';
      acct.select.value = hasOption(acct.select, remembered) ? remembered : '';
    }
    if (job.kind === 'paystub') updateOverlap();
    $('#review-save').textContent = job.kind === 'other' ? 'Save file' : 'Save';
    if (job.kind === 'statement') updateImportButton();
  }

  // Hours already logged inside a pay stub's period would be counted twice.
  function overlappingShifts(start, end) {
    if (!C.parseDate(start) || !C.parseDate(end) || start > end) return [];
    return state.shifts.filter(function (s) { return !s.periodStart && s.date >= start && s.date <= end; });
  }

  function updateOverlap() {
    const form = $('#review-form');
    const box = $('#overlap-notice');
    if (!box || !form.elements.periodStart) return;
    const overlap = overlappingShifts(form.elements.periodStart.value, form.elements.periodEnd.value);
    const wasChecked = $('#replace-overlap') ? $('#replace-overlap').checked : true;
    box.textContent = '';
    if (!overlap.length) return;
    const hours = overlap.reduce(function (t, s) { return t + s.hours; }, 0);
    const check = el('input', { type: 'checkbox', id: 'replace-overlap' });
    check.checked = wasChecked;
    box.appendChild(el('div', { className: 'notice' }, [
      el('div', { text: 'You already logged ' + hoursText(hours) + ' (' + overlap.length + (overlap.length === 1 ? ' entry' : ' entries') +
        ') in this pay period. Keeping both would count that pay twice.' }),
      el('label', { className: 'check-row' }, [check, ' Replace them with this pay stub'])
    ]));
  }

  function renderStatementRows(job) {
    const list = $('#import-list');
    list.textContent = '';
    const note = $('#review-found');
    if (!job.rows.length) {
      note.className = 'found-note small';
      note.textContent = (job.statement && job.statement.error) ||
        'No transactions found. If this is a PDF, your bank\'s layout may not be supported. A CSV download from your bank works more reliably.';
      return;
    }
    const dates = job.rows.map(function (r) { return r.date; }).sort();
    note.className = 'found-note small good';
    note.textContent = 'Found ' + job.rows.length + (job.rows.length === 1 ? ' transaction' : ' transactions') + ', ' +
      prettyDate(dates[0], { month: 'short', day: 'numeric' }) + ' – ' + prettyDate(dates[dates.length - 1], { month: 'short', day: 'numeric' }) +
      '. Untick anything you don\'t want.' + (job.statement && job.statement.truncated ? ' (Only the first ' + I.MAX_ROWS + ' are shown.)' : '');
    job.rows.forEach(function (r) {
      const isOut = r.direction === 'out';
      const check = el('input', { type: 'checkbox', 'aria-label': 'Import ' + r.description });
      check.checked = r.include;
      const row = el('li', { className: 'import-row' + (r.include ? '' : ' excluded') });
      check.addEventListener('change', function () {
        r.include = check.checked;
        row.classList.toggle('excluded', !check.checked);
        updateImportButton();
      });
      const type = el('select', { 'aria-label': 'Type for ' + r.description }, [
        el('option', { value: 'out', text: 'Spending' }), el('option', { value: 'in', text: 'Income' })
      ]);
      type.value = r.direction;
      type.addEventListener('change', function () { r.direction = type.value; renderStatementRows(job); updateImportButton(); });
      const label = el('input', {
        type: 'text', maxlength: '40', autocomplete: 'off', list: isOut ? 'category-options' : 'source-options',
        'aria-label': (isOut ? 'Category' : 'Source') + ' for ' + r.description
      });
      label.value = isOut ? r.category : r.source;
      label.addEventListener('input', function () { if (isOut) r.category = label.value; else r.source = label.value; });
      row.appendChild(el('div', { className: 'import-top' }, [
        check,
        el('div', { className: 'import-main' }, [
          el('div', { className: 'row-title', text: r.description }),
          el('div', { className: 'row-sub', text: prettyDate(r.date) })
        ]),
        el('div', { className: 'row-amount' + (isOut ? '' : ' in'), text: (isOut ? '−' : '+') + money(r.amountCents) })
      ]));
      row.appendChild(el('div', { className: 'import-controls' }, [type, label]));
      if (r.reason) row.appendChild(el('p', { className: 'import-reason', text: r.reason }));
      list.appendChild(row);
    });
  }

  function updateImportButton() {
    if (!upload || upload.kind !== 'statement') return;
    const rows = upload.rows || [];
    const n = rows.filter(function (r) { return r.include; }).length;
    $('#review-save').textContent = 'Import ' + n + (n === 1 ? ' transaction' : ' transactions');
    $('#import-toggle-all').textContent = n === rows.length ? 'Unselect all' : 'Select all';
  }

  $('#import-swap').addEventListener('click', function () {
    upload.rows.forEach(function (r) { r.direction = r.direction === 'out' ? 'in' : 'out'; });
    renderStatementRows(upload);
    updateImportButton();
  });
  $('#import-toggle-all').addEventListener('click', function () {
    const all = upload.rows.every(function (r) { return r.include; });
    upload.rows.forEach(function (r) { r.include = !all; });
    renderStatementRows(upload);
    updateImportButton();
  });

  /*
   * Splits a pay stub's gross pay into hours x rate + extra (overtime,
   * bonuses...) so the entry adds up to exactly the gross on the stub.
   * Uses the stub's regular rate when it was found and fits.
   */
  function stubPay(hours, grossCents, rateHintCents) {
    let rate = rateHintCents > 0 ? rateHintCents : Math.floor(grossCents / hours);
    if (C.shiftEarningsCents({ hours: hours, rateCents: rate, tipsCents: 0 }) > grossCents) rate = Math.floor(grossCents / hours);
    while (rate > 0 && C.shiftEarningsCents({ hours: hours, rateCents: rate, tipsCents: 0 }) > grossCents) rate--;
    return { rateCents: rate, tipsCents: grossCents - C.shiftEarningsCents({ hours: hours, rateCents: rate, tipsCents: 0 }) };
  }

  $('#review-save').addEventListener('click', async function () {
    const job = upload;
    if (!job) return;
    const form = $('#review-form');
    const f = form.elements;
    const err = $('#review-error');
    err.textContent = '';
    const now = Date.now();
    let entry = null;
    let listName = null;
    let docDate = C.today();
    let message = '';
    const imported = [];
    const removedForStub = [];

    if (job.kind === 'paystub') {
      const payDate = f.payDate.value;
      const start = f.periodStart.value;
      const end = f.periodEnd.value;
      const hours = Math.round(parseFloat(f.hours.value) * 100) / 100;
      const gross = C.toCents(f.gross.value);
      const net = f.net.value.trim() ? C.toCents(f.net.value) : null;
      if (!C.parseDate(payDate)) { err.textContent = 'Add the pay date.'; return; }
      if (!C.parseDate(start) || !C.parseDate(end) || start > end) { err.textContent = 'Add the pay period start and end dates.'; return; }
      const maxHours = 24 * (Math.round((C.parseDate(end) - C.parseDate(start)) / 86400000) + 1);
      if (!(hours > 0) || hours > maxHours) { err.textContent = 'Add the hours paid (more than 0).'; return; }
      if (!(gross > 0)) { err.textContent = 'Add the gross pay, like 1256.25.'; return; }
      if (net != null && !(net >= 0)) { err.textContent = 'Net pay must be a number, like 1062.02.'; return; }
      const pay = stubPay(hours, gross, job.parsed && job.parsed.rateCents);
      entry = {
        id: C.newId(), date: payDate, hours: hours, rateCents: pay.rateCents, tipsCents: pay.tipsCents,
        periodStart: start, periodEnd: end, note: 'Pay stub', accountId: f.account.value, updatedAt: now
      };
      if (net != null) entry.netCents = net;
      listName = 'shifts';
      docDate = payDate;
      const replace = $('#replace-overlap');
      if (replace && replace.checked) {
        overlappingShifts(start, end).forEach(function (s) {
          state.shifts = state.shifts.filter(function (x) { return x.id !== s.id; });
          state.deleted[s.id] = now;
          removedForStub.push(s);
        });
      }
      message = 'Pay stub saved · ' + money(gross) + ' gross' + (net != null ? ', ' + money(net) + ' take-home' : '');
      rememberAccount('shift-form', entry.accountId);
    } else if (job.kind === 'timecard') {
      const date = f.date.value;
      const hours = parseFloat(f.hours.value);
      const rate = C.toCents(f.rate.value);
      if (!C.parseDate(date)) { err.textContent = 'Add the date.'; return; }
      if (!(hours > 0) || hours > 24) { err.textContent = 'Add the hours worked (up to 24).'; return; }
      if (!(rate >= 0)) { err.textContent = 'Enter your hourly pay as a number.'; return; }
      const times = f.start.value && f.end.value ? ' ' + f.start.value + '–' + f.end.value : '';
      entry = { id: C.newId(), date: date, hours: Math.round(hours * 100) / 100, rateCents: rate, tipsCents: 0,
        note: 'Time card' + times, accountId: f.account.value, updatedAt: now };
      listName = 'shifts';
      docDate = date;
      message = 'Added ' + hoursText(entry.hours) + ' · ' + money(C.shiftEarningsCents(entry));
      rememberAccount('shift-form', entry.accountId);
    } else if (job.kind === 'receipt') {
      const date = f.date.value;
      const amount = C.toCents(f.amount.value);
      if (!C.parseDate(date)) { err.textContent = 'Add the date.'; return; }
      if (!(amount > 0)) { err.textContent = 'Add the total, like 25.09.'; return; }
      entry = { id: C.newId(), date: date, amountCents: amount, category: f.category.value.trim().slice(0, 40) || 'Other',
        note: f.note.value.trim().slice(0, 200), accountId: f.account.value, updatedAt: now };
      listName = 'expenses';
      docDate = date;
      message = 'Added ' + money(amount) + ' · ' + entry.category;
      rememberAccount('expense-form', entry.accountId);
    } else if (job.kind === 'statement') {
      const chosen = (job.rows || []).filter(function (r) { return r.include; });
      if (!chosen.length) { err.textContent = 'Nothing is selected.'; return; }
      const accountId = $('#import-account').value;
      rememberAccount('import-account', accountId);
      let spending = 0;
      let income = 0;
      chosen.forEach(function (r) {
        const base = { id: C.newId(), date: r.date, amountCents: r.amountCents, note: r.description.slice(0, 200), accountId: accountId, updatedAt: now };
        if (r.direction === 'out') {
          state.expenses.push(Object.assign(base, { category: (r.category || '').trim().slice(0, 40) || 'Other' }));
          imported.push(['expenses', base.id]);
          spending++;
        } else {
          state.incomes.push(Object.assign(base, { source: (r.source || '').trim().slice(0, 40) || 'Other' }));
          imported.push(['incomes', base.id]);
          income++;
        }
      });
      docDate = chosen.map(function (r) { return r.date; }).sort().pop();
      message = 'Imported ' + spending + ' spending and ' + income + ' income ' + (spending + income === 1 ? 'entry' : 'entries');
    } else {
      docDate = C.parseDate(f.date.value) ? f.date.value : C.today();
      message = 'Saved to Files';
    }

    if (entry) {
      state[listName].push(entry);
      imported.push([listName, entry.id]);
    }

    // Keep the file: on this device now, and in your account when signed in.
    let doc = null;
    if (job.blob && $('#keep-file').checked && !job.tooBig) {
      doc = {
        id: C.newId(), date: docDate, name: job.name.slice(0, 120), mime: job.blob.type || '', size: job.blob.size,
        kind: job.kind, note: job.kind === 'other' && f.note ? f.note.value.trim().slice(0, 200) : '',
        entryId: entry ? entry.id : '', cloudPath: '', updatedAt: now
      };
      try {
        await F.putLocal(doc.id, job.blob);
      } catch (e) {
        console.warn('Saving the file on this device failed:', e);
        if (!F.isCloudReady()) { toast('Couldn\'t store the file on this device.'); doc = null; }
      }
      if (doc) state.documents.push(doc);
    }

    saveState();
    closeSheet();
    render();
    if (job.thumbUrl) URL.revokeObjectURL(job.thumbUrl);
    const canUndo = imported.length > 0 || removedForStub.length > 0;
    toast(message + (removedForStub.length ? ' · replaced ' + removedForStub.length + ' logged ' + (removedForStub.length === 1 ? 'entry' : 'entries') : '') + '.',
      canUndo ? function () { undoUpload(imported, doc, removedForStub); } : null);
    if (doc && F.isCloudReady()) uploadDoc(doc, job.blob);
  });

  function undoUpload(imported, doc, restored) {
    const now = Date.now();
    imported.forEach(function (pair) {
      state[pair[0]] = state[pair[0]].filter(function (x) { return x.id !== pair[1]; });
      state.deleted[pair[1]] = now;
    });
    if (doc) removeDocument(doc.id, true);
    restored.forEach(function (s) {
      delete state.deleted[s.id];
      s.updatedAt = now + 1;
      state.shifts.push(s);
    });
    saveState();
    render();
  }

  async function uploadDoc(doc, blob) {
    try {
      const path = await F.upload(doc, blob);
      if (path) updateDocument(doc.id, { cloudPath: path });
    } catch (e) {
      console.warn('Upload failed, will retry after the next sync:', e);
    }
  }

  function updateDocument(id, patch) {
    const d = state.documents.find(function (x) { return x.id === id; });
    if (!d) return;
    Object.assign(d, patch, { updatedAt: Date.now() });
    saveState();
    if (currentView === 'files') renderFiles();
  }

  function removeDocument(id, silent) {
    const d = state.documents.find(function (x) { return x.id === id; });
    if (!d) return;
    state.documents = state.documents.filter(function (x) { return x.id !== id; });
    state.deleted[id] = Date.now();
    F.deleteLocal(id).catch(function () {});
    if (d.cloudPath) F.removeRemote(d.cloudPath).catch(function () { /* cleaned up after a later sync */ });
    if (!silent) { saveState(); render(); }
  }

  // ---------- Files ----------

  const thumbUrls = {};

  $$('#file-filters button').forEach(function (b) {
    b.addEventListener('click', function () {
      ui.fileFilter = b.dataset.kind;
      renderFiles();
    });
  });

  function renderFiles() {
    $$('#file-filters button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.kind === ui.fileFilter)); });
    const docs = state.documents
      .filter(function (d) { return !ui.fileFilter || d.kind === ui.fileFilter; })
      .slice()
      .sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.updatedAt - a.updatedAt; });
    const grid = $('#file-grid');
    grid.textContent = '';
    const signedIn = window.MoneyCloud && window.MoneyCloud.isSignedIn();
    $('#files-summary').textContent = state.documents.length
      ? state.documents.length + (state.documents.length === 1 ? ' file' : ' files') + (signedIn ? ' · backed up to your account' : ' · on this device')
      : 'Pay stubs, time cards, receipts and statements.';
    if (!docs.length) {
      grid.appendChild(el('div', { className: 'card files-empty' }, [
        el('p', { className: 'empty', text: state.documents.length ? 'No files of this type.' : 'No files yet. Scan a pay stub, time card or receipt to keep it here.' })
      ]));
      return;
    }
    docs.forEach(function (d, i) {
      const thumb = el('div', { className: 'file-thumb' }, [icon(/^image\//.test(d.mime) ? 'image' : 'doc'), el('span', { className: 'badge', text: KIND_LABELS[d.kind] })]);
      grid.appendChild(el('button', { type: 'button', className: 'file-card', style: '--i:' + i, onclick: function () { openViewer(d.id); } }, [
        thumb,
        el('div', { className: 'file-meta' }, [
          el('div', { className: 'file-name', text: d.note || d.name }),
          el('div', { className: 'file-sub' }, [icon(d.cloudPath ? 'cloud' : 'device'), el('span', { text: prettyDate(d.date, { month: 'short', day: 'numeric', year: 'numeric' }) })])
        ])
      ]));
      if (/^image\//.test(d.mime) || /pdf/.test(d.mime)) loadThumb(d, thumb);
    });
  }

  function loadThumb(d, thumb) {
    const show = function (url) {
      const old = thumb.querySelector('.icon');
      if (old) old.remove();
      thumb.insertBefore(el('img', { src: url, alt: '', loading: 'lazy' }), thumb.firstChild);
    };
    if (thumbUrls[d.id]) { show(thumbUrls[d.id]); return; }
    F.getLocal(d.id).then(function (blob) {
      if (!blob) return null;
      if (/^image\//.test(blob.type)) return URL.createObjectURL(blob);
      // PDFs: a small picture of page 1. Skipped for password-protected files.
      return F.pdfPreview(blob, 240, { noPassword: true }).then(function (canvas) {
        return new Promise(function (resolve) { canvas.toBlob(function (png) { resolve(png ? URL.createObjectURL(png) : null); }, 'image/png'); });
      });
    }).then(function (url) {
      if (!url) return;
      thumbUrls[d.id] = url;
      show(url);
    }).catch(function () { /* keep the icon */ });
  }

  // ---------- File viewer ----------

  let viewing = null;
  let viewerUrl = null;

  function releaseViewer() {
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
    viewing = null;
  }

  function entryFor(d) {
    if (!d.entryId) return null;
    const lists = [['shifts', 'shift'], ['expenses', 'expense'], ['incomes', 'income']];
    for (let i = 0; i < lists.length; i++) {
      const found = state[lists[i][0]].find(function (x) { return x.id === d.entryId; });
      if (found) return { type: lists[i][1], item: found };
    }
    return null;
  }

  async function openViewer(id) {
    const d = state.documents.find(function (x) { return x.id === id; });
    if (!d) return;
    closeSheet(true);
    releaseViewer();
    viewing = d.id;
    $('#viewer-title').textContent = d.name;
    $('#viewer-kind').value = d.kind;
    $('#viewer-date').value = d.date;
    $('#viewer-note').value = d.note;
    const info = $('#viewer-info');
    info.textContent = '';
    const signedIn = window.MoneyCloud && window.MoneyCloud.isSignedIn();
    info.appendChild(el('div', null, [fileSize(d.size) + ' · ', el('strong', {
      text: d.cloudPath ? 'Backed up to your account' : (signedIn ? 'Uploading soon' : 'On this device only')
    })]));
    const linked = entryFor(d);
    if (linked) {
      const label = linked.type === 'shift' ? (linked.item.periodStart ? 'a pay stub entry' : hoursText(linked.item.hours) + ' of hours')
        : linked.type === 'expense' ? money(linked.item.amountCents) + ' of spending' : money(linked.item.amountCents) + ' of income';
      info.appendChild(el('div', null, ['Linked to ', el('strong', { text: label }), ' on ' + prettyDate(linked.item.date) + ' · ',
        el('button', { type: 'button', className: 'link', text: 'Open', onclick: function () {
          if (linked.type === 'shift') openShiftSheet(linked.item.id);
          else if (linked.type === 'expense') openExpenseSheet(linked.item.id);
          else openIncomeSheet(linked.item.id);
        } })]));
    }
    const media = $('#viewer-media');
    media.textContent = '';
    media.appendChild(el('div', { className: 'spinner' }));
    const open = $('#viewer-open');
    open.hidden = true;
    openSheet('sheet-viewer');
    let blob = null;
    try {
      blob = await F.getBlob(d);
    } catch (e) {
      console.warn('Loading the file failed:', e);
    }
    if (viewing !== d.id) return;
    media.textContent = '';
    if (!blob) {
      media.appendChild(el('p', { className: 'muted small', style: 'padding:20px;text-align:center',
        text: d.cloudPath ? 'Couldn\'t download this file. Check your connection.' : 'This file is on another device. Sign in on both to see it everywhere.' }));
      return;
    }
    viewerUrl = URL.createObjectURL(blob);
    open.href = viewerUrl;
    open.setAttribute('download', d.name);
    open.hidden = false;
    if (/^image\//.test(blob.type)) {
      media.appendChild(el('img', { src: viewerUrl, alt: d.name }));
    } else if (/pdf/.test(blob.type) || /\.pdf$/i.test(d.name)) {
      try {
        const canvas = await F.pdfPreview(blob, Math.min(520, media.clientWidth || 520));
        if (viewing === d.id) media.appendChild(canvas);
      } catch (e) {
        media.appendChild(el('p', { className: 'muted small', text: 'Preview unavailable. Use Open.' }));
      }
    }
  }

  $('#viewer-kind').addEventListener('change', function (e) { if (viewing) updateDocument(viewing, { kind: e.target.value }); });
  $('#viewer-date').addEventListener('change', function (e) { if (viewing && C.parseDate(e.target.value)) updateDocument(viewing, { date: e.target.value }); });
  $('#viewer-note').addEventListener('change', function (e) { if (viewing) updateDocument(viewing, { note: e.target.value.trim().slice(0, 200) }); });
  $('#viewer-delete').addEventListener('click', function () {
    if (!viewing) return;
    const d = state.documents.find(function (x) { return x.id === viewing; });
    if (!d || !window.confirm('Delete "' + d.name + '"?' + (d.entryId ? '\n\nThe entry it\'s linked to will be kept.' : '') + '\n\nThis can\'t be undone.')) return;
    const id = viewing;
    closeSheet();
    if (thumbUrls[id]) { URL.revokeObjectURL(thumbUrls[id]); delete thumbUrls[id]; }
    removeDocument(id);
    toast('File deleted.');
  });

  // ---------- Settings: bank accounts ----------

  function renderAccountsSettings() {
    const list = $('#accounts-list');
    list.textContent = '';
    if (!state.accounts.length) {
      list.appendChild(el('li', { className: 'empty', text: 'No accounts yet.' }));
      return;
    }
    state.accounts.forEach(function (a) {
      list.appendChild(el('li', { className: 'row-item account-entry' }, [
        el('div', { className: 'row-title', text: a.name }),
        el('div', { className: 'row-actions' }, [
          el('button', { type: 'button', className: 'link', text: 'Rename', 'aria-label': 'Rename ' + a.name, onclick: function () { renameAccount(a.id); } }),
          el('button', { type: 'button', className: 'link', style: 'color:var(--danger)', text: 'Delete', 'aria-label': 'Delete ' + a.name, onclick: function () { deleteAccount(a.id); } })
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

  // ---------- Settings: pay & budget ----------

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
    state.settings.hourlyRateCents = rate;
    state.settings.taxPercent = Math.round(tax * 10) / 10;
    state.settings.spendPercent = Math.round(spend);
    state.settings.currency = settingsForm.currency.value;
    state.settings.weekStart = Number(settingsForm.weekStart.value);
    state.settingsUpdatedAt = Date.now();
    const saved = saveState();
    fillSettingsForm();
    if (saved) $('#settings-saved').textContent = 'Saved ✓';
    render();
  });

  // ---------- Settings: backup / restore / export ----------

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type }));
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function fileSlug() {
    return APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'money';
  }

  $('#export-json').addEventListener('click', function () {
    download(fileSlug() + '-backup-' + C.today() + '.json', JSON.stringify(state, null, 2), 'application/json');
    $('#data-status').textContent = 'Backup downloaded.';
  });

  $('#export-csv').addEventListener('click', function () {
    download(fileSlug() + '-' + C.today() + '.csv', C.toCsv(state), 'text/csv');
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
        incoming.expenses.length + ' spending entries, ' + incoming.accounts.length + ' accounts and ' +
        incoming.documents.length + ' file records.\n\nYour current data will be overwritten.');
      if (!ok) return;
      state = C.replaceAll(state, incoming, Date.now());
      saveState();
      fillSettingsForm();
      render();
      F.syncFiles();
      $('#data-status').textContent = 'Backup restored.';
    };
    reader.onerror = function () { $('#data-status').textContent = 'Could not read that file.'; };
    reader.readAsText(file);
  });

  $('#clear-all').addEventListener('click', function () {
    const everywhere = window.MoneyCloud && window.MoneyCloud.isSignedIn();
    const ok = window.confirm('Delete ALL hours, spending, files and settings ' +
      (everywhere ? 'from your account, on every device you\'re signed in on?' : 'from this device?') +
      '\n\nThis cannot be undone. Download a backup first if you might want it later.');
    if (!ok) return;
    state = C.replaceAll(state, C.defaultState(), Date.now());
    saveState();
    fillSettingsForm();
    render();
    F.syncFiles();
    $('#data-status').textContent = 'All data deleted.';
  });

  // Keep multiple open tabs in sync.
  window.addEventListener('storage', function (e) {
    if (e.key !== STORAGE_KEY) return;
    state = loadState();
    render();
  });

  // ---------- Hooks used by cloud.js and files.js ----------

  window.MoneyApp = {
    getState: function () { return state; },
    // Replaces the data with a copy merged from the cloud (or a fresh state
    // after signing out) and redraws everything.
    setState: function (next) {
      const settingsChanged = JSON.stringify(next.settings) !== JSON.stringify(state.settings);
      state = next;
      saveState(true);
      // Only refill the settings form when settings changed, so a background
      // sync doesn't wipe out something being typed there.
      if (settingsChanged) fillSettingsForm();
      render();
    },
    updateDocument: updateDocument,
    toast: toast,
    showView: function (name) { navigate(name); }
  };

  // ---------- Start ----------

  document.title = APP_NAME;
  $$('[data-app-name]').forEach(function (n) { n.textContent = APP_NAME; });
  hydrateIcons(document);
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
