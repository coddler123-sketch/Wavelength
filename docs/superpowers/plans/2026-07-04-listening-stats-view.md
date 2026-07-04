# Listening Stats View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "listening stats" modal, reachable from Settings, that lists stations by total listening time using data that's already tracked in localStorage.

**Architecture:** A pure sorting/filtering function (`buildStatsList`) lives in the existing UMD `utils.js` module so it's unit-testable in Node exactly like `buildRecentsList`. A thin `localStorage`-reading glue function (`collectListenData`) lives in `renderer-ui.js`. The modal itself (HTML markup, open/close, rendering) is wired in `renderer.js`, mirroring the existing `#history-modal` pattern line-for-line.

**Tech Stack:** Vanilla JS (ES modules + one UMD module), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-04-listening-stats-view-design.md`

---

## File Structure

| File                      | Change                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/test.js`         | New unit tests for `buildStatsList`                                                                                                  |
| `src/utils.js`            | New pure function `buildStatsList(stations, listenData)`                                                                             |
| `src/renderer-ui.js`      | New function `collectListenData(stations)`                                                                                           |
| `src/index.html`          | New "Statistik" section in `#settings-modal`; new `#stats-modal`                                                                     |
| `src/index.css`           | New `.stats-*` styles                                                                                                                |
| `src/i18n.js`             | New keys: `settings.stats`, `stats.show`, `stats.title`, `stats.overall`, `stats.today`, `stats.empty` (DE+EN)                       |
| `src/renderer.js`         | Import `collectListenData`; destructure `buildStatsList`/`formatListen` from `window.utils`; new render/show/hide functions + wiring |
| `scripts/e2e/app.spec.js` | New E2E test                                                                                                                         |

---

### Task 1: Write failing unit tests for `buildStatsList` (red)

**Files:**

- Modify: `scripts/test.js`

- [ ] **Step 1: Add `buildStatsList` to the utils.js require**

Find (around line 1667):

```js
const { getStationCategory, getLanguageLabel, filterStations, buildRecentsList } = require('../src/utils.js');
```

Replace with:

```js
const {
  getStationCategory,
  getLanguageLabel,
  filterStations,
  buildRecentsList,
  buildStatsList,
} = require('../src/utils.js');
```

- [ ] **Step 2: Add the tests**

Find the `buildRecentsList` test block (around line 1865-1880) and add these tests immediately after it:

```js
// ── utils: buildStatsList ─────────────────────────
test('buildStatsList: sortiert nach Gesamt-Hördauer absteigend', () => {
  const stations = [
    { id: 'a', name: 'Sender A' },
    { id: 'b', name: 'Sender B' },
  ];
  const listenData = { a: { total: 1000, today: 0 }, b: { total: 5000, today: 200 } };
  const result = buildStatsList(stations, listenData);
  assert.equal(result[0].id, 'b');
  assert.equal(result[1].id, 'a');
});

test('buildStatsList: filtert Sender ohne Hördauer heraus', () => {
  const stations = [
    { id: 'a', name: 'Sender A' },
    { id: 'b', name: 'Sender B' },
  ];
  const listenData = { a: { total: 0, today: 0 } };
  const result = buildStatsList(stations, listenData);
  assert.deepEqual(result, []);
});

test('buildStatsList: fehlende listenData ergibt gefilterte leere Liste', () => {
  const stations = [{ id: 'a', name: 'Sender A' }];
  const result = buildStatsList(stations, {});
  assert.deepEqual(result, []);
});

test('buildStatsList: enthält id, name, total und today pro Sender', () => {
  const stations = [{ id: 'a', name: 'Sender A' }];
  const listenData = { a: { total: 3000, today: 1000 } };
  const result = buildStatsList(stations, listenData);
  assert.deepEqual(result, [{ id: 'a', name: 'Sender A', total: 3000, today: 1000 }]);
});
```

- [ ] **Step 3: Run the tests and confirm they fail (red)**

Run: `node --test scripts/test.js 2>&1 | Select-String "not ok"` (PowerShell)
Expected: 4 `not ok` failures referencing `buildStatsList is not a function` or similar (it doesn't exist yet in `utils.js`).

- [ ] **Step 4: Commit**

```bash
git add scripts/test.js
git commit -m "test: add failing tests for buildStatsList ahead of stats view implementation"
```

---

### Task 2: Implement `buildStatsList` in utils.js (green)

**Files:**

- Modify: `src/utils.js`

- [ ] **Step 1: Add the function**

Find (around line 182, right after `buildRecentsList`):

```js
function buildRecentsList(ids, newId, max = 5) {
  return [newId, ...ids.filter((x) => x !== newId)].slice(0, max);
}
```

Add immediately after it:

```js
function buildStatsList(stations, listenData) {
  return stations
    .map((s) => ({
      id: s.id,
      name: s.name,
      total: listenData[s.id]?.total ?? 0,
      today: listenData[s.id]?.today ?? 0,
    }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);
}
```

- [ ] **Step 2: Export it**

Find (around line 208):

```js
exports.buildRecentsList = buildRecentsList;
```

Replace with:

```js
exports.buildRecentsList = buildRecentsList;
exports.buildStatsList = buildStatsList;
```

- [ ] **Step 3: Run the tests and confirm they pass**

Run: `node --test scripts/test.js 2>&1 | Select-String "# pass|# fail"` (PowerShell)
Expected: `# pass 161`, `# fail 0` (157 existing + 4 new).

- [ ] **Step 4: Commit**

```bash
git add src/utils.js
git commit -m "feat: add buildStatsList pure function to utils.js"
```

---

### Task 3: Add `collectListenData` glue function in renderer-ui.js

**Files:**

- Modify: `src/renderer-ui.js`

- [ ] **Step 1: Add the function**

Find (around line 45, right after `loadInt`):

```js
export function loadInt(key, fallback) {
  const v = parseInt(localStorage.getItem(key), 10);
  return Number.isFinite(v) ? v : fallback;
}
```

Add immediately after it:

```js
export function collectListenData(stations) {
  const data = {};
  for (const s of stations) {
    data[s.id] = {
      total: loadInt(stationTotalKey(s.id), 0),
      today: loadInt(stationTodayKey(s.id), 0),
    };
  }
  return data;
}
```

- [ ] **Step 2: Run lint to confirm no issues**

Run: `npx eslint src/renderer-ui.js`
Expected: no errors, no warnings.

- [ ] **Step 3: Commit**

```bash
git add src/renderer-ui.js
git commit -m "feat: add collectListenData localStorage reader for stats view"
```

---

### Task 4: HTML markup, CSS, and i18n keys

**Files:**

- Modify: `src/index.html`
- Modify: `src/index.css`
- Modify: `src/i18n.js`

- [ ] **Step 1: Add a "Statistik" section to the settings modal**

Find (in `#settings-modal`, the "System" section):

```html
          <div class="settings-section">
            <div class="settings-section-title">System</div>
            <label class="settings-check-row">
              <input type="checkbox" id="setting-autostart" />
              <span data-i18n="settings.autostart">Mit Windows starten</span>
            </label>
          </div>
        </div>
```

Replace with (adds a new section right after "System", still inside `.settings-body`):

```html
          <div class="settings-section">
            <div class="settings-section-title">System</div>
            <label class="settings-check-row">
              <input type="checkbox" id="setting-autostart" />
              <span data-i18n="settings.autostart">Mit Windows starten</span>
            </label>
          </div>

          <div class="settings-section">
            <div class="settings-section-title" data-i18n="settings.stats">Statistik</div>
            <button class="modal-btn modal-btn-ghost" id="btn-show-stats" data-i18n="stats.show">
              Statistik anzeigen
            </button>
          </div>
        </div>
```

- [ ] **Step 2: Add the stats modal markup after the history modal**

Find:

```html
<!-- ── Track History Modal Overlay ─────────────── -->
<div
  id="history-modal"
  class="modal-overlay hidden"
  role="dialog"
  aria-modal="true"
  aria-labelledby="history-modal-title"
>
  <div class="modal-content history-modal">
    <h2 class="modal-title" id="history-modal-title" data-i18n="history.title">Wiedergabeverlauf</h2>
    <div id="history-list" class="history-list" aria-live="polite"></div>
    <div class="modal-buttons modal-buttons--full">
      <button class="modal-btn modal-btn-ghost" id="history-clear-btn" data-i18n="history.clear">
        Verlauf löschen
      </button>
      <button class="modal-btn" id="history-close-btn" data-i18n="about.close">Schließen</button>
    </div>
  </div>
</div>
```

Replace with (keeps the history modal unchanged, adds the new stats modal right after it):

```html
<!-- ── Track History Modal Overlay ─────────────── -->
<div
  id="history-modal"
  class="modal-overlay hidden"
  role="dialog"
  aria-modal="true"
  aria-labelledby="history-modal-title"
>
  <div class="modal-content history-modal">
    <h2 class="modal-title" id="history-modal-title" data-i18n="history.title">Wiedergabeverlauf</h2>
    <div id="history-list" class="history-list" aria-live="polite"></div>
    <div class="modal-buttons modal-buttons--full">
      <button class="modal-btn modal-btn-ghost" id="history-clear-btn" data-i18n="history.clear">
        Verlauf löschen
      </button>
      <button class="modal-btn" id="history-close-btn" data-i18n="about.close">Schließen</button>
    </div>
  </div>
</div>

<!-- ── Listening Stats Modal Overlay ────────────── -->
<div
  id="stats-modal"
  class="modal-overlay hidden"
  role="dialog"
  aria-modal="true"
  aria-labelledby="stats-modal-title"
>
  <div class="modal-content history-modal">
    <h2 class="modal-title" id="stats-modal-title" data-i18n="stats.title">Hörstatistik</h2>
    <div class="stats-overall" id="stats-overall"></div>
    <div id="stats-list" class="history-list" aria-live="polite"></div>
    <div class="modal-buttons modal-buttons--full">
      <button class="modal-btn" id="stats-close-btn" data-i18n="about.close">Schließen</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add CSS for the stats modal**

Find (in `src/index.css`, the end of the History Modal block):

```css
.history-empty {
  text-align: center;
  color: var(--text-dim);
  font-size: 11px;
  padding: 24px 16px;
}
```

Add immediately after it:

```css
.stats-overall {
  font-size: 11px;
  color: var(--text-dim);
  text-align: center;
  margin-bottom: 8px;
}
.stats-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 11px;
  margin-bottom: 2px;
}
.stats-item:hover {
  background: rgba(255, 255, 255, 0.04);
}
.stats-name {
  color: var(--text);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
  margin-right: 8px;
}
.stats-time {
  color: var(--text-dim);
  font-size: 10px;
  flex-shrink: 0;
  text-align: right;
}
.stats-empty {
  text-align: center;
  color: var(--text-dim);
  font-size: 11px;
  padding: 24px 16px;
}
```

- [ ] **Step 4: Add German i18n keys**

Find (in `src/i18n.js`, the `de` block):

```js
    'history.title': 'Wiedergabeverlauf',
    'history.clear': 'Verlauf löschen',
```

Replace with:

```js
    'history.title': 'Wiedergabeverlauf',
    'history.clear': 'Verlauf löschen',
    'settings.stats': 'Statistik',
    'stats.show': 'Statistik anzeigen',
    'stats.title': 'Hörstatistik',
    'stats.overall': 'Insgesamt gehört: {0}',
    'stats.today': 'heute: {0}',
    'stats.empty': 'Noch keine Hördaten vorhanden.',
```

- [ ] **Step 5: Add English i18n keys**

Find (in `src/i18n.js`, the `en` block):

```js
    'history.title': 'Play history',
    'history.clear': 'Clear history',
```

Replace with:

```js
    'history.title': 'Play history',
    'history.clear': 'Clear history',
    'settings.stats': 'Statistics',
    'stats.show': 'Show statistics',
    'stats.title': 'Listening Stats',
    'stats.overall': 'Total listened: {0}',
    'stats.today': 'today: {0}',
    'stats.empty': 'No listening data yet.',
```

- [ ] **Step 6: Run smoke-check**

Run: `npm run smoke`
Expected: `smoke-check ok v<version>` (no duplicate ids — `stats-modal`, `stats-list`, `stats-overall`, `btn-show-stats`, `stats-close-btn`, `stats-modal-title` are all new and unique).

- [ ] **Step 7: Commit**

```bash
git add src/index.html src/index.css src/i18n.js
git commit -m "feat: add listening stats modal markup, styles, and i18n strings"
```

---

### Task 5: Wire up the stats modal in renderer.js

**Files:**

- Modify: `src/renderer.js`

- [ ] **Step 1: Import `collectListenData` and expose `buildStatsList`/`formatListen`**

Find (near the top of the file):

```js
const { averageLevel } = window.utils;
```

Replace with:

```js
const { averageLevel, formatListen, buildStatsList } = window.utils;
```

Find the `renderer-ui.js` import block (the one containing `loadInt`, `LS`, etc. — it's the large multi-line import) and add `collectListenData` to it. For example, if the block currently ends like this:

```js
  showShortcutsModal,
  hideShortcutsModal,
} from './renderer-ui.js';
```

Replace with:

```js
  showShortcutsModal,
  hideShortcutsModal,
  collectListenData,
} from './renderer-ui.js';
```

(If the exact surrounding lines differ from this snippet, add `collectListenData,` as one more entry inside that same `import { ... } from './renderer-ui.js';` block — don't create a second import statement for the same module.)

- [ ] **Step 2: Add the stats modal logic and wiring**

Find the end of the Track History section:

```js
safeAddListener('history-close-btn', 'click', hideHistoryModal);
safeAddListener('history-clear-btn', 'click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});
const historyModalEl = document.getElementById('history-modal');
if (historyModalEl) {
  historyModalEl.addEventListener('click', (e) => {
    if (e.target === historyModalEl) hideHistoryModal();
  });
}
```

Immediately after that closing `}`, insert:

```js
// ── Listening Stats ──────────────────────────────
function renderStatsList() {
  const list = document.getElementById('stats-list');
  const overall = document.getElementById('stats-overall');
  if (!list) return;
  const listenData = collectListenData(state.allStations);
  const stats = buildStatsList(state.allStations, listenData);
  const overallMs = loadInt(LS.listenOverallTotal, 0);
  if (overall) overall.textContent = t('stats.overall', formatListen(overallMs));
  list.innerHTML = '';
  if (stats.length === 0) {
    list.innerHTML = `<div class="stats-empty">${t('stats.empty')}</div>`;
    return;
  }
  for (const s of stats) {
    const item = document.createElement('div');
    item.className = 'stats-item';
    const name = document.createElement('div');
    name.className = 'stats-name';
    name.textContent = s.name;
    const time = document.createElement('div');
    time.className = 'stats-time';
    time.textContent =
      s.today > 0
        ? `${formatListen(s.total)} · ${t('stats.today', formatListen(s.today))}`
        : formatListen(s.total);
    item.appendChild(name);
    item.appendChild(time);
    list.appendChild(item);
  }
}
function showStatsModal() {
  const modal = document.getElementById('stats-modal');
  if (!modal) return;
  renderStatsList();
  modal.classList.remove('hidden');
}
function hideStatsModal() {
  document.getElementById('stats-modal')?.classList.add('hidden');
}
safeAddListener('btn-show-stats', 'click', () => {
  document.getElementById('settings-modal')?.classList.add('hidden');
  showStatsModal();
});
safeAddListener('stats-close-btn', 'click', hideStatsModal);
const statsModalEl = document.getElementById('stats-modal');
if (statsModalEl) {
  statsModalEl.addEventListener('click', (e) => {
    if (e.target === statsModalEl) hideStatsModal();
  });
}
```

- [ ] **Step 3: Run lint and the full unit test suite**

Run: `npx eslint . --max-warnings 0`
Expected: no errors, no warnings.

Run: `node --test scripts/test.js 2>&1 | Select-String "# pass|# fail"` (PowerShell)
Expected: `# pass 161`, `# fail 0`.

Also run: `npm run smoke` — expected: `smoke-check ok v<version>`.

If lint reports `formatListen`/`buildStatsList`/`collectListenData` as undefined or unused, double-check the exact import/destructure lines were added to the right existing statements (not duplicated as new ones) — grep the file for `window.utils` and `from './renderer-ui.js'` to confirm there's still exactly one of each.

- [ ] **Step 4: Commit**

```bash
git add src/renderer.js
git commit -m "feat: wire up listening stats modal open/close/render"
```

---

### Task 6: Add E2E test for the stats modal

**Files:**

- Modify: `scripts/e2e/app.spec.js`

- [ ] **Step 1: Add the test**

Add this test at the end of the file (after the existing "Equalizer-Popover" test — the file uses a shared `app`/`win` Electron instance from `test.beforeAll`, same as the other tests):

```js
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
```

- [ ] **Step 2: Run the new test in isolation**

Run: `npx playwright test --grep "Hörstatistik-Modal"`
Expected: `1 passed`.

If it fails because no station has accrued listen time yet (`stats-list` shows the empty state instead), that's fine for the assertions above (they only check `#stats-overall` has text and the modal opens/closes) — but if you want a stronger assertion, read `src/renderer-ui.js` to confirm exactly when/how `stationTodayKey`/`stationTotalKey` get incremented (there's a listen-time tracking interval somewhere in that file) and adjust the `waitForTimeout` duration accordingly rather than guessing.

- [ ] **Step 3: Run the full E2E suite**

Run: `npx playwright test`
Expected: `14 passed` (13 existing + 1 new).

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e/app.spec.js
git commit -m "test: add e2e coverage for listening stats modal"
```

---

### Task 7: Visual verification and full verify gate

**Files:** none (verification only)

- [ ] **Step 1: Run the complete verify gate**

Run: `npm run verify`
Expected: lint clean, format clean, stations check ok, ui-audit ok, 161 unit tests pass.

- [ ] **Step 2: Run the complete E2E suite**

Run: `npx playwright test`
Expected: `14 passed`.

- [ ] **Step 3: Visual check (required per this project's established practice — see the "Visuelles Gegenlesen bei UI-Features" memory note)**

Start the app (`npm start` or via the project's preview tooling), open Settings, click "Statistik anzeigen", and take a screenshot or otherwise visually confirm:

- The modal fits fully within the 460×520 window (no clipped rows or buttons).
- The station name doesn't overlap the time column when a long station name is present.
- The empty state renders sensibly if no station has any listen time yet (e.g. on a fresh profile).

Do not report this task done from automated test output alone — actually look at the rendered modal.

- [ ] **Step 4: If everything is green and visually correct, no further commit needed — Tasks 1-6 commits already cover the feature.**

---

## Self-Review Notes

- **Spec coverage:** Pure `buildStatsList` in `utils.js` (Task 2) ✅, `collectListenData` glue (Task 3) ✅, settings-modal entry point + `#stats-modal` markup modeled on `#history-modal` (Task 4) ✅, overall-total line + per-station total/today (Task 5, `renderStatsList`) ✅, empty state (Task 5 + i18n `stats.empty`) ✅, unit test (Task 1), E2E test (Task 6), mandatory visual check (Task 7) ✅. Scope exclusions from the spec (no trend view, no new persistence, no change to `#history-modal`) — none of the tasks touch tracking logic or the history modal's own code, confirmed.
- **Type/name consistency check:** `buildStatsList(stations, listenData)` signature identical between Task 2 (implementation), Task 1 (tests), and Task 5 (call site). `collectListenData(stations)` identical between Task 3 (implementation) and Task 5 (call site). Element ids (`stats-modal`, `stats-list`, `stats-overall`, `btn-show-stats`, `stats-close-btn`, `stats-modal-title`) used identically across Task 4 (HTML), Task 5 (JS), Task 6 (E2E) — verified consistent.
- **No main.js/preload.js changes needed:** this feature is entirely renderer-side (reads existing localStorage data), no IPC involved — consistent with how the underlying listen-time tracking already works.
