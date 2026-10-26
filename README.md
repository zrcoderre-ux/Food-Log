# PlateIQ — Food & Macro Tracker (PWA)

An installable, offline-capable progressive web app for tracking food, macros
and micronutrients, in the spirit of MyFitnessPal, with a meal builder, recipes
and a weekly planner built in. Everything runs client-side: your data lives in
your browser's `localStorage`, with optional cross-device cloud sync and a local
JSON backup. Light and dark themes.

## Features

- **Today / Diary** — MyFitnessPal-style daily log. Calorie budget ring
  (`Goal − Food + Exercise = Remaining`), protein/carb/fat progress, and
  Breakfast / Lunch / Dinner / Snacks sections. Navigate any day.
- **Barcode scanning** — uses the browser `BarcodeDetector` API + camera, with a
  manual-entry fallback. Products are looked up via the free
  [Open Food Facts](https://world.openfoodfacts.org) database and logged in one tap.
- **Steps & activity** — Google Health (including a migrated Fitbit device)
  and/or Apple Health via a zero-touch Shortcut. Active calories raise your
  daily budget; steps and resting heart rate show on Today and in Trends.
- **Smart recommendations** — ranks foods you like by the protein you still
  need and the vitamins and minerals you are short on (today and habitually),
  penalises sodium, and nudges foods in your inventory that are near best-by.
- **Vitamins & minerals** — 20 nutrients tracked over their natural windows
  (daily, a few days, weekly) from USDA and label data; editable per food.
- **Meals, recipes & planner** — swipe-rate foods you will/won't eat, build and
  save meals (meals you log are saved automatically), build recipes from foods
  or import them from PDF/text, plan the week, import MyFitnessPal CSVs, export
  a CSV.
- **Water, inventory, energy** — hydration tracker, pantry items with best-by
  and low-stock alerts, and adaptive energy check-ins with insights that
  correlate energy with food, macros and movement.
- **Installable & offline** — web app manifest + service worker cache the app
  shell so it launches and works without a connection. Follows your system's
  light/dark setting, or pick one in Settings → Appearance.

## Running / hosting

It's a static site — any static host works. Two good options:

- **GitHub Pages** — Settings → Pages → deploy from `main` (root). Free, and the
  repo already lives on GitHub. URL: `https://<user>.github.io/Food-Log/`.
- **Cloudflare Pages** — connect the repo, no build command, output dir `/`.
  Adds a global CDN and a custom domain easily.

A PWA must be served over **HTTPS** (both options provide it) for the service
worker, camera, and Fitbit auth to work. Opening `index.html` from `file://`
disables those features.

## Steps / Fitbit via the Google Health API

Fitbit's own Web API is being retired in **September 2026** and replaced by the
**Google Health API** (Google OAuth). PlateIQ supports the new API — connect
with Google to pull daily steps, including your Fitbit device's once your Fitbit
account is migrated to your Google account. It's read client-side (no backend).

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project.
2. **APIs & Services → Library** → enable the **Google Health API**.
3. **OAuth consent screen**: User type *External*; add **both** read scopes —
   `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
   (steps + active calories) and
   `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   (resting heart rate); add **yourself as a Test user**; leave Publishing status
   on **Testing** (this lets the restricted health scopes work for you without
   Google verification).
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Under **Authorized JavaScript origins** add the origin shown in the app
   (Settings → Google Health), e.g. `https://zrcoderre-ux.github.io`. Copy the
   **Client ID**.
5. In PlateIQ → Settings → **Google Health** → paste the Client ID → **Connect
   Google Health** and approve. Make sure your Fitbit account is linked to your
   Google account so its steps flow through.

> The Google Health API is new (launched 2026); PlateIQ reads **steps**,
> **active-energy-burned**, and **daily-resting-heart-rate** via the
> `dataPoints:dailyRollUp` method (active calories feed your exercise budget;
> resting HR shows on Today and in Energy insights). If a value reads 0 after
> connecting, that data type's response field may differ — tell me and I'll
> adjust the parser.

### Legacy Fitbit (until Sept 2026)

The old direct Fitbit connection still works until the sunset: register a
**Client / Implicit Grant** app at <https://dev.fitbit.com/apps/new> with the
Redirect URL shown in Settings → Fitbit, and paste the Client ID there.

## Cloud sync & zero-touch step import (Supabase)

Optional. Enables **cross-device sync** of your diary/settings and **zero-touch
Apple Health step import** — all on Supabase's free tier. Everything stays in
your own project; the app only ever holds your project's *public* keys.

### 1. Create the project & tables

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor → New query**, paste the entire contents of
   [`supabase-schema.sql`](./supabase-schema.sql), and **Run**. This creates the
   sync/steps tables, row-level-security policies, and the `ingest_steps()`
   function used for zero-touch import. (Safe to re-run.)
3. In **Authentication → URL Configuration**, add your deployed app URL
   (e.g. `https://zrcoderre-ux.github.io/Food-Log/`) to **Site URL** and
   **Redirect URLs** so the magic-link sign-in can return to the app.

### 2. Connect the app

1. In PlateIQ → Settings → **Cloud sync**, enter your **email** and tap **Email
   me a sign-in link**. (The project URL + publishable key are built in; use the
   *Advanced* link only to point at a different project.)
2. Sign in **without leaving the app** — clicking the link on a phone opens a
   separate browser that can't sign the PWA in. Instead:
   - **Easiest:** long-press the link in the email → **Copy Link** → paste into
     the app's **Paste link & sign in** box.
   - **Or** add `{{ .Token }}` to the *Magic Link* email template (Authentication
     → Email Templates) so the email shows a 6-digit **code** to type in.

   Repeat on any other device to share the same data.

### 3. Zero-touch Apple Health steps (iOS Shortcut)

Your iPhone already counts steps 24/7 in Apple Health. This pushes that number
to PlateIQ in the background — no tapping. In Settings → Cloud sync, tap **Copy
ingest details** to get your `Endpoint`, `Token`, and `apikey`, then:

1. In the **Shortcuts** app, create a shortcut:
   - **Find Health Samples** → Steps → filter to **Today**, and **Calculate
     Statistics → Sum** to get today's total.
   - **Get Contents of URL** → your `Endpoint`, Method **POST**,
     Headers: `apikey` = your anon key, `Content-Type` = `application/json`,
     Request Body (JSON):
     `{ "p_token": "<your token>", "p_day": "<today as YYYY-MM-DD>", "p_steps": <the sum>, "p_source": "apple_health" }`
2. In the **Automation** tab, add a **Time of Day** automation (e.g. hourly or at
   day's end), set it to **Run Immediately** with notifications off, and run the
   shortcut above. iOS runs it silently in the background.

PlateIQ pulls these steps on each sync and reconciles them with Fitbit: Fitbit
stays primary, and Apple Health only fills in steps/calories the watch missed —
so nothing is ever double-counted.

## Closed-app energy reminders (Web Push)

Optional. Sends energy check-in notifications on your adaptive schedule **even
when the app is fully closed**, using your Supabase project + a scheduled edge
function. Requires Cloud sync (above) to be set up and signed in.

1. **Re-run the schema.** `supabase-schema.sql` now also creates the
   `plateiq_push` table — run it again (it's idempotent).
2. **Deploy the edge function** (needs the [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase functions deploy push-energy --no-verify-jwt
   ```
   (`--no-verify-jwt` lets the scheduler call it; the function checks its own `CRON_SECRET`.)
3. **Set the function secrets** (generate a VAPID keypair with
   `npx web-push generate-vapid-keys`, or use the pair provided to you):
   ```bash
   supabase secrets set \
     VAPID_PUBLIC=<public key> \
     VAPID_PRIVATE=<private key> \
     VAPID_SUBJECT=mailto:you@email.com \
     CRON_SECRET=<any random string>
   ```
4. **Schedule it.** Edit `supabase-push-cron.sql` — replace `<PROJECT_REF>` and
   `<CRON_SECRET>` — then run it in the SQL Editor. It enables `pg_cron`/`pg_net`
   and pings the function every 15 minutes.
5. **Turn it on in the app.** Settings → Energy check-ins → **Enable background
   reminders** (you must be signed in to Cloud sync). The app ships with the
   matching VAPID *public* key as default; paste your own in the VAPID field if
   you generated a fresh pair.

The function only nudges you inside your waking hours and respects the same
adaptive cadence (fewer asks as it gathers data), computed in your timezone.

## Claude food assistant

Optional. Uses Claude (Anthropic's AI) to:

- **Read a nutrition label**: Foods → Add custom food → **🏷️ Read a nutrition
  label with Claude**. Take or pick a photo; Claude fills in the name, serving,
  calories, macros and any vitamins/minerals on the label. Check it, then Save.
- **Describe or snap a meal**: Today → **💬 Describe or snap a meal (Claude)**
  (also in each meal's ＋ Add food sheet). Type what you ate, add a photo of the
  food, or both. Claude matches items to your own foods, recipes and saved meals
  where it can, estimates the rest (portion sizes from the photo included), and
  shows a review list. Nothing is added until you tap **Add to diary**.

It runs through a Supabase edge function, so your API key never ships in the
public app. It requires Cloud sync (above) to be set up and signed in.

1. **Get an API key.** Sign up at <https://console.anthropic.com>, add credit
   under **Billing** (API usage is billed separately from a Claude.ai
   subscription), then **API keys → Create key**. Consider setting a monthly
   spend limit under **Limits**. Each label or meal costs a few cents.
2. **Deploy the function** (Supabase CLI):
   ```bash
   supabase functions deploy claude-food --no-verify-jwt
   ```
   (`--no-verify-jwt` lets the browser's CORS preflight through; the function
   verifies your sign-in itself.)
3. **Set its secrets.** `ALLOWED_EMAILS` is the Cloud sync email(s) allowed to
   use it. The project's public key is built into the app, so anyone could
   create an account; this keeps your API bill yours.
   ```bash
   supabase secrets set \
     ANTHROPIC_API_KEY=<your key> \
     ALLOWED_EMAILS=you@email.com
   ```
4. In PlateIQ → Settings → **Claude food assistant** → **Test connection**.

## Food data sources

Name search queries **Open Food Facts** (millions of mostly packaged/branded
products) with no setup. For high-quality *whole-food* data (e.g. "chicken
breast"), optionally add **USDA FoodData Central**: get a free API key at
<https://fdc.nal.usda.gov/api-key-signup.html> and paste it into Settings →
Food database (USDA). USDA results then appear first, alongside Open Food Facts.
Barcode/QR scanning uses the native `BarcodeDetector` where available and falls
back to ZXing (so it works in Safari/iOS), looking products up in Open Food Facts.

## Updates

The app auto-updates: the service worker serves the page **network-first**, so
an online launch always loads the latest deploy, and a new version reloads
itself once it activates. No reinstalling. Settings shows the running version
and a **Check for updates** link.

When you ship a change, bump both version strings so installed copies refresh
their cached shell: `APP_VERSION` in `index.html` and `VERSION` in `sw.js`.

## Development

There is no build step: edit `index.html` and reload. To run it locally with a
real origin (needed for the service worker and camera):

```bash
npm start            # serves the folder on http://localhost:8080
```

A headless smoke test drives the app in Chromium in both colour schemes
(tabs, settings, adding and logging a food, meal builder, planner, exports,
Escape-to-close, theme override) and fails on any console error. Screenshots
land in `tools/smoke-out/`.

```bash
npm install
npx playwright install chromium
npm test
```

The same test runs in GitHub Actions on every pull request and on pushes to
non-`main` branches (`.github/workflows/ci.yml`). `CODE-REVIEW.md` records the
findings of the last full review and what was deferred.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The entire app (UI, styles, logic) |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker (offline app shell) |
| `supabase-schema.sql` | One-time SQL for cloud sync, step ingestion + push |
| `supabase-push-cron.sql` | Schedules the energy-reminder sender (pg_cron) |
| `supabase/functions/push-energy/` | Edge function that sends Web Push reminders |
| `supabase/functions/claude-food/` | Edge function that calls Claude for label reading and meal logging |
| `icon.svg`, `icon-192.png`, `icon-512.png` | App icons |
| `tools/smoke.js`, `package.json` | Headless smoke test (`npm test`) |
| `.github/workflows/` | GitHub Pages deploy and the CI smoke test |
| `CODE-REVIEW.md` | Review findings and their status |
