/*
 * Optional sign-in (Google or email + password) and cloud sync via Supabase.
 *
 * Each user has one row in the money_tracker_data table holding all their data.
 * Syncing = download the cloud copy, merge it with this device's copy
 * (MoneyCalc.mergeStates), keep the result locally and upload it.
 * The row's `version` number makes two devices saving at the same moment
 * notice each other: the second write fails and that device merges again.
 *
 * If config.js has no Supabase details, none of this runs and the app works
 * exactly as before, with data only on this device.
 */
(function () {
  'use strict';

  const C = window.MoneyCalc;
  const app = window.MoneyApp;
  const cfg = window.MONEY_TRACKER_CONFIG || {};
  const TABLE = 'money_tracker_data';
  const LINKED_KEY = 'moneyTracker.linkedUser';
  const $ = function (sel) { return document.querySelector(sel); };

  let session = null;
  let sb = null;
  window.MoneyCloud = {
    isSignedIn: function () { return !!session; },
    client: function () { return sb; },
    userId: function () { return session ? session.user.id : null; }
  };

  if (!cfg.supabaseUrl || !cfg.supabaseKey || !app) return;

  $('#account-card').hidden = false;

  function showSetupProblem(message) {
    $('#account-signed-out').hidden = true;
    $('#account-signed-in').hidden = true;
    $('#account-card').appendChild(Object.assign(document.createElement('p'), { className: 'error', textContent: message }));
  }

  if (isSecretKey(cfg.supabaseKey)) {
    // A secret key bypasses all security rules; refusing to use it stops it working
    // but it is already exposed if this file was published. It must be rotated.
    showSetupProblem('Setup problem: config.js contains a SECRET Supabase key. Remove it, use the publishable key instead, and rotate the secret key in the Supabase dashboard.');
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    showSetupProblem('Sign-in could not load. Check your connection and reload the page.');
    return;
  }

  // Errors sent back in the URL by Supabase (e.g. an expired email link).
  const urlError = readUrlError();

  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Implicit flow: email links (confirm, reset password) work even when opened in a
      // different browser than the one that asked for them, which is common on phones.
      flowType: 'implicit',
      storageKey: 'moneyTracker.auth'
    }
  });

  // ---------- Helpers ----------

  function isSecretKey(key) {
    if (/^sb_secret_/.test(key)) return true;
    const parts = String(key).split('.');
    if (parts.length !== 3) return false;
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.role === 'service_role';
    } catch (e) {
      return false;
    }
  }

  function readUrlError() {
    const params = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
    const description = params.get('error_description');
    if (!description) return '';
    history.replaceState(history.state, '', location.pathname);
    return description.replace(/\+/g, ' ');
  }

  // Where Google and email links send people back to. Must be listed under
  // Authentication -> URL Configuration -> Redirect URLs in Supabase.
  function appUrl() {
    return location.origin + location.pathname;
  }

  function getLinkedUser() {
    try { return localStorage.getItem(LINKED_KEY); } catch (e) { return null; }
  }
  function setLinkedUser(id) {
    try {
      if (id) localStorage.setItem(LINKED_KEY, id);
      else localStorage.removeItem(LINKED_KEY);
    } catch (e) { /* storage unavailable */ }
  }

  function hasAnyData(state) {
    return state.shifts.length > 0 || state.expenses.length > 0;
  }

  function friendlyAuthError(error) {
    const msg = (error && error.message) || String(error);
    if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.';
    if (/email address not authorized/i.test(msg)) {
      return 'Supabase\'s built-in email can only send to members of your Supabase team. Set up custom SMTP to email other people (see README).';
    }
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a bit and try again.';
    if (/failed to fetch|network/i.test(msg)) return 'Can\'t reach the server. Check your internet connection.';
    return msg;
  }

  // ---------- Account card ----------

  function renderAccount() {
    const signedIn = !!session;
    const recovering = !$('#recovery-form').hidden;
    $('#account-signed-out').hidden = signedIn || recovering;
    $('#account-signed-in').hidden = !signedIn || recovering;
    $('#data-explainer-cloud').hidden = !signedIn;
    if (signedIn) $('#account-email').textContent = session.user.email || 'your account';
  }

  let mode = 'signin';
  function setMode(next) {
    mode = next;
    const form = $('#email-form');
    $('#email-submit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('#email-mode').textContent = mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account';
    form.password.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
    $('#email-error').textContent = '';
    $('#email-info').textContent = '';
  }

  $('#email-mode').addEventListener('click', function () {
    setMode(mode === 'signup' ? 'signin' : 'signup');
  });

  $('#google-signin').addEventListener('click', async function () {
    $('#email-error').textContent = '';
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } });
    if (error) $('#email-error').textContent = friendlyAuthError(error);
    // On success the browser leaves for Google and comes back signed in.
  });

  $('#email-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const form = e.target;
    const email = form.email.value.trim();
    const password = form.password.value;
    const errorBox = $('#email-error');
    const info = $('#email-info');
    errorBox.textContent = '';
    info.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorBox.textContent = 'Enter a valid email address.'; return; }
    if (password.length < 8) { errorBox.textContent = 'Password must be at least 8 characters.'; return; }

    const button = $('#email-submit');
    button.disabled = true;
    try {
      if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email: email, password: password, options: { emailRedirectTo: appUrl() } });
        if (error) { errorBox.textContent = friendlyAuthError(error); return; }
        if (!data.session) {
          // Email confirmation is on (the Supabase default). For privacy, Supabase gives the
          // same answer whether or not the email is already registered.
          setMode('signin');
          info.textContent = 'Check your email for a confirmation link. After confirming, come back here and sign in.';
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email, password: password });
        if (error) { errorBox.textContent = friendlyAuthError(error); return; }
      }
      form.password.value = '';
    } finally {
      button.disabled = false;
    }
  });

  $('#forgot-password').addEventListener('click', async function () {
    const email = $('#email-form').email.value.trim();
    const errorBox = $('#email-error');
    const info = $('#email-info');
    errorBox.textContent = '';
    info.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorBox.textContent = 'Type your email above first, then tap "Forgot password?".'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    if (error) { errorBox.textContent = friendlyAuthError(error); return; }
    info.textContent = 'If that email has an account, a link to reset the password is on its way.';
  });

  $('#recovery-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const password = e.target.password.value;
    const errorBox = $('#recovery-error');
    errorBox.textContent = '';
    if (password.length < 8) { errorBox.textContent = 'Password must be at least 8 characters.'; return; }
    const { error } = await sb.auth.updateUser({ password: password });
    if (error) { errorBox.textContent = friendlyAuthError(error); return; }
    e.target.reset();
    $('#recovery-form').hidden = true;
    renderAccount();
    app.toast('Password updated.');
  });

  $('#sync-now').addEventListener('click', function () { sync(); });

  $('#sign-out').addEventListener('click', async function () {
    while (syncing) await new Promise(function (resolve) { setTimeout(resolve, 100); });
    await sync();
    if (lastSyncOk === false) {
      const ok = window.confirm('Your latest changes haven\'t been saved to your account yet (' +
        $('#sync-status').textContent + ').\n\nSign out anyway? Those changes will be lost.');
      if (!ok) return;
    }
    // Files are uploaded separately from the data; make sure they made it too.
    if (window.MoneyFiles) await window.MoneyFiles.syncFiles();
    const pendingFiles = app.getState().documents.filter(function (d) { return !d.cloudPath; }).length;
    if (pendingFiles) {
      const ok = window.confirm(pendingFiles + (pendingFiles === 1 ? ' file hasn\'t' : ' files haven\'t') +
        ' been uploaded to your account yet.\n\nSign out anyway? ' + (pendingFiles === 1 ? 'It' : 'They') + ' will be removed from this device.');
      if (!ok) return;
    }
    // 'local' signs out only this device, not your other phones/computers.
    // (It also works offline: the session is removed from this device either way.)
    await sb.auth.signOut({ scope: 'local' });
    setLinkedUser(null);
    // Remove the data and files from this device; they're safe in the account.
    app.setState(C.defaultState());
    window.dispatchEvent(new Event('moneytracker:signedout'));
    app.toast('Signed out. Your data is saved in your account.');
  });

  // ---------- Sync ----------

  let syncing = false;
  let syncAgain = false;
  let lastSyncOk = null;
  let debounceTimer = null;

  function setStatus(text, problem) {
    const el = $('#sync-status');
    el.textContent = text;
    el.classList.toggle('problem', !!problem);
  }

  function describeSyncError(error) {
    const code = error && error.code;
    const msg = (error && error.message) || String(error);
    if (!navigator.onLine || /failed to fetch|network|load failed/i.test(msg)) {
      return 'Offline. Changes are saved on this device and will sync when you\'re back online.';
    }
    if (code === 'PGRST205' || code === '42P01' || /does not exist|could not find the table/i.test(msg)) {
      return 'Couldn\'t sync: the database table is missing. Run supabase/schema.sql in the Supabase SQL Editor (see README).';
    }
    if (code === '42501' || /permission denied|row-level security/i.test(msg)) {
      return 'Couldn\'t sync: the database refused access. Re-run supabase/schema.sql to fix its permissions.';
    }
    return 'Couldn\'t sync: ' + msg;
  }

  async function sync() {
    if (!session) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    clearTimeout(debounceTimer);
    setStatus('Syncing…');
    const userId = session.user.id;
    try {
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        const res = await sb.from(TABLE).select('data, version').eq('user_id', userId).maybeSingle();
        if (res.error) throw res.error;
        let remote = null;
        if (res.data) {
          try {
            remote = C.validateState(res.data.data);
          } catch (e) {
            // Never overwrite cloud data we can't read (or that a newer version
            // of the app saved with information this copy doesn't know about).
            if (e.code === 'NEWER_VERSION') throw new Error('another device has a newer version of the app. Reload this page to update.');
            throw new Error('the data in your account looks damaged (' + e.message + '). Nothing was changed.');
          }
        }
        if (!session || session.user.id !== userId) return; // signed out meanwhile

        // Read this device's data now (not before the download) so edits made
        // while waiting aren't lost.
        const local = app.getState();
        const merged = C.mergeStates(local, remote || local);
        const mergedJson = JSON.stringify(merged);
        if (mergedJson !== JSON.stringify(local)) app.setState(merged);
        if (remote && mergedJson === JSON.stringify(remote)) { done = true; break; }

        const write = res.data
          ? await sb.from(TABLE).update({ data: merged, version: res.data.version + 1 })
            .eq('user_id', userId).eq('version', res.data.version).select('version')
          : await sb.from(TABLE).insert({ user_id: userId, data: merged, version: 1 }).select('version');
        if (write.error) {
          if (write.error.code === '23505') continue; // another device created the row first
          throw write.error;
        }
        if (write.data && write.data.length > 0) done = true;
        // Otherwise another device saved in between: loop to merge its changes too.
      }
      if (!done) throw new Error('another device kept saving at the same time. Try again.');
      lastSyncOk = true;
      window.dispatchEvent(new Event('moneytracker:synced'));
      setStatus('Synced at ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    } catch (error) {
      lastSyncOk = false;
      setStatus(describeSyncError(error), true);
    } finally {
      syncing = false;
      if (syncAgain) {
        syncAgain = false;
        sync();
      }
    }
  }

  // Sync shortly after each change (batching quick edits like dragging the slider).
  window.addEventListener('moneytracker:changed', function () {
    if (!session) return;
    lastSyncOk = false;
    setStatus('Waiting to sync…');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(sync, 1500);
  });
  window.addEventListener('online', function () { sync(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') sync();
  });
  // Pick up changes from other devices while the app is left open on screen.
  setInterval(function () {
    if (document.visibilityState === 'visible' && navigator.onLine) sync();
  }, 60 * 1000);

  // ---------- Signing in ----------

  async function onSignedIn() {
    if (!session) return;
    const user = session.user;
    const linked = getLinkedUser();
    if (linked && linked !== user.id) {
      const ok = window.confirm('This device has data from a different account.\n\n' +
        'OK: remove it from this device and load ' + (user.email || 'this account') + '\'s data.\n' +
        'Cancel: sign out and keep the data that\'s here.');
      if (!ok) {
        await sb.auth.signOut({ scope: 'local' });
        return;
      }
      app.setState(C.defaultState());
      window.dispatchEvent(new Event('moneytracker:signedout')); // clears the other account's files here
    } else if (!linked && hasAnyData(app.getState())) {
      app.toast('The data on this device is being added to your account.');
    }
    setLinkedUser(user.id);
    await sync();
  }

  sb.auth.onAuthStateChange(function (event, newSession) {
    const wasSignedIn = !!session;
    const sameUser = wasSignedIn && newSession && session.user.id === newSession.user.id;
    session = newSession;
    if (!newSession) {
      lastSyncOk = null;
      setStatus('');
    }
    if (event === 'PASSWORD_RECOVERY') {
      $('#recovery-form').hidden = false;
      $('#recovery-email').textContent = (newSession && newSession.user.email) || 'your account';
      app.showView('settings');
    }
    renderAccount();
    // Supabase warns against awaiting its own calls inside this callback, so defer.
    if (newSession && (event === 'INITIAL_SESSION' || (event === 'SIGNED_IN' && !sameUser) || event === 'PASSWORD_RECOVERY')) {
      setTimeout(onSignedIn, 0);
    }
    if (event === 'SIGNED_IN' && !wasSignedIn && newSession) {
      setTimeout(function () { app.toast('Signed in as ' + (newSession.user.email || 'your account') + '.'); }, 0);
    }
  });

  setMode('signin');
  renderAccount();
  if (urlError) {
    app.showView('settings');
    $('#email-error').textContent = 'Sign-in link problem: ' + urlError + '. Please try again.';
  }
})();
