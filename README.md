# Money Tracker

A simple website / phone app for tracking:

- **Hours you work** and how much you earned (hourly pay, tips/bonus, start/end times with unpaid breaks, overnight shifts)
- **Money you spend**, by category
- **What percent of your pay you can spend**, and how much money that is, with the rest counted as savings
- **How much you have left to spend** this week / month / year, with a warning bar as you get close to or go over

It is a Progressive Web App (PWA): one set of files that works as a normal website on a computer and can be
installed on a phone's home screen, where it opens full-screen like an app and works offline.

## How the numbers are calculated

| Number | Formula |
| --- | --- |
| Earned | hours × hourly pay + tips/bonus, for every shift in the period |
| Taxes & deductions | Earned × your tax % (an estimate you set; use 0 to ignore taxes) |
| Take-home pay | Earned − taxes |
| Spending money | Take-home × your "I can spend" % |
| Savings target | Take-home − spending money |
| Left to spend | Spending money − what you've spent (negative = over budget) |
| Saved | Take-home − what you actually spent |

When you type in a purchase, the app also shows roughly how many hours of work it costs at your usual take-home pay.

Money is stored as whole cents, so totals never pick up floating point errors (like `0.1 + 0.2 = 0.30000000000000004`).

## Your data

Everything is stored **only in your browser on that device** (`localStorage`). Nothing is sent to any server, and
there are no accounts. That also means:

- Data on your phone and on your computer are separate. Use **Settings → Download backup** and **Restore backup** to move it.
- Clearing your browser's site data deletes it. Download a backup now and then.
- On iPhone, Safari can clear data for websites you haven't opened in 7 days. Apps **added to the Home Screen**
  aren't affected by that rule, so install it (see below) if you use an iPhone.
- **Export spreadsheet (CSV)** gives you a file you can open in Excel, Google Sheets or Numbers.

## Putting it online (so you can use it on your phone)

The app is plain HTML/CSS/JavaScript with no build step, so any static host works. The easiest is GitHub Pages:

1. Merge this branch into `main`.
2. On GitHub, open the repo → **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After a minute or two, the page shows your site's link (usually `https://<your-username>.github.io/<repo-name>/`).

Note: GitHub Pages for a **private** repo needs a paid GitHub plan. On a free plan the repo has to be public. Your
*data* is never in the repo, so making the code public doesn't expose your hours or spending.

### Installing it on your phone

- **iPhone (Safari):** open the link → Share button → **Add to Home Screen**.
- **Android (Chrome):** open the link → ⋮ menu → **Install app** (or **Add to Home screen**).

## Running it on your computer

```sh
npm start          # serves the app at http://localhost:8080
```

You can also just double-click `index.html`. Everything works except offline mode/installing, which need a web server.

## Tests

```sh
npm test
```

Unit tests cover the money math, rounding, overnight shifts, week/month/year date ranges (leap years, daylight
saving changes, year boundaries), backup validation, and CSV export.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page layout |
| `styles.css` | Styling (light and dark mode, phone and desktop layouts) |
| `calc.js` | All calculations, with no UI code, so they can be tested |
| `app.js` | Forms, lists, dashboard, saving, backup/restore |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and the installable app |
