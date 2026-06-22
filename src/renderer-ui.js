import { state, audio } from './renderer-state.js';
import {
  STATION_GAIN_MIN_DB, STATION_GAIN_MAX_DB, STATION_GAIN_STEP_DB,
  stationGainKey, clampStationGainDb, gainDbToLinear, stationGainLabel,
  nextStationGainDb,
} from './station-gain.mjs';
import { connectionLabel, playStopLabel } from './ui-labels.mjs';

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
export function setActiveStationName(name) {
  const wrap = document.getElementById('active-station-name');
  const inner = document.getElementById('active-station-name-inner');
  if (!wrap || !inner) return;
  inner.textContent = name;
  wrap.setAttribute('title', name);
  inner.classList.remove('marquee-active');
  inner.style.removeProperty('--marquee-dist');
  void wrap.offsetWidth;
  const diff = wrap.clientWidth - inner.scrollWidth;
  if (diff < 0) {
    inner.style.setProperty('--marquee-dist', `${diff - 16}px`);
    inner.classList.add('marquee-active');
  }
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
  el.textContent = connectionLabel(st);
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
    badge.textContent = 'Heute 0 min';
    badge.title = 'Keine Station aktiv';
    return;
  }
  const today   = parseInt(localStorage.getItem(stationTodayKey(state.activeStation.id)) || '0', 10);
  const total   = parseInt(localStorage.getItem(stationTotalKey(state.activeStation.id)) || '0', 10);
  const overall = parseInt(localStorage.getItem(LS.listenOverallTotal) || '0', 10);
  badge.textContent = `Heute ${formatListen(today)}`;
  badge.title = `Dieser Sender: ${formatListen(total)} gesamt\nWavelength gesamt: ${formatListen(overall)}`;
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
export function showToast(message) {
  const toast = document.getElementById('viz-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1100);
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
  document.querySelectorAll('.item-eq-anim').forEach(eq => {
    eq.style.display = state.playing ? 'inline-flex' : 'none';
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
  sendTrayIcons();
  updateItemEqualizer();
}

// ── Tray Status Icons ────────────────────────────
export function buildTrayIconDataURL(dotColor) {
  const size = 32, s = size / 64, r = 14 * s;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const x = c.getContext('2d');

  x.fillStyle = '#07090d';
  x.beginPath();
  x.moveTo(r, 0);
  x.arcTo(size, 0, size, size, r);
  x.arcTo(size, size, 0, size, r);
  x.arcTo(0, size, 0, 0, r);
  x.arcTo(0, 0, size, 0, r);
  x.closePath(); x.fill();

  x.strokeStyle = dotColor;
  x.lineWidth = 1.5 * s;
  x.beginPath();
  x.moveTo(r, 0);
  x.arcTo(size, 0, size, size, r);
  x.arcTo(size, size, 0, size, r);
  x.arcTo(0, size, 0, 0, r);
  x.arcTo(0, 0, size, 0, r);
  x.closePath(); x.stroke();

  x.strokeStyle = '#f3efe6';
  x.lineWidth = 5 * s; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath();
  x.moveTo(12 * s, 16 * s);
  x.lineTo(22 * s, 48 * s);
  x.lineTo(32 * s, 28 * s);
  x.lineTo(42 * s, 48 * s);
  x.lineTo(52 * s, 16 * s);
  x.stroke();

  x.fillStyle = dotColor;
  x.beginPath(); x.arc(51 * s, 13 * s, 6 * s, 0, Math.PI * 2); x.fill();
  return c.toDataURL('image/png');
}

export function sendTrayIcons() {
  const colors = {
    playing: '#34d6d0', reconnecting: '#4f7cff', muted: '#ffbf69', stopped: '#4a4a4a',
  };
  const icons = {};
  for (const [st, color] of Object.entries(colors)) icons[st] = buildTrayIconDataURL(color);
  api.sendTrayIcons(icons);
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
  document.getElementById('mini-vol-val').textContent = val + '%';
  const pct = val + '%';
  const fill = `linear-gradient(to right, var(--accent2) 0%, var(--accent2) ${pct}, var(--surface2) ${pct})`;
  document.getElementById('vol-slider').style.background = fill;
  document.getElementById('mini-vol').style.background = fill;
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

export function adjustStationGain(deltaDb) {
  if (!state.activeStation) return;
  const next = nextStationGainDb(currentStationGainDb(), deltaDb);
  if (next === 0) {
    localStorage.removeItem(stationGainKey(state.activeStation.id));
  } else {
    localStorage.setItem(stationGainKey(state.activeStation.id), String(next));
  }
  applyStationGain();
  showToast(`Sender ${next > 0 ? '+' : ''}${next} dB`);
}

export function resetStationGain() {
  if (!state.activeStation) return;
  localStorage.removeItem(stationGainKey(state.activeStation.id));
  applyStationGain();
  showToast('Sender 0 dB');
}

// ── Mini / Pin / Mute ────────────────────────────
export function setMini(on) {
  document.body.classList.toggle('mini-mode', on);
  document.body.classList.toggle('mini-idle', on);
  document.getElementById('btn-toggle-mini').classList.toggle('active', on);
  saveBool(LS.mini, on);
  if (state.visualizer) {
    requestAnimationFrame(() => state.visualizer.resize());
  }
  if (!state.playing && state.visualizer) requestAnimationFrame(() => state.visualizer.drawIdle());
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
    muteBtn.setAttribute('aria-label', on ? 'Stumm aufheben' : 'Stumm');
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
    showToast(state.sleepEndsAt ? 'Sleep 30 min' : 'Sleep aus');
  }
}

// ── About Modal ──────────────────────────────────
let previousFocus = null;
export const showAboutModal = () => {
  previousFocus = document.activeElement;
  const ver = document.getElementById('about-version');
  if (ver) ver.textContent = `v${state.appVersion}`;
  const aboutModal = document.getElementById('about-modal');
  if (!aboutModal) return;
  aboutModal.style.display = 'flex';
  aboutModal.setAttribute('aria-hidden', 'false');
  const firstFocus = aboutModal.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
  if (firstFocus) firstFocus.focus();
};

export const showShortcutsModal = () => {
  previousFocus = document.activeElement;
  const modal = document.getElementById('shortcuts-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
  const firstFocus = modal.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
  if (firstFocus) firstFocus.focus();
};

export const hideShortcutsModal = () => {
  const modal = document.getElementById('shortcuts-modal');
  if (!modal) return;
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  if (previousFocus && typeof previousFocus.focus === 'function') {
    previousFocus.focus();
    previousFocus = null;
  }
};

export const hideAboutModal = () => {
  const aboutModal = document.getElementById('about-modal');
  if (!aboutModal) return;
  aboutModal.style.display = 'none';
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
    toggleBtn.setAttribute('aria-label', isList ? 'Player-Ansicht' : 'Senderliste anzeigen');
    toggleBtn.setAttribute('title', isList ? 'Player-Ansicht' : 'Senderliste anzeigen');
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
  const wrap = document.getElementById('track-info-text-wrap');
  const miniStationName = document.getElementById('mini-station-name');
  if (!textEl || !wrap || !container) return;

  const cleanTitle = title ? title.trim() : '';
  state.currentTrackInfoText = cleanTitle;

  textEl.classList.remove('marquee-active');
  textEl.style.removeProperty('--marquee-dist');

  if (state.playing && cleanTitle) {
    textEl.textContent = cleanTitle;
    if (miniStationName) miniStationName.textContent = cleanTitle;
    void textEl.offsetWidth;
    const diff = wrap.clientWidth - textEl.scrollWidth;
    if (diff < 0) {
      textEl.style.setProperty('--marquee-dist', `${diff - 16}px`);
      textEl.classList.add('marquee-active');
    }
  } else {
    const defaultText = state.activeStation ? state.activeStation.name : 'Wavelength';
    textEl.textContent = defaultText;
    if (miniStationName) miniStationName.textContent = defaultText;
  }
}
