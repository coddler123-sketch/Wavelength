const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

let app, win, userDataDir;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavelength-e2e-'));
  app = await electron.launch({
    args: [ROOT, `--user-data-dir=${userDataDir}`],
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
  try {
    await app.evaluate(() => process.exit(0));
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
  fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
  const badgeText = await win.evaluate(
    () => document.querySelector('#sleep-badge')?.textContent?.trim() ?? ''
  );
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
  const modal = win.locator('#history-modal');
  await win.locator('#track-info-container').click();
  await expect(modal).toBeVisible();
  await win.locator('#history-close-btn').click();
  await expect(modal).toBeHidden();
});

test('Stream-Abbruch löst Reconnect-Status aus und Stop bricht ihn ab', async () => {
  const btn = win.locator('#btn-playstop');

  // Ensure we start in playing state (aria-pressed="true" means playing)
  const isAlreadyPlaying = await btn.evaluate((el) => el.getAttribute('aria-pressed') === 'true');
  if (!isAlreadyPlaying) {
    await btn.click({ force: true });
    await expect(btn).toHaveAttribute('aria-pressed', 'true', { timeout: 3000 });
  }

  // Simulate a stream stall while playing — scheduleReconnect() should fire
  await win.evaluate(() => document.getElementById('audio').dispatchEvent(new Event('stalled')));
  await expect(win.locator('body')).toHaveClass(/reconnecting/, { timeout: 2000 });

  // Stop during backoff must cancel the timer and clear the reconnecting state
  await btn.click({ force: true });
  await win.waitForTimeout(300);
  await expect(win.locator('body')).not.toHaveClass(/reconnecting/);
});

test('Mini-Modus umschalten zeigt Mini-View', async () => {
  const body = win.locator('body');
  const miniView = win.locator('#mini-view');
  await win.locator('#btn-toggle-mini').click();
  await expect(body).toHaveClass(/mini-mode/);
  await expect(miniView).toBeVisible();
  await win.locator('#mini-expand').click();
  await expect(body).not.toHaveClass(/mini-mode/);
  await expect(miniView).toBeHidden();
});

// Regression für v1.7.6: Kaltstart im Mini-Modus mit aktivem WebGL-Modus →
// Expand darf keinen verzerrten Visualizer hinterlassen (Buffer muss der
// Layout-Box entsprechen). Braucht eine eigene App-Instanz mit eigenem
// userData-Verzeichnis, weil der Mini-Zustand über einen Neustart hinweg
// persistiert werden muss.
test('Mini-Kaltstart → Voll: WebGL-Canvas-Buffer entspricht Layout-Box', async () => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavelength-e2e-mini-'));

  const launchApp = async () => {
    const a = await electron.launch({
      args: [ROOT, `--user-data-dir=${dir}`],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    const w = await a.firstWindow();
    await a.evaluate(({ BrowserWindow }) => {
      const [x] = BrowserWindow.getAllWindows();
      if (x) x.show();
    });
    await w.waitForLoadState('domcontentloaded');
    await w.waitForSelector('.station-item', { state: 'attached', timeout: 45_000 });
    await w.evaluate(() => {
      localStorage.setItem('wl.onboardingDone', '1');
      localStorage.setItem('wl.shortcutsHintSeen', '1');
      const m = document.getElementById('onboarding-modal');
      if (m) m.classList.add('hidden');
    });
    return { a, w };
  };

  const quit = async (a) => {
    try {
      await a.evaluate(() => process.exit(0));
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  };

  // Lauf 1: WebGL-Modus aktivieren, in den Mini-Modus wechseln, beenden
  {
    const { a, w } = await launchApp();
    await w.evaluate(() => localStorage.setItem('wl.visualizerMode', 'mandala3d'));
    await w.locator('#btn-toggle-mini').click();
    await w.waitForTimeout(500);
    await quit(a);
  }

  // Lauf 2: Kaltstart landet im Mini-Modus, dann expandieren und Größen prüfen
  {
    const { a, w } = await launchApp();
    await expect(w.locator('body')).toHaveClass(/mini-mode/);
    await w.locator('#mini-expand').click();
    await w.waitForSelector('#visualizer-webgl', { state: 'attached', timeout: 10_000 });
    await w.waitForTimeout(1000); // ResizeObserver-Debounce + erster WebGL-Frame

    const m = await w.evaluate(() => {
      const c = document.getElementById('visualizer-webgl');
      const r = c.getBoundingClientRect();
      return {
        buffer: { w: c.width, h: c.height },
        rect: { w: Math.round(r.width), h: Math.round(r.height) },
        dpr: window.devicePixelRatio,
      };
    });
    // Muss die Voll-Ansicht füllen, nicht die stale Mini-Größe (290×56) behalten
    expect(m.rect.w).toBeGreaterThan(300);
    expect(Math.abs(m.buffer.w - Math.round(m.rect.w * m.dpr))).toBeLessThanOrEqual(2);
    expect(Math.abs(m.buffer.h - Math.round(m.rect.h * m.dpr))).toBeLessThanOrEqual(2);
    await quit(a);
  }

  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('Equalizer-Popover: Slider setzen, Reset, Persistenz', async () => {
  const btn = win.locator('#btn-eq');
  const popover = win.locator('#eq-popover');
  await expect(popover).toBeHidden();

  await btn.click();
  await expect(popover).toBeVisible();

  // Regression: the popover must fit entirely within the fixed 460×520 window
  // (the trigger button sits mid-window, not at the top, so a naive
  // open-downward-only positioning clips the bottom rows off-screen).
  const bounds = await win.evaluate(() => {
    const r = document.getElementById('eq-popover').getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      winW: window.innerWidth,
      winH: window.innerHeight,
    };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.winH);
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.winW);
  await expect(win.locator('#eq-treble')).toBeInViewport();
  await expect(win.locator('#eq-reset')).toBeInViewport();

  await win.evaluate(() => {
    const el = document.getElementById('eq-bass');
    el.value = '6';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(win.locator('#eq-bass-val')).toHaveText('6 dB');

  const stored = await win.evaluate(() => localStorage.getItem('wl.eqBass'));
  expect(stored).toBe('6');

  await win.locator('#eq-reset').click();
  await expect(win.locator('#eq-bass-val')).toHaveText('0 dB');
  const storedAfterReset = await win.evaluate(() => localStorage.getItem('wl.eqBass'));
  expect(storedAfterReset).toBe('0');

  await btn.click();
  await expect(popover).toBeHidden();
});

test('Hörstatistik-Modal zeigt gehörten Sender nach Wiedergabe', async () => {
  // Play/stop briefly so at least one station accrues listen time.
  const playBtn = win.locator('#btn-playstop');
  const wasPlaying = (await playBtn.getAttribute('aria-pressed')) === 'true';
  if (!wasPlaying) {
    await playBtn.click({ force: true });
    await win.waitForTimeout(1200);
    await playBtn.click({ force: true });
    await win.waitForTimeout(200);
  }

  await win.locator('#btn-settings').click();
  await expect(win.locator('#settings-modal')).toBeVisible();

  await win.locator('#btn-show-stats').click();
  await expect(win.locator('#settings-modal')).toBeHidden();
  await expect(win.locator('#stats-modal')).toBeVisible();

  const overallText = await win.locator('#stats-overall').textContent();
  expect(overallText.length).toBeGreaterThan(0);

  await win.locator('#stats-close-btn').click();
  await expect(win.locator('#stats-modal')).toBeHidden();
});
