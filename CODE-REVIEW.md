# PlateIQ code review

Review of the app as of commit `4120ebe` (v86), with the status of each finding
after the follow-up commits on this branch. The app is a single-file PWA
(`index.html`, ~6,800 lines) plus a service worker and optional Supabase
backend. The product design and the feature set are strong; the review focuses
on correctness, safety, maintainability, accessibility and UI polish.

Status key: **Fixed** (in this branch) · **Deferred** (noted, with the reason).

## 1. Correctness and safety

| # | Finding | Severity | Status |
|---|---------|----------|--------|
| 1.1 | Names, serving strings, brands, recipe text and imported CSV fields were interpolated into `innerHTML` without escaping in ~20 templates (meal builder, saved meals, recipes, planner, meal picker, search rows, scan results, MFP history). These strings come from Open Food Facts (user-contributed), USDA, uploaded PDFs and CSVs, so a crafted product name could inject markup/script into the page. | High | Fixed: every template goes through `escapeHtml`; `pickRow` escapes its macro line for all callers. |
| 1.2 | `foodIcon()` built an inline `onerror` handler by concatenating the emoji into a JS string literal. | Medium | Fixed: handler reads a `data-emoji` attribute. |
| 1.3 | Planner day keys used `toISOString()` (UTC) while the diary used local dates. West of Greenwich, evening use filed the plan under tomorrow. | High | Fixed: planner uses the same local `dkey()`. Existing plans created in the evening may appear one day later than intended; reassign them once. |
| 1.4 | `calcMealMacros`, `renderBuilder`, `adjustQty`, `addFoodToMeal` and `saveMeal` were each defined twice; `switchTab`, `overlayClick`, `openSettings`, `renderHistory`, `closeSettings` and `saveState` were monkey-patched near the end of the file. Behaviour depended on evaluation order and the first definitions were dead. | Medium | Fixed: one definition each; the boot sequence is a single block at the end of the script. |
| 1.5 | `assignTarget` was assigned without ever being declared (implicit global). | Low | Fixed. |
| 1.6 | `saveState()` had no `try/catch`; custom photos (data URLs) and scanned product images can exceed the localStorage quota, after which every save silently failed. | High | Fixed: `persistLocal()` catches the quota error and shows one toast. |
| 1.7 | `renderDays()` wrote empty planner slots into `state` on every render, growing every save. | Low | Fixed: render is read-only. |
| 1.8 | `toggleDay()` only ever set `display:block`; day headers were clickable but did nothing. | Low | Fixed: real collapse/expand. |
| 1.9 | Restore accepted any JSON and `Object.assign`ed it over state; Reset cleared the diary but not imported MyFitnessPal data. | Medium | Fixed: backup shape is validated, `sync` is never restored from a file, Reset clears both keys and the confirm text explains cloud data stays. |
| 1.10 | `parseCSV` did not handle `""` escapes inside quoted fields, which MyFitnessPal uses in food names. | Medium | Fixed. |
| 1.11 | Barcode lookup read only `energy-kcal`; search already fell back to kJ. Products labelled only in kJ showed 0 kcal when scanned. | Medium | Fixed: shared `offKcalFrom()`. |
| 1.12 | Recipe macro estimation matched any library food whose *first word* appeared anywhere in an ingredient line ("raw", "bell", "blue"), producing wrong estimates. | Medium | Fixed: whole-name phrase match, or a distinctive (≥5 letter) first word; longest name wins. |
| 1.13 | Invalid CSS: `color(var(--text3))` and `background:${barColor}20` (a hex-alpha suffix appended to a `var()`), so those styles never applied. | Low | Fixed. |
| 1.14 | Settings inputs were read with `+value`; a blank weight produced NaN/0 targets and division by zero in progress bars. | Medium | Fixed: clamped with sane ranges. |
| 1.15 | Drag-to-rate assigned `window.onmousemove/onmouseup` on every render, clobbering any other handler. | Low | Fixed: listeners bound once. |
| 1.16 | Service worker cached *any* navigation response, so a 404/500 from the host would overwrite the last good copy of the app shell. | Medium | Fixed: only `res.ok` responses are cached. |
| 1.17 | Steps chart legend listed a "Phone" source the chart never draws. | Low | Fixed: removed. |
| 1.18 | Export was labelled "Excel" but produced CSV. | Low | Fixed: labelled CSV (opens in Excel/Numbers/Sheets). |
| 1.19 | `estimateMacrosFromIngredients`, `parseRecipeFromText` are heuristic and will still mis-parse many layouts (two-column PDFs, metric/imperial mixes). | Low | Deferred: a rule-based parser has a ceiling; the review screen lets the user correct it. |
| 1.20 | Cloud merge (`mergeCloudInto`) uses last-writer-wins per top-level key for `settings`/`planner` and union-by-id elsewhere. Two devices editing the same day offline will keep both edits (good) but a deleted entry on one device can be resurrected if the other device's tombstone is older than its last use. | Medium | Deferred: acceptable for a single-user app; a per-entry `updatedAt` would be the proper fix and changes the schema. |
| 1.21 | `DEFAULT_USDA_KEY`, Supabase anon key, Google client ID and VAPID public key ship in the client. These are public-by-design credentials; row-level security and OAuth origin restrictions are the real controls. | Info | No change. Rotate the USDA key if its quota is ever exhausted by other users of the deployed site. |

## 2. UI and UX

| # | Finding | Status |
|---|---------|--------|
| 2.1 | No dark theme; one stray `prefers-color-scheme: dark` rule turned the water buttons into low-contrast blue on a white card. | Fixed: full token-based dark scheme, Auto/Light/Dark in Settings, applied before first paint, `theme-color` follows. |
| 2.2 | Tab bar at the top with emoji icons; on a phone the primary navigation belongs at the bottom within thumb reach, and emoji render differently per OS. | Fixed: bottom tab bar with inline SVG icons and safe-area padding; vector settings gear. |
| 2.3 | `user-scalable=no, maximum-scale=1` blocked pinch zoom (WCAG 1.4.4). The reason it was there (iOS zooming on input focus) is solved by 16px inputs. | Fixed. |
| 2.4 | No safe-area handling for notched iPhones (top bar, sheets, toast). | Fixed: `viewport-fit=cover` + `env(safe-area-inset-*)`. |
| 2.5 | Toast was `white-space: nowrap`, so longer messages overflowed narrow screens. | Fixed: wraps, max-width, sits above the tab bar, `aria-live`. |
| 2.6 | Water goal used a browser `prompt()`. | Fixed: Settings field; tapping the total opens it. |
| 2.7 | No visible way back to today after paging through days (the date label was secretly tappable). | Fixed: "Back to today" pill. |
| 2.8 | Saved meals could only be edited or deleted; logging one meant going through the diary's Meals tab. Auto-saved meals were indistinguishable from hand-built ones. | Fixed: Log button and "auto" badge. |
| 2.9 | Trends "no data" message was squeezed into the first of four grid columns. | Fixed. |
| 2.10 | 366 inline `style=""` attributes; the most repeated (notes, link buttons, textareas, selects) hid the design system. | Partly fixed: shared `.note`, `.note-sm`, `.link-btn`, `.field`, `.row-between`, `.btn-danger` classes; ~340 inline styles remain in generated markup. Deferred: a full extraction is mechanical but large. |
| 2.11 | Native `confirm()` dialogs for deletes (5 places). | Deferred: fine for a personal PWA; an in-app confirm sheet is a nice-to-have. |
| 2.12 | First-run experience: the Today screen shows zeroed cards and the energy prompt immediately. A short onboarding (set weight/height/goal) would raise the first impression. | Deferred: product decision. |

## 3. Accessibility

| # | Finding | Status |
|---|---------|--------|
| 3.1 | Tabs, chips, export tiles, swipe buttons, day/week arrows, "Not now", the water total and every generated list row were `<div>`/`<span>` with `onclick`: unreachable by keyboard and unnamed for screen readers. | Fixed: real `<button>`s with `aria-label`s; clickable cards get `role=button` + keyboard activation. |
| 3.2 | Sheets had no `role=dialog`/`aria-modal`, no Escape to close, no body scroll lock. | Fixed. |
| 3.3 | Form labels were not associated with their inputs; search inputs had no accessible name. | Fixed where the field has an id; `aria-label` elsewhere. |
| 3.4 | No `:focus-visible` styling; no `prefers-reduced-motion`. | Fixed. |
| 3.5 | Focus is not trapped inside open sheets and not returned to the opener on close. | Deferred: needs a small focus-management helper; Escape and backdrop-tap close already work. |
| 3.6 | Colour contrast of `--text3` (#A8A39D on #FFF, ~2.4:1) for secondary labels is below AA for small text. | Deferred: it is used for de-emphasised hints; darkening it changes the visual hierarchy, so this is a design call. |

## 4. Maintainability

| # | Finding | Status |
|---|---------|--------|
| 4.1 | One 6,800-line HTML file with styles, markup, ~300-item food library and all logic. Works, but every change is a diff against one file and nothing can be unit-tested in isolation. | Deferred: splitting into `app.js`, `foods.js`, `styles.css` is straightforward and keeps "no build step"; recommended as the next structural step. |
| 4.2 | No tests of any kind. | Fixed: `tools/smoke.js` drives the app headless in light and dark (tabs, settings, add/log food, builder, planner, exports, Escape, theme) and fails on console errors; `npm test`; runs in CI on pushes and PRs. |
| 4.3 | Two version strings to bump by hand (`APP_VERSION`, service-worker `VERSION`). | Deferred: a one-line script could stamp both; noted in README. |
| 4.4 | README described features that do not exist (Google Drive backup, Excel export, Fitbit implicit-grant as primary). | Fixed. |
| 4.5 | `console.log` of Google Health debug payloads and clipboard copy on a failed sync is useful for the author but surprising for a user. | Deferred: low impact. |

## 5. Backend (Supabase)

The schema is sound: row-level security on every table, a `SECURITY DEFINER`
RPC scoped to one insert, service-role only inside the edge function. Two notes:

- `plateiq_tokens` has no `delete` policy, so a user cannot rotate their ingest
  token from the app. Deferred (needs a UI affordance and a policy).
- The edge function computes "local hour" with `toLocaleString`, which returns
  `"24"` at midnight in some runtimes; `hour >= wake_end` then skips the user
  for that slot. Harmless, but `% 24` would be exact. Deferred.
