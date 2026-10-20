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

**Other income** (refunds, gifts, side jobs, interest) is entered as the amount you actually received. It adds to
take-home pay without the tax estimate.

## Accounts

Under **Settings → Bank accounts & cards**, add nicknames for where your money lives (e.g. "Chase Checking",
"Savings", "Visa"). Never enter account numbers; the app refuses names that look like one. Then:

- Hours and other income have a **Deposited to** account; purchases have a **Paid from** account. Each form remembers
  the last account you picked.
- The Overview shows money **in**, **out** and the **net** for each account in the selected period. Money in from hours
  is your *estimated* take-home pay. Transfers between your own accounts aren't tracked.
- Deleting an account keeps its entries; they show as "No account".

## Importing bank statements (PDF or CSV)

On the **Spending** tab, **Import a bank statement** reads a PDF statement or a CSV export from your bank or card
**on your device**. The file isn't uploaded or stored anywhere. You then review every transaction before anything is added:

- Categories are guessed from the description (e.g. Starbucks → Food, Shell → Gas) and can be changed.
- Paychecks (`DIRECT DEP`, `PAYROLL`...) come in unticked, because your pay is already counted from the hours you log.
- Transfers and credit card payments come in unticked, because they move money between your own accounts.
- Anything with the same date and amount as an existing entry is flagged as a possible duplicate and unticked.
- If spending and income come out backwards (common with credit card exports), tap **Swap**.
- Password-protected PDFs ask for the password, which also stays on the device.

Limits, honestly: every bank lays out its PDFs differently, so PDF reading is best-effort. Scanned (image-only) PDFs
can't be read. **CSV exports are more reliable**, and almost every bank offers one, usually under "Download
transactions". Numeric dates are read as US month/day.

### Why there's no ADP connection

ADP's APIs are only available to employers and their approved partners through registered integrations. An employee
can't get access for a personal app. You can still sign in to MyADP to see your hours and pay stubs, and use the
bank import above to pull in what actually landed in your account.

Money is stored as whole cents, so totals never pick up floating point errors (like `0.1 + 0.2 = 0.30000000000000004`).

## Your data

Without an account, everything is stored **only in your browser on that device** (`localStorage`) and nothing is
sent anywhere. With [sign-in set up](#sign-in--sync-setup-supabase), your data is also saved to your account and
synced between your devices.

- Without an account, your phone and computer have separate data. Use **Settings → Download backup** and **Restore backup** to move it.
- Clearing your browser's site data deletes the copy on that device. Download a backup now and then.
- On iPhone, Safari can clear data for websites you haven't opened in 7 days. Apps **added to the Home Screen**
  aren't affected by that rule, so install it (see below) if you use an iPhone.
- **Export spreadsheet (CSV)** gives you a file you can open in Excel, Google Sheets or Numbers.

## Sign-in & sync setup (Supabase)

Sign-in is optional. Until `config.js` has your Supabase details, the Account section stays hidden and the app works
on its own. Once set up, you can sign in with **Google** or **email + password**, and your data syncs between devices.

How sync works: each device keeps its own copy, so the app still works offline. When online, it merges with your
account: new entries from either side are kept, the latest edit of an entry wins, and deleted entries stay deleted.
It syncs after each change, when you come back to the app, and every minute while it's open.

You'll need to do steps 1–4 yourself, because they happen in your own Supabase and Google accounts.

### 1. Create the Supabase project and table

1. Sign in at [supabase.com/dashboard](https://supabase.com/dashboard) and create a **New project** (the free plan is fine).
2. Open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   This creates the table and the security rules that let each person see only their own data.
   It's safe to run again.

### 2. Point the app at your project

1. In Supabase, click **Connect** at the top of the project (or go to **Settings > API Keys**).
2. Copy the **Project URL** and the **publishable key** (starts with `sb_publishable_`). The older `anon` key also works.
3. Put them in [`config.js`](config.js):
   ```js
   window.MONEY_TRACKER_CONFIG = {
     supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
     supabaseKey: 'sb_publishable_...'
   };
   ```
   The publishable key is designed to be public. The database rules protect your data, not the key.
   **Never** use the **secret** key (`sb_secret_...`) or the `service_role` key here. The app refuses to run with one,
   but if it's ever been committed, rotate it in Supabase.

### 3. Tell Supabase where your app lives

In Supabase, go to **Authentication > URL Configuration**:

- **Site URL**: your app's address, e.g. `https://YOUR-USERNAME.github.io/moneyTracker/`
- **Redirect URLs**: add that same address, and `http://localhost:8080/` if you test on your computer.

Email confirmation links, password resets and Google sign-in only send people back to addresses on this list.

### 4a. Email + password

This is on by default, and new accounts must confirm their email.

**Important:** until you set up your own email sender, Supabase only sends emails to members of your Supabase
organization, and at most 2 per hour. Other addresses get *"Email address not authorized"*. For just you, sign up with the
same email you use for Supabase and it works. For anyone else, set up custom SMTP in Supabase's **Authentication** settings (the **Custom SMTP** page)
with an email provider (Resend, Brevo, Postmark, SendGrid, AWS SES and so on).

### 4b. Google

1. In the [Google Cloud console](https://console.cloud.google.com/), create or pick a project, then open
   **Google Auth Platform**. Fill in the app name and support email if asked.
2. Under **Data Access**, add the `openid` scope. `email` and `profile` are added by default.
3. Under **Clients**, create a client: type **Web application**.
   - **Authorized JavaScript origins**: `https://YOUR-USERNAME.github.io` (just the origin, no path), and `http://localhost:8080` for local testing.
   - **Authorized redirect URIs**: the **Callback URL** shown on Supabase's Google provider page
     (**Authentication > Sign In / Providers > Google**). It looks like `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.
4. Copy the **Client ID** and **Client secret** into that Supabase Google provider page, turn it on, and save.
5. Under **Audience**, while the app is in **Testing** only the test users you list can sign in, so add your Google
   account there, or publish the app. With only the basic scopes above, publishing shouldn't need Google's review.

The Google sign-in screen will say it's going to `YOUR-PROJECT-REF.supabase.co`. That's expected. A custom domain
(a paid Supabase feature) changes it.

### 5. Optional: lock it to just you

Anyone who finds your site can create an account. They can only see their own data, never yours, but they use space in
your project. If it's only for you: once your account exists, turn off **Allow new users to sign up** under
**Authentication > Sign In / Providers**. (This also blocks *new* Google accounts. Your existing one keeps working.)

### Signing out

**Sign out** signs out only that device and removes the data from it. It stays in your account. If a device has
changes that haven't synced yet (for example, it's offline), you'll be warned first.

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
saving changes, year boundaries), backup validation, CSV export, merging data between devices, accounts and other
income, and reading bank statements (several CSV layouts and PDF text).

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page layout |
| `styles.css` | Styling (light and dark mode, phone and desktop layouts) |
| `calc.js` | All calculations, with no UI code, so they can be tested |
| `app.js` | Forms, lists, dashboard, saving, backup/restore |
| `config.js` | Your Supabase project URL and publishable key (empty = no accounts) |
| `cloud.js` | Sign-in (Google, email) and syncing with Supabase |
| `importer.js` | Reads bank statement CSVs and PDF text into transactions for review (no UI code, so it's tested) |
| `vendor/pdfjs/` | Mozilla pdf.js v6.3.289 (Apache-2.0), loaded only when you import a PDF |
| `supabase/schema.sql` | Database table and security rules, run once in Supabase |
| `vendor/supabase.js` | Supabase's JavaScript library v2.117.2 (bundled so the app works offline) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and the installable app |
