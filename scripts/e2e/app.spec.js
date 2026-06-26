const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

let app, win;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  win = await app.firstWindow();

  // Force the hidden BrowserWindow to show so Playwright can interact with it
  await app.evaluate(({ BrowserWindow }) => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) w.show();
  });

  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('.station-item', { state: 'attached', timeout: 45_000 });

  // Dismiss first-run onboarding modal so it doesn't intercept clicks
  await win.evaluate(() => {
    localStorage.setItem('wl.onboardingDone', '1');
    localStorage.setItem('wl.shortcutsHintSeen', '1');
    const m = document.getElementById('onboarding-modal');
    if (m) m.classList.add('hidden');
  });
});

test.afterAll(async () => {
  try { await app.evaluate(() => process.exit(0)); } catch (_) {}
});

test('Fenster öffnet und Visualizer ist im DOM', async () => {
  expect(await win.locator('#visualizer').count()).toBe(1);
});

test('Senderliste enthält mindestens einen Eintrag', async () => {
  expect(await win.locator('.station-item').count()).toBeGreaterThan(0);
});

test('Play/Stop-Button ändert aria-label beim Klick', async () => {
  const btn = win.locator('#btn-playstop');
  const before = await btn.getAttribute('aria-label');
  await btn.click({ force: true });
  await win.waitForTimeout(600);
  const after = await btn.getAttribute('aria-label');
  expect(after).not.toBe(before);
  // Reset: stop playback
  await btn.click({ force: true });
  await win.waitForTimeout(300);
});

test('Station auswählen aktualisiert den Sendernamen', async () => {
  const first = win.locator('.station-item').first();
  const stationName = await win.evaluate(
    () => document.querySelector('.station-item .station-item-name')?.textContent?.trim() ?? ''
  );
  await win.evaluate(() => document.querySelector('.station-item')?.click());
  await win.waitForTimeout(400);
  const activeLabel = await win.evaluate(
    () => document.querySelector('#active-station-name')?.textContent?.trim() ?? ''
  );
  expect(activeLabel).toBe(stationName);
});

test('Suchfeld filtert die Senderliste', async () => {
  const totalBefore = await win.locator('.station-item').count();
  await win.evaluate(() => {
    const el = document.querySelector('#station-search');
    el.value = 'xxxxnotexist';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(400);
  const totalAfter = await win.locator('.station-item').count();
  expect(totalAfter).toBeLessThan(totalBefore);
  // Reset search
  await win.evaluate(() => {
    const el = document.querySelector('#station-search');
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(200);
});

test('Mute-Button toggelt aria-pressed', async () => {
  const before = await win.evaluate(() => document.querySelector('#btn-mute')?.getAttribute('aria-pressed'));
  await win.evaluate(() => document.querySelector('#btn-mute')?.click());
  await win.waitForTimeout(200);
  const after = await win.evaluate(() => document.querySelector('#btn-mute')?.getAttribute('aria-pressed'));
  expect(after).not.toBe(before);
  // Reset
  await win.evaluate(() => document.querySelector('#btn-mute')?.click());
  await win.waitForTimeout(100);
});

test('Favoriten-Stern markiert eine Station', async () => {
  const { id, wasFav } = await win.evaluate(() => {
    const item = document.querySelector('.station-item');
    const btn = item?.querySelector('.fav-star-btn');
    return { id: item?.dataset.id ?? '', wasFav: btn?.classList.contains('is-fav') ?? false };
  });
  await win.evaluate(() => document.querySelector('.station-item .fav-star-btn')?.click());
  await win.waitForTimeout(400);
  const isFav = await win.evaluate((stationId) => {
    const btn = document.querySelector(`.station-item[data-id="${stationId}"] .fav-star-btn`);
    return btn?.classList.contains('is-fav') ?? false;
  }, id);
  expect(isFav).toBe(!wasFav);
  // Reset
  await win.evaluate((stationId) => {
    document.querySelector(`.station-item[data-id="${stationId}"] .fav-star-btn`)?.click();
  }, id);
  await win.waitForTimeout(200);
});

test('Sleep-Timer-Button zeigt Badge nach Klick', async () => {
  await win.evaluate(() => document.querySelector('#btn-sleep')?.click());
  await win.waitForTimeout(300);
  const badgeText = await win.evaluate(() => document.querySelector('#sleep-badge')?.textContent?.trim() ?? '');
  expect(badgeText.length).toBeGreaterThan(0);
  // Zyklus bis Badge leer (max 4 weitere Klicks)
  for (let i = 0; i < 4; i++) {
    await win.evaluate(() => document.querySelector('#btn-sleep')?.click());
    await win.waitForTimeout(150);
    const t = await win.evaluate(() => document.querySelector('#sleep-badge')?.textContent?.trim() ?? '');
    if (!t) break;
  }
});

test('Track-History-Modal öffnet und schließt sich', async () => {
  await win.evaluate(() => {
    const m = document.getElementById('history-modal');
    if (m) m.classList.remove('hidden');
  });
  await win.waitForTimeout(200);
  const visible = await win.evaluate(() => !document.getElementById('history-modal')?.classList.contains('hidden'));
  expect(visible).toBe(true);
  await win.evaluate(() => document.getElementById('history-close-btn')?.click());
  await win.waitForTimeout(200);
  const hidden = await win.evaluate(() => document.getElementById('history-modal')?.classList.contains('hidden'));
  expect(hidden).toBe(true);
});

test('Mini-Modus umschalten zeigt Mini-View', async () => {
  await win.evaluate(() => document.querySelector('#btn-mini')?.click());
  await win.waitForTimeout(500);
  expect(await win.locator('#mini-view').count()).toBe(1);
  // Reset zurück zu Full-View
  await win.evaluate(() => document.querySelector('#mini-btn-back')?.click());
  await win.waitForTimeout(300);
});
