# PlateIQ — Food & Macro Tracker (PWA)

An installable, offline-capable progressive web app for tracking food and macros —
in the spirit of MyFitnessPal — that also folds in the original **PlateIQ meal
planner**. Everything runs client-side; your data lives in your browser's
`localStorage` (with optional Google Drive backup).

## Features

- **Today / Diary** — MyFitnessPal-style daily log. Calorie budget ring
  (`Goal − Food + Exercise = Remaining`), protein/carb/fat progress, and
  Breakfast / Lunch / Dinner / Snacks sections. Navigate any day.
- **Barcode scanning** — uses the browser `BarcodeDetector` API + camera, with a
  manual-entry fallback. Products are looked up via the free
  [Open Food Facts](https://world.openfoodfacts.org) database and logged in one tap.
- **Fitbit sync** — connect your Fitbit account (OAuth 2.0 implicit grant, no
  server needed) to pull steps and activity calories, which adjust your daily
  calorie budget. See setup below.
- **Smart recommendations** — given how much of each macro you have left for the
  day, it ranks foods you like to help you close the gap without overshooting.
- **Meal planner (original app)** — food swipe-rating, meal builder, weekly
  planner, recipe import (PDF/text), MyFitnessPal CSV import, and Excel export —
  all preserved as tabs.
- **Installable & offline** — web app manifest + service worker cache the app
  shell so it launches and works without a connection.

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
3. **OAuth consent screen**: User type *External*; add the scope
   `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`;
   add **yourself as a Test user**; leave Publishing status on **Testing** (this
   lets the restricted health scope work for you without Google verification).
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Under **Authorized JavaScript origins** add the origin shown in the app
   (Settings → Google Health), e.g. `https://zrcoderre-ux.github.io`. Copy the
   **Client ID**.
5. In PlateIQ → Settings → **Google Health** → paste the Client ID → **Connect
   Google Health** and approve. Make sure your Fitbit account is linked to your
   Google account so its steps flow through.

> The Google Health API is new (launched 2026); PlateIQ reads steps via the
> `steps/dataPoints:dailyRollUp` method. If the step count reads 0 after
> connecting, the response value field may differ — tell me and I'll adjust the
> parser.

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

1. In **Project Settings → API**, copy the **Project URL** and the **anon
   public** key.
2. In PlateIQ → Settings → **Cloud sync**, paste both, enter your email, and tap
   **Send sign-in link**. Click the link in your email — you're signed in, and
   your data syncs automatically from then on. Repeat on any other device to
   share the same data.

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

## Files

| File | Purpose |
|------|---------|
| `index.html` | The entire app (UI, styles, logic) |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker (offline app shell) |
| `supabase-schema.sql` | One-time SQL for cloud sync, step ingestion + push |
| `supabase-push-cron.sql` | Schedules the energy-reminder sender (pg_cron) |
| `supabase/functions/push-energy/` | Edge function that sends Web Push reminders |
| `icon.svg`, `icon-192.png`, `icon-512.png` | App icons |
