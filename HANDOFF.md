# Handoff — 2026-10-28

Notes for the next Claude session. Delete this file (and its line in
`CLAUDE.md`) once everything below is finished.

## Where things stand

All app code is merged to `main` and live on GitHub Pages (v94). The user has
just connected the **Supabase connector**, so this session can work on the
Supabase project directly. Project ref: `tilwmgmyyzmbmvtjsqgx`.

Done on the Supabase side:

- `supabase-schema.sql` was run on 2026-10-28 (adds `plateiq_inbox` for Siri
  logging and explicit Data API grants for every table).
- `claude-food` was deployed once, early on, and its secrets
  `ANTHROPIC_API_KEY` and `ALLOWED_EMAILS` are set. Settings → Test connection
  returned "Connected" with that first version.

## To do, in order

1. **Redeploy `claude-food`** from `supabase/functions/claude-food/index.ts`
   with JWT verification **off** (the function checks the session or Siri
   token itself; with verification on, the browser's CORS preflight and the
   Siri shortcut both fail). The live version predates the `groceries`,
   `recommend` and `siri` tasks, so Add groceries, Ask Claude for ideas and
   Siri logging all fail until this is done. Confirm the two secrets still
   exist, but never print their values.
2. **Have the user test** in PlateIQ: Settings → Claude food assistant →
   **Test connection**, then a real label, meal, grocery receipt and
   "Ask Claude for ideas". These are the first real Claude responses for most
   of these features; if results are off, tune the prompts in
   `claude-food/index.ts` (`MEAL_SYSTEM`, `GROCERY_SYSTEM`, `REC_SYSTEM`).
3. **Siri shortcut.** Walk the user through building it on their iPhone: the
   README section "Log food with Siri" has the steps, and the URL and token
   are in Settings → Claude food assistant → Log food with Siri. Verify
   with "Hey Siri, log food", then open the app; the entry shows with 🎙️.
   If it fails, check the function logs and the `plateiq_inbox` table.
4. **Morning inventory reminder (optional; ask first).** It needs the
   updated `push-energy` function plus VAPID secrets and the pg_cron schedule
   (`supabase-push-cron.sql`). It's unknown whether the user ever set up the
   energy push reminders; check whether `push-energy` is deployed and the
   cron job exists before suggesting anything.

## Working with this user

- They follow along on an iPhone; give short, concrete steps with links.
- Build on a branch and test; when it's done, merge to `main` and push without
  asking (standing instruction, see `CLAUDE.md`).
- Bump the version in `index.html` (`APP_VERSION`), `sw.js` (`VERSION`) and
  `package.json` with each shipped change. `npm test` runs the smoke test.
- The per-feature browser tests from the last session (inventory, Siri,
  recommendations, macro split, vitamins card) were not committed; write
  new ones as needed, mocking the `claude-food` endpoint with Playwright routes.
