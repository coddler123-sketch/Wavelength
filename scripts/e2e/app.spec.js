const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

async function launchApp() {
  return electron.launch({
    args: [ROOT],
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

test('Fenster öffnet und Haupt-UI ist sichtbar', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('#station-list', { timeout: 10_000 });
  await expect(win.locator('#station-list')).toBeVisible();
  await app.close();
});

test('Senderliste enthält mindestens einen Eintrag', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.station-item', { timeout: 15_000 });
  const count = await win.locator('.station-item').count();
  expect(count).toBeGreaterThan(0);
  await app.close();
});

test('Play/Stop-Button wechselt Zustand', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('#btn-playstop', { timeout: 10_000 });
  const btn = win.locator('#btn-playstop');
  const ariaBefore = await btn.getAttribute('aria-label');
  await btn.click();
  await win.waitForTimeout(500);
  const ariaAfter = await btn.getAttribute('aria-label');
  // Label should have changed (Abspielen ↔ Stoppen)
  expect(ariaAfter).not.toBe(ariaBefore);
  await app.close();
});

test('Station auswählen aktualisiert den Sendernamen', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.station-item', { timeout: 15_000 });
  const first = win.locator('.station-item').first();
  const stationName = await first.locator('.item-name').textContent();
  await first.click();
  await win.waitForTimeout(300);
  const activeLabel = await win.locator('#active-station-name').textContent();
  expect(activeLabel).toBe(stationName.trim());
  await app.close();
});

test('Suchfeld filtert die Senderliste', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.station-item', { timeout: 15_000 });
  const totalBefore = await win.locator('.station-item').count();
  await win.locator('#station-search').fill('xxxxnotexist');
  await win.waitForTimeout(200);
  const totalAfter = await win.locator('.station-item').count();
  expect(totalAfter).toBeLessThan(totalBefore);
  await app.close();
});

test('Mini-Modus umschalten zeigt Mini-View', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('#btn-mini', { timeout: 10_000 });
  await win.locator('#btn-mini').click();
  await win.waitForTimeout(500);
  const miniVisible = await win.locator('#mini-view').isVisible();
  expect(miniVisible).toBe(true);
  await app.close();
});
