// racetagger-clean/scripts/capture-guide-screenshots.js
//
// Captures real desktop-app screenshots for the website /docs guide, driving the
// dev Electron build with Playwright `_electron`. Zero token spend: it only
// navigates routes / loads a historical execution — it never starts an analysis.
//
// Usage:
//   node scripts/capture-guide-screenshots.js <outDir> <sessionJsonPath> [demoExecutionId]
//
// Prerequisites (founder / Desktop Guide screenshotter agent):
//   1. `npm run compile` so dist/src/main.js (the electron entry) is current.
//   2. A logged-in macOS GUI session — macOS has no headless display; a window WILL appear.
//   3. A valid demo session.json (a dedicated demo Supabase account; see Phase 2 Task 2.4).
//      The real app stores it at app.getPath('userData')/session.json
//      (= ~/Library/Application Support/RaceTagger/session.json — productName, not the package name).
//
// Screens are defined in scripts/guide-screens.json. Each screen's `slug` MUST equal the
// `screenshot_screen` value used in racetagger-app/docs-content/*.json — that is the join key
// the Desktop Guide writer uses to wire a PNG onto the right docs page (Phase 4).
//
// NOTE — the login/auth screen is intentionally NOT captured here: a pre-seeded demo session
// makes the app boot straight into the authenticated shell (#auth-container stays hidden), so a
// "login" shot would be misleading. Capturing it would need a separate unauthenticated run —
// out of scope until a docs page actually references `screenshot_screen: "login"`.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { _electron: electron } = require('@playwright/test');

const REPO = path.resolve(__dirname, '..'); // racetagger-clean
const ELECTRON_BIN = path.join(REPO, 'node_modules', '.bin', 'electron');
const APP_READY_SELECTOR = '#main-app-container:not(.hidden)'; // authenticated shell is visible

async function main() {
  const [outDir, sessionJsonPath, demoExecutionId] = process.argv.slice(2);
  if (!outDir || !sessionJsonPath) {
    console.error('usage: node capture-guide-screenshots.js <outDir> <sessionJsonPath> [demoExecutionId]');
    process.exit(2);
  }
  if (!fs.existsSync(sessionJsonPath)) {
    console.error(`session file not found: ${sessionJsonPath}`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Isolated userData dir with a pre-seeded demo session — never touches the real profile.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-guide-'));
  fs.copyFileSync(sessionJsonPath, path.join(userDataDir, 'session.json'));

  // `href` screens leave the SPA (window.location -> results.html) and have no Navigo router,
  // so any hash screen after them would fail. Sort defensively: hash/cold first, href last —
  // independent of the order authored in guide-screens.json.
  const screens = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'guide-screens.json'), 'utf-8'))
    .slice()
    .sort((a, b) => (a.kind === 'href' ? 1 : 0) - (b.kind === 'href' ? 1 : 0));

  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: REPO,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Gate: the app must reach the authenticated shell, otherwise every capture is meaningless.
  try {
    await win.waitForSelector(APP_READY_SELECTOR, { state: 'visible', timeout: 25000 });
  } catch {
    console.error(
      `App never reached the authenticated shell (${APP_READY_SELECTOR}). ` +
        'The demo session.json is likely expired — refresh it (see Phase 2 Task 2.4).'
    );
    await app.close();
    process.exit(3);
  }

  const results = [];
  for (const s of screens) {
    try {
      if (s.kind === 'hash') {
        await win.evaluate((r) => { window.location.hash = r; }, s.route);
      } else if (s.kind === 'href') {
        const href = s.href.replace('__DEMO_EXECUTION_ID__', demoExecutionId || '');
        await win.evaluate((h) => { window.location.href = h; }, href);
      }
      await win.waitForSelector(s.selector, { state: 'visible', timeout: 15000 });
      await win.waitForTimeout(800); // settle animations / async data
      const file = path.join(outDir, `${s.slug}.png`);
      await win.screenshot({ path: file });
      results.push({ slug: s.slug, status: 'ok', file });
      console.log(`OK   ${s.slug} -> ${file}`);
    } catch (err) {
      results.push({ slug: s.slug, status: 'failed', error: String((err && err.message) || err) });
      console.error(`FAIL ${s.slug}: ${err}`);
    }
  }

  await app.close();
  fs.writeFileSync(path.join(outDir, '_capture-report.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === 'failed');
  console.log(`\nCaptured ${results.length - failed.length}/${results.length}. Report: ${path.join(outDir, '_capture-report.json')}`);
  // Fail the run only if EVERY screen failed (a single bad selector shouldn't block the rest).
  process.exit(failed.length === results.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
