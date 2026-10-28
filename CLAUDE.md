# PlateIQ

Static PWA (`index.html` + `sw.js`, no build step) on GitHub Pages, with an
optional Supabase project (`tilwmgmyyzmbmvtjsqgx`) for sync, Web Push and the
`claude-food` edge function. See `README.md` for setup and features.

If `HANDOFF.md` exists, read it first: it lists unfinished work from the
previous session.

## Shipping

When a change is finished and `npm test` passes, merge it to `main` and push
without asking first (`main` auto-deploys to GitHub Pages). Bump the version in
`index.html` (`APP_VERSION`), `sw.js` (`VERSION`) and `package.json` with each
shipped change.
