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

## Fitbit setup

Because there's no backend, you connect Fitbit with your own free developer app:

1. Register an app at <https://dev.fitbit.com/apps/new>.
2. Set **OAuth 2.0 Application Type** to **Client** and
   **Redirect URL** to your deployed page's exact URL (shown in the app's
   Settings → Fitbit section).
3. Copy the app's **OAuth 2.0 Client ID** into Settings → Fitbit → Client ID,
   then tap **Connect Fitbit**.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The entire app (UI, styles, logic) |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker (offline app shell) |
| `icon.svg`, `icon-192.png`, `icon-512.png` | App icons |
