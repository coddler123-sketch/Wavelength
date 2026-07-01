import { state, audio } from './renderer-state.js';
import {
  STATION_GAIN_MIN_DB, STATION_GAIN_MAX_DB, STATION_GAIN_STEP_DB,
  stationGainKey, clampStationGainDb, gainDbToLinear, stationGainLabel,
  nextStationGainDb,
} from './station-gain.mjs';
import { playStopLabel } from './ui-labels.mjs';
import { t } from './i18n.js';

export {
  STATION_GAIN_MIN_DB, STATION_GAIN_MAX_DB, STATION_GAIN_STEP_DB,
  stationGainKey,
};

const api = window.electronAPI;
const { formatListen } = window.utils;

// ── Persistence (localStorage) ───────────────────
export const LS = {
  vol:              'wl.volume',
  pin:              'wl.pin',
  mini:             'wl.mini',
  muted:            'wl.muted',
  playing:          'wl.playing',
  vizMode:          'wl.visualizerMode',
  bass:             'wl.bassBoost',
  listenDate:       'wl.listenDate',
  listenOverallTotal: 'wl.listenOverallTotalMs',
};

export function stationTodayKey(id) { return `wl.listenTodayMs_${id}`; }
export function stationTotalKey(id)  { return `wl.listenTotalMs_${id}`; }

export function loadInt(key, fallback) {
  const v = parseInt(localStorage.getItem(key), 10);
  return Number.isFinite(v) ? v : fallback;
}
export function loadBool(key) { return localStorage.getItem(key) === '1'; }
export const saveBool = (key, v) => { localStorage.setItem(key, v ? '1' : '0'); };

// ── Station Name + Marquee ───────────────────────
// Builds a seamless, one-directional ticker: the text is duplicated with a
// gap and scrolled by exactly one copy's width, so the loop point is
// invisible (no scroll-back snap like a plain "scroll left, jump right" would give).
const MARQUEE_PX_PER_SECOND = 26;

export function applyMarquee(inner, text) {
  const wrap = inner.parentElement;
  inner.classList.remove('marquee-active');
  inner.style.removeProperty('--marquee-duration');
  inner.style.removeProperty('--marquee-loop');
  inner.replaceChildren();
  const single = document.createElement('span');
  single.textContent = text;
  inner.appendChild(single);
  void inner.offsetWidth;

  if (single.scrollWidth <= wrap.clientWidth) return;

  const gap = document.createElement('span');
  gap.className = 'marquee-gap';
  const copy = document.createElement('span');
  copy.textContent = text;
  inner.appendChild(gap);
  inner.appendChild(copy);
  void inner.offsetWidth;

  const loopWidth = single.offsetWidth + gap.offsetWidth;
  const duration = Math.max(6, loopWidth / MARQUEE_PX_PER_SECOND);
  inner.style.setProperty('--marquee-duration', `${duration}s`);
  inner.style.setProperty('--marquee-loop', `-${loopWidth}px`);
  inner.classList.add('marquee-active');
}

export function setActiveStationName(name) {
  const wrap = document.getElementById('active-station-name');
  const inner = document.getElementById('active-station-name-inner');
  if (!wrap || !inner) return;
  wrap.setAttribute('title', name);
  applyMarquee(inner, name);
}

window.addEventListener('resize', () => {
  if (state.stationNameResizeTimer) clearTimeout(state.stationNameResizeTimer);
  state.stationNameResizeTimer = setTimeout(() => {
    if (state.activeStation) setActiveStationName(state.activeStation.name);
  }, 120);
});

// ── Connection Status ────────────────────────────
export function setLiveStatus(st) {
  const el = document.getElementById('live-status');
  if (!el) return;
  el.textContent = t(`status.${st}`);
}

export function reportConnectionState(st) {
  api.setConnectionState(st);
  setLiveStatus(st);
}

// ── Listen Badge ─────────────────────────────────
export function updateListenBadge() {
  ensureListenDate();
  const badge = document.getElementById('listen-badge');
  if (!badge) return;
  if (!state.activeStation) {
    badge.textContent = t('listen.today', '0 min');
    badge.title = t('tooltip.no.station');
    return;
  }
  const today   = parseInt(localStorage.getItem(stationTodayKey(state.activeStation.id)) || '0', 10);
  const total   = parseInt(localStorage.getItem(stationTotalKey(state.activeStation.id)) || '0', 10);
  const overall = parseInt(localStorage.getItem(LS.listenOverallTotal) || '0', 10);
  badge.textContent = t('listen.today', formatListen(today));
  badge.title = t('listen.badge.tooltip', formatListen(total), formatListen(overall));
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ensureListenDate() {
  const today = todayKey();
  if (localStorage.getItem(LS.listenDate) !== today) {
    localStorage.setItem(LS.listenDate, today);
    for (const station of state.allStations) {
      localStorage.setItem(stationTodayKey(station.id), '0');
    }
  }
}

// ── Toast ────────────────────────────────────────
export function showToast(message, options = {}) {
  const toast = document.getElementById('viz-toast');
  if (!toast) return;
  toast.innerHTML = '';
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  toast.appendChild(text);
  if (options.actionLabel && typeof options.onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = options.actionLabel;
    btn.addEventListener('click', () => {
      toast.classList.remove('show');
      clearTimeout(showToast.timer);
      options.onAction();
    });
    toast.appendChild(btn);
  }
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  const duration = options.duration || (options.actionLabel ? 4000 : 1100);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Theme / Time ─────────────────────────────────
export function updateTimeTheme() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  let dayness = 0;
  if (h >= 8 && h < 18)       dayness = 1;
  else if (h >= 6 && h < 8)   dayness = (h - 6) / 2;
  else if (h >= 18 && h < 21) dayness = (21 - h) / 3;
  const r = document.documentElement;
  r.style.setProperty('--bg-day-mix', String(dayness));
}

export function setThemeLevel(level) {
  state.themeLevel += (Math.max(0, Math.min(1, level)) - state.themeLevel) * 0.18;
  const now = performance.now();
  if (now - state.lastThemeAt < 30) return;
  state.lastThemeAt = now;
  const v = Math.round(state.themeLevel * 100);
  if (v === state.lastThemeWrite) return;
  state.lastThemeWrite = v;
  document.documentElement.style.setProperty('--level', String(state.themeLevel));
}

// ── Play UI ──────────────────────────────────────
export function updateItemEqualizer() {
  const activeId = state.activeStation?.id;
  document.querySelectorAll('.item-eq-anim').forEach(eq => {
    const stationId = eq.closest('[data-id]')?.dataset.id;
    eq.classList.toggle('hidden', !state.playing || stationId !== activeId);
  });
}

export function updatePlayUI() {
  document.body.classList.toggle('is-playing', state.playing);
  const mainPath = document.querySelector('#main-icon path');
  if (mainPath) {
    mainPath.setAttribute('d', state.playing
      ? 'M 3.5 3.5 L 14.5 3.5 L 14.5 14.5 L 3.5 14.5 Z'
      : 'M 3 2 L 15 9 L 3 16 L 3 2 Z');
  }
  const miniPath = document.querySelector('#mini-icon path');
  if (miniPath) {
    miniPath.setAttribute('d', state.playing
      ? 'M 2.5 2.5 L 9.5 2.5 L 9.5 9.5 L 2.5 9.5 Z'
      : 'M 2 1 L 11 6 L 2 11 L 2 1 Z');
  }
  const playLabel = playStopLabel(state.playing);
  for (const id of ['btn-playstop', 'mini-playstop']) {
    const btn = document.getElementById(id);
    if (btn) {
      btn.setAttribute('aria-label', playLabel);
      btn.setAttribute('aria-pressed', String(state.playing));
      btn.title = playLabel;
    }
  }
  updateItemEqualizer();
}

// ── Volume ───────────────────────────────────────
const MUTED_SVG = `
  <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
    <path d="M2 5h3l4-3v11l-4-3H2V5z"/>
    <path d="M10.5 5.5l3 3M13.5 5.5l-3 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  </svg>
`;

function speakerSVG(vol) {
  if (vol === 0) {
    return `
      <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
        <path d="M2 5h3l4-3v11l-4-3H2V5z"/>
      </svg>
    `;
  }
  if (vol < 50) {
    return `
      <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
        <path d="M2 5h3l4-3v11l-4-3H2V5z"/>
        <path d="M11 5.5a3 3 0 0 1 0 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      </svg>
    `;
  }
  return `
    <svg width="16" height="16" viewBox="0 0 15 15" fill="currentColor">
      <path d="M2 5h3l4-3v11l-4-3H2V5z"/>
      <path d="M11 5.5a3 3 0 0 1 0 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M13 3.5a6 6 0 0 1 0 8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    </svg>
  `;
}

export function updateVolSlider(val, persist = true) {
  audio.volume = val / 100;
  document.getElementById('vol-slider').value = val;
  document.getElementById('vol-val').textContent = val + '%';
  document.getElementById('mini-vol').value = val;
  const miniVolVal = document.getElementById('mini-vol-val');
  if (miniVolVal) miniVolVal.textContent = val + '%';
  const sliderFill = (el, thumbPx) => {
    const w = el.offsetWidth;
    const pct = w > thumbPx ? ((thumbPx / w) * 100).toFixed(2) + '%' : val + '%';
    el.style.background = `linear-gradient(to right, var(--accent2) 0%, var(--accent2) ${pct}, var(--surface2) ${pct})`;
  };
  const thumbOffset = (sliderEl, thumbW) => {
    const w = sliderEl.offsetWidth;
    return w > 0 ? thumbW / 2 + (val / 100) * (w - thumbW) : null;
  };
  const mainEl = document.getElementById('vol-slider');
  const miniEl = document.getElementById('mini-vol');
  const mainOffset = thumbOffset(mainEl, 14);
  const miniOffset = thumbOffset(miniEl, 11);
  if (mainOffset !== null) sliderFill(mainEl, mainOffset);
  if (miniOffset !== null) sliderFill(miniEl, miniOffset);
  if (persist) localStorage.setItem(LS.vol, String(val));
  const isMuteActive = document.body.classList.contains('muted-state');
  document.getElementById('mute-icon').innerHTML = isMuteActive ? MUTED_SVG : speakerSVG(val);
}

// ── Station Gain ─────────────────────────────────
export function currentStationGainDb() {
  if (!state.activeStation) return 0;
  return clampStationGainDb(loadInt(stationGainKey(state.activeStation.id), 0));
}

export function applyStationGain() {
  const db = currentStationGainDb();
  if (state.stationGain) {
    state.stationGain.gain.value = gainDbToLinear(db);
  }
  const pill = document.getElementById('station-gain-pill');
  const label = stationGainLabel(db);
  if (pill) {
    pill.textContent = label;
    pill.classList.toggle('nonzero', db !== 0);
  }
}

function updateSubtitleGain(gainDb) {
  const el = document.getElementById('active-station-subtitle');
  if (!el || !state.activeStation) return;
  const text = el.textContent.replace(/\s·\s[+-]?\d+ dB$/, '');
  el.textContent = gainDb !== 0 ? `${text} · ${gainDb > 0 ? '+' : ''}${gainDb} dB` : text;
}

export function adjustStationGain(deltaDb) {
  if (!state.activeStation) return;
  const next = nextStationGainDb(currentStationGainDb(), deltaDb);
  if (next === 0) {
    localStorage.removeItem(stationGainKey(state.activeStation.id));
  } else {
    localStorage.setItem(stationGainKey(state.activeStation.id), String(next));
  }
  applyStationGain();
  updateSubtitleGain(next);
  showToast(t('toast.gain', `${next > 0 ? '+' : ''}${next} dB`));
}

export function resetStationGain() {
  if (!state.activeStation) return;
  localStorage.removeItem(stationGainKey(state.activeStation.id));
  applyStationGain();
  updateSubtitleGain(0);
  showToast(t('toast.gain.reset'));
}

// ── Mini / Pin / Mute ────────────────────────────
export function setMini(on) {
  document.body.classList.toggle('mini-mode', on);
  document.body.classList.toggle('mini-idle', on);
  document.getElementById('btn-toggle-mini').classList.toggle('active', on);
  saveBool(LS.mini, on);
  if (state.visualizer) {
    requestAnimationFrame(() => state.visualizer.resize());
    // The Electron window physically resizes BEFORE the IPC set-mini arrives, so
    // window.resize fires while #full-view is still display:none (offsetWidth=0) and
    // is skipped. A deferred second resize ensures correct dimensions once the window
    // has settled at its new size and the canvas is visible again.
    if (!on) setTimeout(() => { state.visualizer?.resize(); if (!state.playing) state.visualizer?.drawIdle(); }, 200);
  }
  if (!state.playing && state.visualizer) requestAnimationFrame(() => state.visualizer.drawIdle());
  // Slider fill and marquee width both rely on offsetWidth/clientWidth, which
  // are 0 while the mini view is display:none. Recompute once it becomes visible.
  if (on) {
    requestAnimationFrame(() => {
      updateVolSlider(parseInt(document.getElementById('vol-slider').value, 10), false);
      const miniStationName = document.getElementById('mini-station-name');
      if (miniStationName) applyMarquee(miniStationName, miniStationName.title);
    });
  }
}

export function setPinned(on) {
  const btn = document.getElementById('btn-pin');
  btn.classList.toggle('pin-active', on);
  saveBool(LS.pin, on);
}

export function setMuted(on) {
  state.muted = on;
  audio.muted = on;
  document.body.classList.toggle('muted-state', on);
  const vol = parseInt(document.getElementById('vol-slider').value, 10);
  document.getElementById('mute-icon').innerHTML = on ? MUTED_SVG : speakerSVG(vol);
  const muteBtn = document.getElementById('btn-mute');
  if (muteBtn) {
    muteBtn.setAttribute('aria-label', on ? t('tooltip.unmute') : t('tooltip.mute'));
    muteBtn.title = on ? t('tooltip.unmute') : t('tooltip.mute');
    muteBtn.setAttribute('aria-pressed', String(on));
  }
  saveBool(LS.muted, on);
  reportConnectionState(state.playing ? (on ? 'muted' : 'live') : 'stopped');
}

// ── App Version ──────────────────────────────────
export function setAppVersion(version) {
  state.appVersion = version;
  document.getElementById('about-version').textContent = `v${version}`;
  const logoArea = document.querySelector('.logo-area');
  if (logoArea) logoArea.dataset.version = `v${version}`;
}

// ── Sleep Badge ──────────────────────────────────
function updateSleepBadge() {
  const badge = document.getElementById('sleep-badge');
  if (!badge) return;
  if (!state.sleepEndsAt) {
    badge.classList.remove('active');
    badge.textContent = '';
    return;
  }
  const minutes = Math.max(0, Math.ceil((state.sleepEndsAt - Date.now()) / 60_000));
  if (minutes <= 0) {
    badge.classList.remove('active');
    badge.textContent = '';
    return;
  }
  badge.textContent = `Sleep ${minutes} min`;
  badge.classList.add('active');
}

export function setSleepEndsAt(value) {
  const hadTimer = !!state.sleepEndsAt;
  state.sleepEndsAt = Number(value) || 0;
  if (state.sleepUiTimer) {
    clearInterval(state.sleepUiTimer);
    state.sleepUiTimer = null;
  }
  updateSleepBadge();
  const sleepBtn = document.getElementById('btn-sleep');
  if (sleepBtn) sleepBtn.classList.toggle('active', !!state.sleepEndsAt);
  document.body.classList.toggle('sleep-active', !!state.sleepEndsAt);
  if (state.sleepEndsAt) state.sleepUiTimer = setInterval(updateSleepBadge, 30_000);
  if (hadTimer !== !!state.sleepEndsAt) {
    if (state.sleepEndsAt) {
      const mins = Math.max(1, Math.ceil((state.sleepEndsAt - Date.now()) / 60_000));
      showToast(t('toast.sleep.on', mins));
    } else {
      showToast(t('toast.sleep.off'));
    }
  }
}

// ── About Modal ──────────────────────────────────
let previousFocus = null;
export const showAboutModal = () => {
  previousFocus = document.activeElement;
  const ver = document.getElementById('about-version');
  if (ver) ver.textContent = `v${state.appVersion}`;

  const nameEl = document.getElementById('about-station-name');
  const urlEl  = document.getElementById('about-stream-url');
  const webEl  = document.getElementById('about-website-url');

  if (state.activeStation) {
    if (nameEl) nameEl.textContent = state.activeStation.name || t('no.station');
    if (urlEl) {
      urlEl.textContent = state.activeStation.streamUrl || '-';
      urlEl.title = state.activeStation.streamUrl || '';
    }
    if (webEl) {
      webEl.textContent = state.activeStation.website || '-';
      webEl.title = state.activeStation.website || '';
    }
  } else {
    if (nameEl) nameEl.textContent = t('no.station');
    if (urlEl) {
      urlEl.textContent = '-';
      urlEl.title = '';
    }
    if (webEl) {
      webEl.textContent = '-';
      webEl.title = '';
    }
  }

  const aboutModal = document.getElementById('about-modal');
  if (!aboutModal) return;
  aboutModal.classList.remove('hidden');
  aboutModal.setAttribute('aria-hidden', 'false');
  const firstFocus = aboutModal.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
  if (firstFocus) firstFocus.focus();
};

export const showShortcutsModal = () => {
  previousFocus = document.activeElement;
  const modal = document.getElementById('shortcuts-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const firstFocus = modal.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
  if (firstFocus) firstFocus.focus();
};

export const hideShortcutsModal = () => {
  const modal = document.getElementById('shortcuts-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (previousFocus && typeof previousFocus.focus === 'function') {
    previousFocus.focus();
    previousFocus = null;
  }
};

export const hideAboutModal = () => {
  const aboutModal = document.getElementById('about-modal');
  if (!aboutModal) return;
  aboutModal.classList.add('hidden');
  aboutModal.setAttribute('aria-hidden', 'true');
  if (previousFocus && typeof previousFocus.focus === 'function') {
    previousFocus.focus();
  }
};

// ── View ─────────────────────────────────────────
export function switchView(view) {
  const isList = view === 'list';
  document.body.classList.toggle('view-list-active', isList);
  const toggleBtn = document.getElementById('btn-view-toggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', isList);
    toggleBtn.setAttribute('aria-pressed', String(isList));
    toggleBtn.setAttribute('aria-label', isList ? t('tooltip.view.player') : t('tooltip.view.stations'));
    toggleBtn.setAttribute('title', isList ? t('tooltip.view.player') : t('tooltip.view.stations'));
  }
  if (state.activeStation) setActiveStationName(state.activeStation.name);
  if (isList) {
    setTimeout(() => {
      const searchInput = document.getElementById('station-search');
      if (searchInput) searchInput.focus();
    }, 50);
  } else {
    if (state.visualizer) {
      requestAnimationFrame(() => state.visualizer.resize());
    }
  }
}

// ── Track Info ───────────────────────────────────
export function displayTrackInfo(title) {
  const container = document.getElementById('track-info-container');
  const textEl = document.getElementById('track-info-text');
  const miniStationName = document.getElementById('mini-station-name');
  if (!textEl || !container) return;

  const cleanTitle = title ? title.trim() : '';
  const textChanged = cleanTitle !== state.currentTrackInfoText;
  state.currentTrackInfoText = cleanTitle;

  const text = state.playing && cleanTitle
    ? cleanTitle
    : (state.activeStation ? state.activeStation.name : 'Wavelength');

  // Skip re-running the marquee animation when the text hasn't actually
  // changed (e.g. repeated ICY metadata pings) — restarting it looks jumpy.
  if (!textChanged && state.currentTrackInfoDisplayText === text) return;
  state.currentTrackInfoDisplayText = text;

  applyMarquee(textEl, text);
  if (miniStationName) {
    miniStationName.title = text;
    applyMarquee(miniStationName, text);
  }
}
