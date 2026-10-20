#!/usr/bin/env node
/*
 * PlateIQ smoke test.
 *
 * Serves the repo on a local port, drives the app in headless Chromium (light
 * and dark colour schemes, iPhone-sized viewport) and fails if any step throws
 * or the page logs a console error. Screenshots land in tools/smoke-out/.
 *
 *   npm install          # once (installs playwright)
 *   npx playwright install chromium
 *   npm test
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'smoke-out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
}

// Requests to third-party CDNs/fonts are not part of what we test, and are
// blocked in some CI sandboxes; only count errors that originate in the app.
const NETWORK_NOISE = /ERR_TUNNEL|ERR_PROXY|net::|Failed to load resource/;

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = serve();
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const failures = [];
  const errors = [];

  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !NETWORK_NOISE.test(m.text())) errors.push(`[${scheme}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${scheme}] ${e.message}`));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const step = async (name, fn) => {
      try { await fn(); console.log(`ok    ${scheme.padEnd(5)} ${name}`); }
      catch (e) { failures.push(`${scheme} ${name}: ${e.message.split('\n')[0]}`); console.log(`FAIL  ${scheme.padEnd(5)} ${name}: ${e.message.split('\n')[0]}`); }
    };
    const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`), fullPage: true });

    await shot('today');

    await step('switch every tab', async () => {
      for (const id of ['foods', 'builder', 'planner', 'history', 'today']) {
        await page.evaluate((id) => switchTab(id), id);
        await page.waitForTimeout(60);
        await shot(`tab-${id}`);
      }
    });

    await step('settings drawer opens and closes', async () => {
      await page.evaluate(() => openSettings());
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `settings-${scheme}.png`) });
      await page.evaluate(() => closeSettings());
      const open = await page.evaluate(() => document.getElementById('settings-overlay').classList.contains('open'));
      if (open) throw new Error('settings still open');
    });

    await step('custom food is escaped and logged to the diary', async () => {
      await page.evaluate(() => openAddFood());
      await page.fill('#cf-name', 'Smoke Yogurt <b>x</b>');
      await page.fill('#cf-kcal', '120'); await page.fill('#cf-protein', '15'); await page.fill('#cf-carbs', '8'); await page.fill('#cf-fat', '2');
      await page.evaluate(() => saveCustomFood());
      const id = await page.evaluate(() => state.customFoods[state.customFoods.length - 1].id);
      await page.evaluate(() => openLogModal('Lunch'));
      await page.waitForTimeout(50);
      await page.screenshot({ path: path.join(OUT, `log-modal-${scheme}.png`) });
      await page.evaluate((id) => logFood(id), id);
      await page.evaluate(() => confirmLog());
      await page.waitForTimeout(50);
      const kcal = await page.evaluate(() => document.getElementById('bd-food').textContent);
      if (kcal !== '120') throw new Error(`diary shows ${kcal} kcal, expected 120`);
      const html = await page.evaluate(() => document.getElementById('diary-meals').innerHTML);
      if (html.includes('<b>x</b>')) throw new Error('food name rendered as HTML');
    });

    await step('meal builder saves a meal', async () => {
      const id = await page.evaluate(() => state.customFoods[state.customFoods.length - 1].id);
      await page.evaluate(() => switchTab('builder'));
      await page.evaluate((id) => addFoodToMeal(id), id);
      const html = await page.evaluate(() => document.getElementById('meal-items').innerHTML);
      if (html.includes('<b>x</b>')) throw new Error('food name rendered as HTML in builder');
      await page.fill('#meal-name-input', 'Smoke meal');
      await page.evaluate(() => saveMeal());
      const n = await page.evaluate(() => state.savedMeals.filter((m) => m.name === 'Smoke meal').length);
      if (n !== 1) throw new Error('meal not saved');
      await page.evaluate(() => builderView('saved', document.querySelectorAll('#screen-builder .foods-tab')[1]));
      await shot('saved-meals');
    });

    await step('recommendations open', async () => {
      await page.evaluate(() => openRecommend());
      await page.waitForTimeout(50);
      await page.screenshot({ path: path.join(OUT, `recommend-${scheme}.png`) });
      await page.evaluate(() => closeModal('recommend-modal'));
    });

    await step('planner assigns a saved meal', async () => {
      await page.evaluate(() => switchTab('planner'));
      await page.evaluate(() => openMealAssign(dkey(new Date()), 'Lunch'));
      const mid = await page.evaluate(() => state.savedMeals.find((m) => m.name === 'Smoke meal').id);
      await page.evaluate((mid) => assignMeal(mid, 'meal'), mid);
      const txt = await page.evaluate(() => document.getElementById('days-container').textContent);
      if (!txt.includes('Smoke meal')) throw new Error('assigned meal not shown');
    });

    await step('backup and CSV export do not throw', async () => {
      await page.evaluate(() => { exportJSON(); exportCSV(); });
    });

    await step('Escape closes the top sheet', async () => {
      await page.evaluate(() => openAddFood());
      await page.keyboard.press('Escape');
      await page.waitForTimeout(50);
      const open = await page.evaluate(() => document.getElementById('add-food-modal').classList.contains('open'));
      if (open) throw new Error('sheet still open after Escape');
    });

    await step('theme override applies', async () => {
      await page.evaluate(() => { state.settings.theme = 'dark'; applyTheme(); });
      const t = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (t !== 'dark') throw new Error('data-theme not set');
      await page.evaluate(() => { state.settings.theme = 'auto'; applyTheme(); });
    });

    await ctx.close();
  }

  await browser.close();
  server.close();

  console.log(`\n${failures.length} failing step(s), ${errors.length} console/page error(s)`);
  errors.slice(0, 20).forEach((e) => console.log('  ' + e));
  process.exit(failures.length || errors.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
