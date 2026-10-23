/*
 * Uploaded files (pay stubs, time cards, receipts, statements).
 *
 * - The file itself is kept on this device in IndexedDB, and, when signed in,
 *   in a private Supabase Storage bucket at "<user id>/<file id>" so it shows
 *   up on your other devices. Only the file's details (name, date, type...)
 *   live in the synced app data.
 * - Reading: PDFs with pdf.js, photos with Tesseract (text recognition).
 *   Both run on this device and are only downloaded when first needed.
 */
(function () {
  'use strict';

  const DB_NAME = 'moneytracker-files';
  const STORE = 'files';
  const BUCKET = 'documents';
  const MAX_BYTES = 15 * 1024 * 1024;   // also the bucket's limit (supabase/storage.sql)
  const MAX_IMAGE_SIDE = 2400;
  const base = function (path) { return new URL(path, document.baseURI).href; };

  // ---------- On-device storage (IndexedDB) ----------
  // Stored as { type, data: ArrayBuffer } because older Safari versions
  // can't keep Blobs in IndexedDB.

  let dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('This browser can\'t store files.')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  function withStore(mode, work) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, mode);
        const req = work(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('Storage aborted')); };
      });
    });
  }

  async function putLocal(id, blob) {
    const data = await blob.arrayBuffer();
    await withStore('readwrite', function (s) { return s.put({ type: blob.type, data: data }, id); });
  }

  async function getLocal(id) {
    const rec = await withStore('readonly', function (s) { return s.get(id); });
    return rec ? new Blob([rec.data], { type: rec.type }) : null;
  }

  function deleteLocal(id) {
    return withStore('readwrite', function (s) { return s.delete(id); });
  }

  function localIds() {
    return withStore('readonly', function (s) { return s.getAllKeys(); });
  }

  function clearLocal() {
    return withStore('readwrite', function (s) { return s.clear(); });
  }

  // ---------- Preparing a file ----------

  // Shrinks big photos (phone cameras make 4-12 MB images) to at most
  // 2400 px on the long side. Images the browser can't decode (e.g. HEIC on
  // some desktops) are kept as they are.
  async function prepareImage(file) {
    if (!/^image\//.test(file.type) || typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      return file;
    }
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && /jpe?g|png|webp/.test(file.type)) {
      bitmap.close && bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close && bitmap.close();
    const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.86); });
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    try { return new File([blob], name, { type: 'image/jpeg' }); } catch (e) { blob.name = name; return blob; }
  }

  function isPdf(file) { return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''); }
  function isCsv(file) { return /\.csv$/i.test(file.name || '') || /csv/.test(file.type); }
  function isImage(file) { return /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name || ''); }

  // ---------- Reading ----------

  let pdfjsPromise = null;
  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(base('vendor/pdfjs/pdf.min.js')).then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = base('vendor/pdfjs/pdf.worker.min.js');
        return pdfjs;
      });
      pdfjsPromise.catch(function () { pdfjsPromise = null; });
    }
    return pdfjsPromise;
  }

  // Opens a PDF (asking for a password if needed, unless opts.noPassword).
  // Returns { doc, task }.
  async function openPdf(blob, opts) {
    if (location.protocol === 'file:') throw new Error('Reading PDFs only works when the app is opened from its website.');
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false });
    task.onPassword = function (updatePassword, reason) {
      if (opts && opts.noPassword) { task.destroy(); return; }
      const password = window.prompt(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD
        ? 'That password didn\'t work. Try again:'
        : 'This PDF is password-protected. Enter its password (it stays on this device):');
      if (password === null) task.destroy();
      else updatePassword(password);
    };
    return { doc: await task.promise, task: task };
  }

  // The PDF's text as printed lines: pieces at the same height, left to right.
  async function pdfLines(blob) {
    const opened = await openPdf(blob);
    const doc = opened.doc;
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
      opened.task.destroy();
    }
    return lines;
  }

  // Draws page 1 of a PDF into a canvas (for previews).
  async function pdfPreview(blob, maxWidth, opts) {
    const opened = await openPdf(blob, opts);
    try {
      const page = await opened.doc.getPage(1);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.min(2, (maxWidth * (window.devicePixelRatio || 1)) / unscaled.width);
      const viewport = page.getViewport({ scale: scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = Math.floor(viewport.width / (window.devicePixelRatio || 1)) + 'px';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      return canvas;
    } finally {
      opened.task.destroy();
    }
  }

  let tesseractPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tesseractPromise) {
      tesseractPromise = new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = base('vendor/tesseract/tesseract.min.js');
        s.onload = function () { resolve(window.Tesseract); };
        s.onerror = function () { tesseractPromise = null; reject(new Error('Couldn\'t load text recognition. Check your connection.')); };
        document.head.appendChild(s);
      });
    }
    return tesseractPromise;
  }

  // Text recognition on a photo. onProgress(fraction 0..1, label).
  async function ocrLines(blob, onProgress) {
    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: base('vendor/tesseract/worker.min.js'),
      corePath: base('vendor/tesseract/'),
      langPath: base('vendor/tesseract/lang'),
      workerBlobURL: false,
      logger: function (m) {
        if (!onProgress || typeof m.progress !== 'number') return;
        const label = /recogniz/.test(m.status) ? 'Reading text' : 'Getting text recognition ready';
        // Loading counts as the first 30%, recognizing as the rest.
        onProgress(/recogniz/.test(m.status) ? 0.3 + m.progress * 0.7 : m.progress * 0.3, label);
      }
    });
    try {
      const result = await worker.recognize(blob);
      return result.data.text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    } finally {
      worker.terminate();
    }
  }

  // ---------- Your account (Supabase Storage) ----------

  function cloud() {
    const c = window.MoneyCloud;
    return c && c.isSignedIn() && c.client() ? { sb: c.client(), userId: c.userId() } : null;
  }

  async function upload(doc, blob) {
    const c = cloud();
    if (!c) return null;
    const path = c.userId + '/' + doc.id;
    const res = await c.sb.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || doc.mime || 'application/octet-stream',
      upsert: true
    });
    if (res.error) throw res.error;
    return path;
  }

  async function download(doc) {
    const c = cloud();
    if (!c || !doc.cloudPath) return null;
    const res = await c.sb.storage.from(BUCKET).download(doc.cloudPath);
    if (res.error) throw res.error;
    return res.data;
  }

  async function removeRemote(path) {
    const c = cloud();
    if (!c || !path) return;
    const res = await c.sb.storage.from(BUCKET).remove([path]);
    if (res.error) throw res.error;
  }

  // The file for a document: from this device if we have it, otherwise
  // downloaded from your account (and kept here for next time).
  async function getBlob(doc) {
    const local = await getLocal(doc.id).catch(function () { return null; });
    if (local) return local;
    const remote = await download(doc);
    if (remote) await putLocal(doc.id, remote).catch(function () { /* still usable */ });
    return remote;
  }

  /*
   * After each sync: upload files added while signed out or offline, and
   * clean up copies of files that were deleted (on any device). Only files
   * with a deletion marker are removed, so a file another device has just
   * uploaded (whose details haven't synced yet) is never touched.
   */
  let housekeeping = false;
  async function syncFiles() {
    const app = window.MoneyApp;
    const c = cloud();
    if (!app || housekeeping) return;
    housekeeping = true;
    try {
      const state = app.getState();
      const known = {};
      state.documents.forEach(function (d) { known[d.id] = true; });

      const ids = await localIds().catch(function () { return []; });
      for (const id of ids) {
        if (!known[id] && state.deleted[id] != null) await deleteLocal(id).catch(function () {});
      }
      if (!c) return;

      for (const doc of state.documents.slice()) {
        if (doc.cloudPath) continue;
        const blob = await getLocal(doc.id).catch(function () { return null; });
        if (!blob) continue;
        const path = await upload(doc, blob);
        if (path) app.updateDocument(doc.id, { cloudPath: path });
      }

      const listing = await c.sb.storage.from(BUCKET).list(c.userId, { limit: 1000 });
      if (!listing.error && listing.data) {
        const stale = listing.data
          .filter(function (o) { return !known[o.name] && app.getState().deleted[o.name] != null; })
          .map(function (o) { return c.userId + '/' + o.name; });
        if (stale.length) await c.sb.storage.from(BUCKET).remove(stale);
      }
    } catch (e) {
      console.warn('File sync:', e);
    } finally {
      housekeeping = false;
    }
  }

  window.addEventListener('moneytracker:synced', function () { syncFiles(); });
  window.addEventListener('moneytracker:signedout', function () { clearLocal().catch(function () {}); });

  window.MoneyFiles = {
    MAX_BYTES: MAX_BYTES,
    isPdf: isPdf,
    isCsv: isCsv,
    isImage: isImage,
    prepareImage: prepareImage,
    pdfLines: pdfLines,
    pdfPreview: pdfPreview,
    ocrLines: ocrLines,
    putLocal: putLocal,
    getLocal: getLocal,
    deleteLocal: deleteLocal,
    getBlob: getBlob,
    upload: upload,
    removeRemote: removeRemote,
    syncFiles: syncFiles,
    isCloudReady: function () { return !!cloud(); }
  };
})();
