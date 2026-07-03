# 3-Band-Equalizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing 1-band bass-boost cycle button with a 3-band equalizer (Bass/Mid/Treble, ±15 dB each) controlled via a popover with three sliders, persisted in localStorage.

**Architecture:** Extend the existing Web Audio chain in `renderer-audio.js` with three `BiquadFilterNode`s in series (lowshelf/peaking/highshelf) replacing the single bass `BiquadFilterNode`. A new popover in `renderer.js`/`index.html` (styled like the existing volume slider and modeled on the existing `#viz-context-menu` open/close pattern) replaces the old bass-boost button and cycling logic.

**Tech Stack:** Vanilla JS (ES modules), Web Audio API, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-3-band-equalizer-design.md`

---

## File Structure

| File | Change |
|------|--------|
| `scripts/smoke-check.js` | Required-id check: `btn-bass` → `btn-eq` |
| `scripts/test.js` | HTML-label test + UI-Labels test updated for new EQ button/removed bassTooltip |
| `src/renderer-state.js` | Replace `bassFilter`/`bassBoostLevel` with 3 filter refs + 3 dB values |
| `src/renderer-ui.js` | Replace `LS.bass` with `LS.eqBass`/`LS.eqMid`/`LS.eqTreble` |
| `src/ui-labels.mjs` | Remove `bassTooltip()` |
| `src/renderer-audio.js` | Replace bass-boost chain/functions with 3-band EQ chain/functions |
| `src/index.html` | Replace `#btn-bass` with `#btn-eq`; add `#eq-popover` markup |
| `src/index.css` | Remove old `#btn-bass[data-level]` rules; add `.eq-popover` styles |
| `src/i18n.js` | Remove `tooltip.bass*` keys; add `tooltip.eq`, `toast.eq.reset`, `eq.reset`, `eq.band.*` (DE+EN) |
| `src/renderer.js` | Update imports; wire popover open/close, slider inputs, reset button, `KeyB` shortcut; replace 3 call sites of `applyBassBoost()` |
| `scripts/e2e/app.spec.js` | New E2E test for popover open/slider/reset/persistence |

---

### Task 1: Update existing unit tests to expect the new EQ UI (red)

**Files:**
- Modify: `scripts/smoke-check.js:78`
- Modify: `scripts/test.js:429-431`
- Modify: `scripts/test.js:455`

- [ ] **Step 1: Update the required-id check in smoke-check.js**

In `scripts/smoke-check.js`, find the id list (around line 78) and change:

```js
  'btn-bass',
```

to:

```js
  'btn-eq',
```

- [ ] **Step 2: Update the HTML-label test in scripts/test.js**

Find this block (around line 429-431):

```js
  const btnBass = htmlEl(html, 'btn-bass');
  assert.ok(btnBass, 'Bass-Button fehlt');
  assert.equal(btnBass.attr('aria-label'), 'Bassverstärkung', 'Bass aria-label ist nicht deutsch');
```

Replace with:

```js
  const btnEq = htmlEl(html, 'btn-eq');
  assert.ok(btnEq, 'Equalizer-Button fehlt');
  assert.equal(btnEq.attr('aria-label'), 'Equalizer', 'Equalizer aria-label ist nicht deutsch');
```

- [ ] **Step 3: Remove the bassTooltip assertion from the UI-Labels test**

Find and delete this line (around line 455):

```js
  assert.equal(labels.bassTooltip(1), 'Bassverstärkung: +6 dB');
```

- [ ] **Step 4: Run the tests and confirm they fail (red)**

Run: `node --test scripts/test.js 2>&1 | Select-String "not ok"` (PowerShell)

Expected: at least one `not ok` for the HTML-label test (`Equalizer-Button fehlt`, because `#btn-eq` doesn't exist in `index.html` yet). The UI-Labels test still passes at this point (removing an assertion can't fail), that's fine — the HTML-label failure is the red signal we need.

Also run: `npm run smoke` — expected: FAIL with `missing HTML id: btn-eq`.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-check.js scripts/test.js
git commit -m "test: expect new #btn-eq element ahead of equalizer implementation"
```

---

### Task 2: Data model & Web Audio EQ chain

**Files:**
- Modify: `src/renderer-state.js`
- Modify: `src/renderer-ui.js`
- Modify: `src/ui-labels.mjs`
- Modify: `src/renderer-audio.js`

- [ ] **Step 1: Replace bass state with EQ state in renderer-state.js**

Find:

```js
  bassFilter: null,
  stationGain: null,
  bassBoostLevel: 0,
```

Replace with:

```js
  eqBassFilter: null,
  eqMidFilter: null,
  eqTrebleFilter: null,
  eqBassDb: 0,
  eqMidDb: 0,
  eqTrebleDb: 0,
  stationGain: null,
```

- [ ] **Step 2: Replace the bass localStorage key with three EQ keys in renderer-ui.js**

Find (in the `LS` object):

```js
  bass: 'wl.bassBoost',
```

Replace with:

```js
  eqBass: 'wl.eqBass',
  eqMid: 'wl.eqMid',
  eqTreble: 'wl.eqTreble',
```

- [ ] **Step 3: Remove bassTooltip from ui-labels.mjs**

Delete this function entirely:

```js
export function bassTooltip(level) {
  const labels = [t('tooltip.bass.off'), '+6 dB', '+12 dB'];
  return t('tooltip.bass.level', labels[level] ?? labels[0]);
}
```

- [ ] **Step 4: Replace the bass-boost import and functions in renderer-audio.js**

Find the import block:

```js
import {
  LS,
  saveBool,
  stationTodayKey,
  stationTotalKey,
  updatePlayUI,
  reportConnectionState,
  displayTrackInfo,
  showToast,
  applyStationGain,
  updateListenBadge,
} from './renderer-ui.js';
import { bassTooltip, MEDIA_SESSION_FALLBACK } from './ui-labels.mjs';
```

Replace with:

```js
import {
  LS,
  loadInt,
  saveBool,
  stationTodayKey,
  stationTotalKey,
  updatePlayUI,
  reportConnectionState,
  displayTrackInfo,
  showToast,
  applyStationGain,
  updateListenBadge,
} from './renderer-ui.js';
import { MEDIA_SESSION_FALLBACK } from './ui-labels.mjs';
```

Find the bass-boost section:

```js
// ── Bass Boost ───────────────────────────────────
export const BASS_GAINS = [0, 6, 12];

export function applyBassBoost() {
  if (state.bassFilter) state.bassFilter.gain.value = BASS_GAINS[state.bassBoostLevel];
  const btn = document.getElementById('btn-bass');
  if (!btn) return;
  btn.classList.toggle('active', state.bassBoostLevel > 0);
  btn.dataset.level = String(state.bassBoostLevel);
  btn.title = bassTooltip(state.bassBoostLevel);
}

export function cycleBassBoost() {
  state.bassBoostLevel = (state.bassBoostLevel + 1) % BASS_GAINS.length;
  localStorage.setItem(LS.bass, String(state.bassBoostLevel));
  applyBassBoost();
  const bassLevelLabel =
    [t('tooltip.bass.off'), '+6 dB', '+12 dB'][state.bassBoostLevel] ?? t('tooltip.bass.off');
  showToast(`Bass ${bassLevelLabel}`);
}
```

Replace with:

```js
// ── Equalizer ────────────────────────────────────
export const EQ_MIN_DB = -15;
export const EQ_MAX_DB = 15;

const EQ_BAND_MAP = {
  bass: { filterKey: 'eqBassFilter', dbKey: 'eqBassDb', lsKey: 'eqBass' },
  mid: { filterKey: 'eqMidFilter', dbKey: 'eqMidDb', lsKey: 'eqMid' },
  treble: { filterKey: 'eqTrebleFilter', dbKey: 'eqTrebleDb', lsKey: 'eqTreble' },
};

export function setEqBand(band, db) {
  const map = EQ_BAND_MAP[band];
  if (!map) return;
  const clamped = Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, db));
  state[map.dbKey] = clamped;
  if (state[map.filterKey]) state[map.filterKey].gain.value = clamped;
  localStorage.setItem(LS[map.lsKey], String(clamped));
}

export function loadEqFromStorage() {
  setEqBand('bass', loadInt(LS.eqBass, 0));
  setEqBand('mid', loadInt(LS.eqMid, 0));
  setEqBand('treble', loadInt(LS.eqTreble, 0));
}

export function resetEqBands() {
  setEqBand('bass', 0);
  setEqBand('mid', 0);
  setEqBand('treble', 0);
}

export function resetEq() {
  resetEqBands();
  showToast(t('toast.eq.reset'));
}
```

Find the audio chain in `initAudioCtx()`:

```js
  state.bassFilter = state.audioCtx.createBiquadFilter();
  state.bassFilter.type = 'lowshelf';
  state.bassFilter.frequency.value = 200;
  state.bassFilter.gain.value = BASS_GAINS[state.bassBoostLevel];

  state.stationGain = state.audioCtx.createGain();
  applyStationGain();

  const limiter = state.audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  source.connect(state.bassFilter);
  state.bassFilter.connect(state.analyser);
  state.analyser.connect(state.stationGain);
  state.stationGain.connect(limiter);
  limiter.connect(state.audioCtx.destination);
```

Replace with:

```js
  state.eqBassFilter = state.audioCtx.createBiquadFilter();
  state.eqBassFilter.type = 'lowshelf';
  state.eqBassFilter.frequency.value = 200;
  state.eqBassFilter.gain.value = state.eqBassDb;

  state.eqMidFilter = state.audioCtx.createBiquadFilter();
  state.eqMidFilter.type = 'peaking';
  state.eqMidFilter.frequency.value = 1000;
  state.eqMidFilter.Q.value = 1;
  state.eqMidFilter.gain.value = state.eqMidDb;

  state.eqTrebleFilter = state.audioCtx.createBiquadFilter();
  state.eqTrebleFilter.type = 'highshelf';
  state.eqTrebleFilter.frequency.value = 4000;
  state.eqTrebleFilter.gain.value = state.eqTrebleDb;

  state.stationGain = state.audioCtx.createGain();
  applyStationGain();

  const limiter = state.audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;

  source.connect(state.eqBassFilter);
  state.eqBassFilter.connect(state.eqMidFilter);
  state.eqMidFilter.connect(state.eqTrebleFilter);
  state.eqTrebleFilter.connect(state.analyser);
  state.analyser.connect(state.stationGain);
  state.stationGain.connect(limiter);
  limiter.connect(state.audioCtx.destination);
```

- [ ] **Step 5: Run lint to confirm no dead references remain in the files touched so far**

Run: `npx eslint src/renderer-state.js src/renderer-ui.js src/ui-labels.mjs src/renderer-audio.js`
Expected: no errors (warnings about `renderer.js` still importing removed names will surface here or in Task 4 — if `renderer.js` isn't touched yet, ESLint's `no-unused-vars` won't catch missing cross-module exports, so this step should be clean; the runtime break is expected and fixed in Task 4).

- [ ] **Step 6: Commit**

```bash
git add src/renderer-state.js src/renderer-ui.js src/ui-labels.mjs src/renderer-audio.js
git commit -m "feat: replace bass-boost filter chain with 3-band EQ (bass/mid/treble)"
```

---

### Task 3: HTML markup, CSS, and i18n keys

**Files:**
- Modify: `src/index.html`
- Modify: `src/index.css`
- Modify: `src/i18n.js`

- [ ] **Step 1: Replace the bass-boost button with the EQ button in index.html**

Find:

```html
            <button
              class="action-btn"
              id="btn-bass"
              data-i18n-title="tooltip.bass"
              data-i18n-aria="tooltip.bass"
              title="Bassverstärkung · B"
              aria-label="Bassverstärkung"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="2" y1="14" x2="6" y2="14" />
                <line x1="10" y1="12" x2="14" y2="12" />
                <line x1="18" y1="16" x2="22" y2="16" />
              </svg>
            </button>
```

Replace with:

```html
            <button
              class="action-btn"
              id="btn-eq"
              data-i18n-title="tooltip.eq"
              data-i18n-aria="tooltip.eq"
              title="Equalizer · B"
              aria-label="Equalizer"
              aria-haspopup="true"
              aria-expanded="false"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="2" y1="14" x2="6" y2="14" />
                <line x1="10" y1="12" x2="14" y2="12" />
                <line x1="18" y1="16" x2="22" y2="16" />
              </svg>
            </button>
```

- [ ] **Step 2: Add the EQ popover markup next to the visualizer context menu**

Find:

```html
    <!-- ── Visualizer Context Menu ──────────────────────── -->
    <div id="viz-context-menu" class="context-menu hidden"></div>
```

Replace with:

```html
    <!-- ── Visualizer Context Menu ──────────────────────── -->
    <div id="viz-context-menu" class="context-menu hidden"></div>

    <!-- ── Equalizer Popover ────────────────────────────── -->
    <div id="eq-popover" class="eq-popover hidden">
      <div class="eq-row">
        <label for="eq-bass" data-i18n="eq.band.bass">Bass</label>
        <input
          type="range"
          id="eq-bass"
          min="-15"
          max="15"
          value="0"
          step="1"
          data-i18n-aria="eq.band.bass"
          aria-label="Bass"
        />
        <span class="eq-val" id="eq-bass-val">0 dB</span>
      </div>
      <div class="eq-row">
        <label for="eq-mid" data-i18n="eq.band.mid">Mid</label>
        <input
          type="range"
          id="eq-mid"
          min="-15"
          max="15"
          value="0"
          step="1"
          data-i18n-aria="eq.band.mid"
          aria-label="Mid"
        />
        <span class="eq-val" id="eq-mid-val">0 dB</span>
      </div>
      <div class="eq-row">
        <label for="eq-treble" data-i18n="eq.band.treble">Treble</label>
        <input
          type="range"
          id="eq-treble"
          min="-15"
          max="15"
          value="0"
          step="1"
          data-i18n-aria="eq.band.treble"
          aria-label="Treble"
        />
        <span class="eq-val" id="eq-treble-val">0 dB</span>
      </div>
      <button id="eq-reset" class="eq-reset-btn" data-i18n="eq.reset">Zurücksetzen</button>
    </div>
```

- [ ] **Step 3: Remove the old bass-boost button styles from index.css**

Find and delete:

```css
#btn-bass[data-level='1'] {
  background: color-mix(in srgb, var(--accent) 9.5%, transparent);
  border-color: color-mix(in srgb, var(--accent) 20%, transparent);
  color: var(--accent);
}
#btn-bass[data-level='2'] {
  background: rgba(255, 191, 105, 0.13);
  border-color: rgba(255, 191, 105, 0.26);
  color: var(--accent3);
  box-shadow: none;
}
```

- [ ] **Step 4: Add the EQ popover styles to index.css**

Append near the existing `.context-menu` rules (or at the end of the file):

```css
/* ── Equalizer Popover ────────────────────────────── */
.eq-popover {
  position: absolute;
  background: rgba(16, 19, 29, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.58),
    0 0 12px rgba(94, 232, 239, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
  width: 220px;
  z-index: 50;
}
.eq-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.eq-row label {
  width: 44px;
  font-size: 11px;
  color: var(--text-dim);
  flex-shrink: 0;
}
.eq-row input[type='range'] {
  flex: 1;
  min-width: 0;
}
.eq-val {
  width: 40px;
  font-size: 10px;
  text-align: right;
  color: var(--text-dim);
  flex-shrink: 0;
}
.eq-reset-btn {
  width: 100%;
  margin-top: 4px;
  padding: 5px 0;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: var(--text-dim);
  font-size: 11px;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.eq-reset-btn:hover {
  background: rgba(47, 125, 246, 0.82);
  color: #fff;
}
```

- [ ] **Step 5: Replace bass tooltip keys with EQ keys in i18n.js (German block)**

Find (in the `de` object):

```js
    'tooltip.bass': 'Bassverstärkung · B',
    'tooltip.bass.level': 'Bassverstärkung: {0}',
    'tooltip.bass.off': 'aus',
```

Replace with:

```js
    'tooltip.eq': 'Equalizer · B',
    'toast.eq.reset': 'Equalizer zurückgesetzt',
    'eq.reset': 'Zurücksetzen',
    'eq.band.bass': 'Bass',
    'eq.band.mid': 'Mid',
    'eq.band.treble': 'Treble',
```

- [ ] **Step 6: Replace bass tooltip keys with EQ keys in i18n.js (English block)**

Find (in the `en` object):

```js
    'tooltip.bass': 'Bass boost · B',
    'tooltip.bass.level': 'Bass boost: {0}',
    'tooltip.bass.off': 'off',
```

Replace with:

```js
    'tooltip.eq': 'Equalizer · B',
    'toast.eq.reset': 'Equalizer reset',
    'eq.reset': 'Reset',
    'eq.band.bass': 'Bass',
    'eq.band.mid': 'Mid',
    'eq.band.treble': 'Treble',
```

- [ ] **Step 7: Run smoke-check and confirm it passes**

Run: `npm run smoke`
Expected: `smoke-check ok v<version>` (the `btn-eq` id now exists).

- [ ] **Step 8: Commit**

```bash
git add src/index.html src/index.css src/i18n.js
git commit -m "feat: add equalizer popover markup, styles, and i18n strings"
```

---

### Task 4: Wire up interactivity in renderer.js

**Files:**
- Modify: `src/renderer.js`

- [ ] **Step 1: Update imports**

Find:

```js
import { applyBassBoost, cycleBassBoost, startPlay, stopPlay, updateMediaSession } from './renderer-audio.js';
```

Replace with:

```js
import {
  setEqBand,
  resetEqBands,
  resetEq,
  loadEqFromStorage,
  startPlay,
  stopPlay,
  updateMediaSession,
} from './renderer-audio.js';
```

- [ ] **Step 2: Replace the app-reset call site**

Find (around line 100-102, inside a reset-to-defaults routine):

```js
  updateVolSlider(80);
  setMuted(false);
  state.bassBoostLevel = 0;
  applyBassBoost();
```

Replace with:

```js
  updateVolSlider(80);
  setMuted(false);
  resetEqBands();
```

- [ ] **Step 3: Replace the startup-load call site**

Find (around line 576-579):

```js
  updateVolSlider(loadInt(LS.vol, 80), false);
  setMuted(loadBool(LS.muted));
  state.bassBoostLevel = loadInt(LS.bass, 0);
  applyBassBoost();
```

Replace with:

```js
  updateVolSlider(loadInt(LS.vol, 80), false);
  setMuted(loadBool(LS.muted));
  loadEqFromStorage();
```

- [ ] **Step 4: Remove the now-redundant call site after language change**

Find (around line 679, in the settings-save flow):

```js
  updateListenBadge();
  applyBassBoost();
  updatePlayUI();
```

Replace with:

```js
  updateListenBadge();
  updatePlayUI();
```

(The line above it, `applyI18n();`, already re-applies `data-i18n-title`/`data-i18n-aria` on `#btn-eq` and the popover labels — no separate JS refresh needed since the EQ UI has no per-language numeric labels like the old bass tooltip did.)

- [ ] **Step 5: Add the equalizer popover wiring block**

Find the existing Visualizer Context Menu block (ends with):

```js
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.classList.add('hidden');
  });
}
```

Immediately after that closing `}`, insert:

```js

// ── Equalizer Popover ─────────────────────────────
const eqBtn = document.getElementById('btn-eq');
const eqPopover = document.getElementById('eq-popover');
const eqBands = [
  { band: 'bass', slider: document.getElementById('eq-bass'), val: document.getElementById('eq-bass-val'), dbKey: 'eqBassDb' },
  { band: 'mid', slider: document.getElementById('eq-mid'), val: document.getElementById('eq-mid-val'), dbKey: 'eqMidDb' },
  { band: 'treble', slider: document.getElementById('eq-treble'), val: document.getElementById('eq-treble-val'), dbKey: 'eqTrebleDb' },
];

function refreshEqSliders() {
  for (const { slider, val, dbKey } of eqBands) {
    if (!slider || !val) continue;
    slider.value = String(state[dbKey]);
    val.textContent = `${state[dbKey]} dB`;
  }
}

function openEqPopover() {
  if (!eqBtn || !eqPopover) return;
  refreshEqSliders();
  const rect = eqBtn.getBoundingClientRect();
  eqPopover.style.left = Math.min(rect.left, window.innerWidth - 236) + 'px';
  eqPopover.style.top = rect.bottom + 6 + 'px';
  eqPopover.classList.remove('hidden');
  eqBtn.setAttribute('aria-expanded', 'true');
}
function closeEqPopover() {
  if (!eqPopover || !eqBtn) return;
  eqPopover.classList.add('hidden');
  eqBtn.setAttribute('aria-expanded', 'false');
}
function toggleEqPopover() {
  if (!eqPopover) return;
  if (eqPopover.classList.contains('hidden')) openEqPopover();
  else closeEqPopover();
}

if (eqBtn && eqPopover) {
  eqBtn.addEventListener('click', toggleEqPopover);
  document.addEventListener('click', (e) => {
    if (!eqPopover.classList.contains('hidden') && !eqPopover.contains(e.target) && e.target !== eqBtn) {
      closeEqPopover();
    }
  });
  for (const { band, slider, val } of eqBands) {
    if (!slider) continue;
    slider.addEventListener('input', () => {
      const db = parseInt(slider.value, 10);
      setEqBand(band, db);
      if (val) val.textContent = `${db} dB`;
    });
  }
  safeAddListener('eq-reset', 'click', () => {
    resetEq();
    refreshEqSliders();
  });
}
```

- [ ] **Step 6: Replace the KeyB shortcut**

Find:

```js
    case 'KeyB':
      cycleBassBoost();
      break;
```

Replace with:

```js
    case 'KeyB':
      toggleEqPopover();
      break;
```

- [ ] **Step 7: Run lint and the full unit test suite**

Run: `npx eslint . --max-warnings 0`
Expected: no errors, no warnings.

Run: `node --test scripts/test.js 2>&1 | Select-String "# pass|# fail"` (PowerShell)
Expected: `# pass 157`, `# fail 0` (same count as before Task 1, now green again).

- [ ] **Step 8: Manually verify in the running app**

Run: `npm start`
Then: click the EQ button (where Bass-Boost used to be) → popover opens with three sliders at 0 dB. Drag the Bass slider → hear the low end change on a playing stream. Click "Zurücksetzen" → all three sliders return to 0 dB. Press `B` → popover toggles. Click outside the popover → it closes.

- [ ] **Step 9: Commit**

```bash
git add src/renderer.js
git commit -m "feat: wire up equalizer popover interaction and replace bass-boost shortcut"
```

---

### Task 5: Add E2E test for the equalizer popover

**Files:**
- Modify: `scripts/e2e/app.spec.js`

- [ ] **Step 1: Add the test**

Add this test at the end of the file (after the existing "Mini-Kaltstart → Voll" test):

```js
test('Equalizer-Popover: Slider setzen, Reset, Persistenz', async () => {
  const btn = win.locator('#btn-eq');
  const popover = win.locator('#eq-popover');
  await expect(popover).toBeHidden();

  await btn.click();
  await expect(popover).toBeVisible();

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
```

- [ ] **Step 2: Run the new test in isolation**

Run: `npx playwright test --grep "Equalizer-Popover"`
Expected: `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e/app.spec.js
git commit -m "test: add e2e coverage for equalizer popover open/slider/reset/persistence"
```

---

### Task 6: Full verify gate

**Files:** none (verification only)

- [ ] **Step 1: Run the complete verify gate**

Run: `npm run verify`
Expected: lint clean, format clean, stations check ok, ui-audit ok, all unit tests pass (157).

- [ ] **Step 2: Run the complete E2E suite**

Run: `npx playwright test`
Expected: `13 passed` (12 existing + 1 new).

- [ ] **Step 3: If everything is green, no further commit needed — Task 1-5 commits already cover the feature.**

---

## Self-Review Notes

- **Spec coverage:** Audio chain (Task 2) ✅, popover UI (Task 3+4) ✅, ±15 dB range (Task 2 `EQ_MIN_DB`/`EQ_MAX_DB`, Task 3 slider `min`/`max`) ✅, reset button (Task 3 markup, Task 4 wiring) ✅, persistence (Task 2 `LS.eq*`, `loadEqFromStorage`) ✅, `btn-bass` replaced by `btn-eq` (Task 3) ✅, KeyB repurposed (Task 4 Step 6) ✅, old bass code fully removed (Tasks 2-3) ✅, tests updated (Task 1, 5, 6) ✅.
- **Type/name consistency check:** `setEqBand`, `resetEqBands`, `resetEq`, `loadEqFromStorage` are defined once in Task 2 and used with identical names in Task 4 — verified consistent. `LS.eqBass`/`eqMid`/`eqTreble` used identically in Task 2 (renderer-audio.js) and Task 3 (i18n keys are separate namespace, no collision) — verified consistent. Element ids (`btn-eq`, `eq-popover`, `eq-bass`/`eq-mid`/`eq-treble`, `eq-bass-val`/etc., `eq-reset`) used identically across Task 1 (tests), Task 3 (HTML), Task 4 (JS wiring), Task 5 (E2E) — verified consistent.
- **No main.js/preload.js changes needed:** confirmed no bass-boost references exist outside the renderer layer (no IPC channel involved).
