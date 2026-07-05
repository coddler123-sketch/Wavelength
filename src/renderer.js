import { loadSettings, saveSettings, applyTheme } from './settings.js';
import { setLang, t, applyI18n, displayGenre } from './i18n.js';
import { state } from './renderer-state.js';
import {
  LS,
  loadInt,
  loadBool,
  stationTodayKey,
  stationTotalKey,
  stationGainKey,
  updatePlayUI,
  updateListenBadge,
  displayTrackInfo,
  updateVolSlider,
  adjustStationGain,
  resetStationGain,
  STATION_GAIN_STEP_DB,
  setMini,
  setPinned,
  setMuted,
  setAppVersion,
  setSleepEndsAt,
  showToast,
  updateTimeTheme,
  setThemeLevel,
  switchView,
  showAboutModal,
  hideAboutModal,
  showShortcutsModal,
  hideShortcutsModal,
  collectListenData,
  stationNameKey,
} from './renderer-ui.js';
import {
  setEqBand,
  resetEqBands,
  resetEq,
  loadEqFromStorage,
  startPlay,
  stopPlay,
  updateMediaSession,
  sleepFadeOut,
} from './renderer-audio.js';
import {
  renderStations,
  showStationsLoading,
  selectStation,
  populateFilters,
  populateRecents,
  initKeyboardNav,
  toggleFavorite,
  updatePlayerFavStar,
  openStationEditor,
  initStationEditor,
} from './renderer-stations.js';

const api = window.electronAPI;

// ── Crash Reporter ───────────────────────────────
window.addEventListener('error', (e) => {
  api.logRendererError({
    type: 'error',
    message: e.message || 'unknown',
    source: e.filename,
    line: e.lineno,
    stack: e.error?.stack,
  });
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  api.logRendererError({
    type: 'unhandledrejection',
    message: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

// ── Visualizer ───────────────────────────────────
const { averageLevel, formatListen, buildStatsList } = window.utils;
state.visualizer = WavelengthVisualizer.create({
  canvas: document.getElementById('visualizer'),
  miniCanvas: document.getElementById('mini-visualizer'),
  storageKey: LS.vizMode,
  averageLevel,
  getAnalyser: () => state.analyser,
  getState: () => ({ playing: state.playing, muted: state.muted, windowVisible: state.windowVisible }),
  onLevel: setThemeLevel,
  showToast,
});

// ── Helpers ──────────────────────────────────────
function safeAddListener(id, event, callback) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, callback);
}
function safeQueryListener(selector, event, callback) {
  const el = document.querySelector(selector);
  if (el) el.addEventListener(event, callback);
}

// ── Reset ────────────────────────────────────────
function resetLocalSettings() {
  for (const key of Object.values(LS)) localStorage.removeItem(key);
  localStorage.removeItem('wl.lastStationId');
  for (const station of state.allStations) {
    localStorage.removeItem(stationTodayKey(station.id));
    localStorage.removeItem(stationTotalKey(station.id));
    localStorage.removeItem(stationGainKey(station.id));
  }
  updateVolSlider(80);
  setMuted(false);
  resetEqBands();
  state.visualizer.resetMode();
  updatePlayUI();
  updateListenBadge();
  if (state.allStations.length > 0) {
    selectStation(state.allStations[0]);
  }
}

// ── Button Wiring ────────────────────────────────
safeAddListener('btn-playstop', 'click', () => api.playPause());
safeAddListener('mini-playstop', 'click', () => api.playPause());
safeAddListener('btn-mute', 'click', () => api.toggleMute());
safeAddListener('vol-slider', 'input', (e) => updateVolSlider(parseInt(e.target.value, 10)));
safeAddListener('mini-vol', 'input', (e) => updateVolSlider(parseInt(e.target.value, 10)));
safeAddListener('btn-pin', 'click', () => api.togglePin());
function triggerToggleMini() {
  if (state.visualizer) state.visualizer.stop();
  api.toggleMini();
}

safeAddListener('btn-toggle-mini', 'click', () => triggerToggleMini());
safeAddListener('mini-expand', 'click', () => triggerToggleMini());
safeAddListener('btn-hide', 'click', () => api.hideWindow());
safeAddListener('mini-hide', 'click', () => api.hideWindow());
safeAddListener('btn-sleep', 'click', () => api.cycleSleepTimer());
safeAddListener('station-gain-pill', 'click', resetStationGain);
safeAddListener('visualizer', 'click', () => state.visualizer.toggleMode());

safeAddListener('btn-view-toggle', 'click', () => {
  const isList = document.body.classList.contains('view-list-active');
  switchView(isList ? 'player' : 'list');
});
safeAddListener('player-fav-btn', 'click', () => {
  if (state.activeStation) toggleFavorite(state.activeStation.id);
});

let searchDebounceTimer;
safeAddListener('station-search', 'input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(renderStations, 80);
});
safeAddListener('genre-filter', 'change', () => renderStations());
safeAddListener('lang-filter', 'change', () => renderStations());
safeAddListener('bitrate-filter', 'change', () => renderStations());
safeAddListener('btn-fav-filter', 'click', () => {
  state.favFilterActive = !state.favFilterActive;
  const btn = document.getElementById('btn-fav-filter');
  if (btn) btn.classList.toggle('active', state.favFilterActive);
  renderStations();
});

// ── Visualizer Context Menu ───────────────────────
const vizCanvas = document.getElementById('visualizer');
const contextMenu = document.getElementById('viz-context-menu');

if (vizCanvas && contextMenu) {
  vizCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextMenu.innerHTML = '<div class="context-menu-title">Visualizer Modus</div>';
    const currentMode = state.visualizer.getMode();
    WavelengthVisualizer.VISUALIZER_MODES.forEach((m) => {
      const item = document.createElement('div');
      item.className = 'context-menu-item' + (m === currentMode ? ' active' : '');
      item.textContent = WavelengthVisualizer.VISUALIZER_LABELS[m] || m;
      item.addEventListener('click', () => {
        state.visualizer.setMode(m);
        contextMenu.classList.add('hidden');
      });
      contextMenu.appendChild(item);
    });
    let x = e.clientX,
      y = e.clientY;
    const menuWidth = 142,
      menuHeight = 240;
    const winWidth = window.innerWidth,
      winHeight = window.innerHeight;
    if (x + menuWidth > winWidth) x = winWidth - menuWidth - 8;
    if (y + menuHeight > winHeight) y = winHeight - menuHeight - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.remove('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.classList.add('hidden');
  });
}

// ── Equalizer Popover ─────────────────────────────
const eqBtn = document.getElementById('btn-eq');
const eqPopover = document.getElementById('eq-popover');
const eqBands = [
  {
    band: 'bass',
    slider: document.getElementById('eq-bass'),
    val: document.getElementById('eq-bass-val'),
    dbKey: 'eqBassDb',
  },
  {
    band: 'mid',
    slider: document.getElementById('eq-mid'),
    val: document.getElementById('eq-mid-val'),
    dbKey: 'eqMidDb',
  },
  {
    band: 'treble',
    slider: document.getElementById('eq-treble'),
    val: document.getElementById('eq-treble-val'),
    dbKey: 'eqTrebleDb',
  },
];

function refreshEqSliders() {
  for (const { slider, val, dbKey } of eqBands) {
    if (!slider || !val) continue;
    slider.value = String(state[dbKey]);
    val.textContent = `${state[dbKey]} dB`;
  }
  refreshEqPresetHighlight();
}

function refreshEqPresetHighlight() {
  if (!eqPopover) return;
  for (const btn of eqPopover.querySelectorAll('.eq-preset-btn')) {
    const gains = window.utils.eqPresetGains(btn.dataset.eqPreset);
    const match =
      gains &&
      gains.bass === state.eqBassDb &&
      gains.mid === state.eqMidDb &&
      gains.treble === state.eqTrebleDb;
    btn.classList.toggle('active', Boolean(match));
  }
}

function openEqPopover() {
  if (!eqBtn || !eqPopover) return;
  refreshEqSliders();
  // Unhide first so offsetHeight reflects real layout, not the display:none default.
  eqPopover.classList.remove('hidden');
  const rect = eqBtn.getBoundingClientRect();
  const popoverWidth = eqPopover.offsetWidth || 220;
  const popoverHeight = eqPopover.offsetHeight;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
  let top = rect.bottom + 6;
  if (top + popoverHeight > window.innerHeight - 8) {
    top = rect.top - popoverHeight - 6;
  }
  top = Math.max(8, top);
  eqPopover.style.left = left + 'px';
  eqPopover.style.top = top + 'px';
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
    if (
      !eqPopover.classList.contains('hidden') &&
      !eqPopover.contains(e.target) &&
      !eqBtn.contains(e.target)
    ) {
      closeEqPopover();
    }
  });
  for (const { band, slider, val } of eqBands) {
    if (!slider) continue;
    slider.addEventListener('input', () => {
      const db = parseInt(slider.value, 10);
      setEqBand(band, db);
      if (val) val.textContent = `${db} dB`;
      refreshEqPresetHighlight();
    });
  }
  safeAddListener('eq-reset', 'click', () => {
    resetEq();
    refreshEqSliders();
  });
  for (const btn of eqPopover.querySelectorAll('.eq-preset-btn')) {
    btn.addEventListener('click', () => {
      const gains = window.utils.eqPresetGains(btn.dataset.eqPreset);
      if (!gains) return;
      setEqBand('bass', gains.bass);
      setEqBand('mid', gains.mid);
      setEqBand('treble', gains.treble);
      refreshEqSliders();
    });
  }
}

// ── Double Click Drag Areas ──────────────────────
safeQueryListener('.logo-area', 'dblclick', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  triggerToggleMini();
});
safeQueryListener('.mini-info', 'dblclick', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  triggerToggleMini();
});
safeQueryListener('.mini-logo', 'dblclick', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  triggerToggleMini();
});

// ── About Modal Wiring ───────────────────────────
const aboutModal = document.getElementById('about-modal');
const shortcutsModal = document.getElementById('shortcuts-modal');
safeAddListener('about-close-btn', 'click', hideAboutModal);
safeAddListener('about-ok-btn', 'click', hideAboutModal);
safeAddListener('shortcuts-close-btn', 'click', hideShortcutsModal);
safeAddListener('shortcuts-ok-btn', 'click', hideShortcutsModal);
if (shortcutsModal) {
  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) hideShortcutsModal();
  });
}
safeAddListener('btn-add-station', 'click', () => openStationEditor());
initStationEditor();
safeAddListener('about-web-btn', 'click', () => {
  if (state.activeStation && state.activeStation.website) api.openExternal(state.activeStation.website);
  hideAboutModal();
});
if (aboutModal) {
  aboutModal.addEventListener('click', (e) => {
    if (e.target === aboutModal) hideAboutModal();
  });
}

// ── Modal Helpers (a11y) ─────────────────────────
function getTopmostOpenModal() {
  const modals = document.querySelectorAll('.modal-overlay');
  for (const m of modals) {
    if (!m.classList.contains('hidden')) return m;
  }
  return null;
}
function getFocusable(root) {
  return Array.from(
    root.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => el.offsetParent !== null);
}
function dismissTopModal() {
  const modal = getTopmostOpenModal();
  if (!modal) return false;
  // Try button-driven dismissal first (preserves cleanup logic)
  const dismissBtn = modal.querySelector(
    '[data-modal-dismiss], .modal-btn-ghost, [id$="-cancel-btn"], [id$="-ok-btn"], [id$="-skip-btn"]'
  );
  if (dismissBtn) {
    dismissBtn.click();
    return true;
  }
  modal.classList.add('hidden');
  return true;
}

// ── Keyboard Shortcuts ───────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (dismissTopModal()) {
      e.preventDefault();
      return;
    }
  }
  // Focus-trap: keep Tab inside the topmost open modal
  if (e.key === 'Tab') {
    const modal = getTopmostOpenModal();
    if (modal) {
      const focusable = getFocusable(modal);
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '?' || e.code === 'F1') {
    e.preventDefault();
    if (shortcutsModal && !shortcutsModal.classList.contains('hidden')) hideShortcutsModal();
    else showShortcutsModal();
    return;
  }
  if (e.code === 'F4') {
    e.preventDefault();
    const hm = document.getElementById('history-modal');
    if (hm && !hm.classList.contains('hidden')) hideHistoryModal();
    else showHistoryModal();
    return;
  }
  const vol = () => parseInt(document.getElementById('vol-slider').value, 10);
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      api.playPause();
      break;
    case 'KeyM':
      api.toggleMute();
      break;
    case 'KeyB':
      toggleEqPopover();
      break;
    case 'KeyV':
      state.visualizer.toggleMode();
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (e.altKey) adjustStationGain(STATION_GAIN_STEP_DB);
      else updateVolSlider(Math.min(100, vol() + 5));
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (e.altKey) adjustStationGain(-STATION_GAIN_STEP_DB);
      else updateVolSlider(Math.max(0, vol() - 5));
      break;
  }
});

// ── Mouse Wheel → Volume ─────────────────────────
window.addEventListener(
  'wheel',
  (e) => {
    if (e.target.closest('.history-list')) return;
    const picker = e.target.closest('.station-picker');
    if (picker) {
      const list = document.getElementById('station-list');
      if (list) list.scrollTop += e.deltaY;
      return;
    }
    if (e.target.closest('#viz-context-menu') || e.target.closest('.context-menu')) return;
    if (document.querySelector('.modal-overlay:not(.hidden)')) return;
    e.preventDefault();
    const vol = parseInt(document.getElementById('vol-slider').value, 10);
    updateVolSlider(Math.max(0, Math.min(100, vol + (e.deltaY < 0 ? 5 : -5))));
    if (!localStorage.getItem('wl.scrollHintSeen')) {
      localStorage.setItem('wl.scrollHintSeen', '1');
      showToast(t('toast.volume.hint'));
    }
  },
  { passive: false }
);

// ── IPC from main ────────────────────────────────
api.onSetPlaying((val) => {
  val ? startPlay() : stopPlay();
});
api.onSetPinned(setPinned);
api.onSetMini((on) => {
  setMini(on);
  if (state.playing && state.visualizer) {
    state.visualizer.start();
  }
});
api.onSetMuted(setMuted);
api.onSleepUpdate(setSleepEndsAt);
api.onSleepFade(sleepFadeOut);
api.onAppVersion(setAppVersion);
api.onResetSettings(resetLocalSettings);
api.onSystemIdle((isIdle) => {
  document.body.classList.toggle('system-idle', isIdle);
});
api.onWindowVisible((visible) => {
  state.windowVisible = visible;
  document.body.classList.toggle('window-hidden', !visible);
  if (visible && state.playing) state.visualizer.start();
});
api.onShowAbout(showAboutModal);
api.onShowShortcuts(showShortcutsModal);
api.onSetStation((station) => {
  if (state.isInitialized && station && (!state.activeStation || state.activeStation.id !== station.id)) {
    selectStation(station, { syncMain: false, startWhenStopped: false });
  }
});
let lastNotifiedTrack = '';
api.onTrackInfo((title) => {
  displayTrackInfo(title);
  recordTrackHistory(title);
  updateMediaSession(state.playing);
  const track = String(title || '').trim();
  if (
    track &&
    track !== lastNotifiedTrack &&
    state.playing &&
    loadSettings().trackNotify &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted'
  ) {
    lastNotifiedTrack = track;
    new Notification(state.activeStation?.name || 'Wavelength', { body: track, silent: true });
  }
});

// ── Drag to Scroll ───────────────────────────────
function initListDragToScroll() {
  const list = document.getElementById('station-list');
  if (!list) return;

  list.addEventListener('mousedown', (e) => {
    state.isListDragging = true;
    state.hasDraggedSignificant = false;
    state.listDragStart = e.pageY;
    state.listScrollStart = list.scrollTop;
  });

  window.addEventListener('mouseup', () => {
    setTimeout(() => {
      state.isListDragging = false;
    }, 50);
  });

  list.addEventListener('mousemove', (e) => {
    if (!state.isListDragging) return;
    const delta = e.pageY - state.listDragStart;
    if (Math.abs(delta) > 5) state.hasDraggedSignificant = true;
    list.scrollTop = state.listScrollStart - delta;
  });
}

// ── Onboarding ───────────────────────────────────
function showOnboarding() {
  if (localStorage.getItem('wl.onboardingDone')) return;
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  let current = 0;
  const slides = modal.querySelectorAll('.onboarding-slide');
  const dots = modal.querySelectorAll('.onboarding-dot');
  const nextBtn = document.getElementById('onboarding-next-btn');
  const skipBtn = document.getElementById('onboarding-skip-btn');

  function close() {
    modal.classList.add('hidden');
    localStorage.setItem('wl.onboardingDone', '1');
  }
  function showSlide(i) {
    slides.forEach((s, idx) => s.classList.toggle('active', idx === i));
    dots.forEach((d, idx) => d.classList.toggle('active', idx === i));
    if (nextBtn) nextBtn.textContent = i === slides.length - 1 ? t('onboarding.start') : t('onboarding.next');
  }
  nextBtn?.addEventListener('click', () => {
    current++;
    if (current >= slides.length) close();
    else showSlide(current);
  });
  skipBtn?.addEventListener('click', close);
  modal.classList.remove('hidden');
  showSlide(0);
}

// ── Track History ────────────────────────────────
const HISTORY_KEY = 'wl.trackHistory';
const HISTORY_MAX = 30;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}
function recordTrackHistory(title) {
  if (!title || typeof title !== 'string' || !title.trim()) return;
  const trimmed = title.trim();
  if (!state.activeStation) return;
  const history = loadHistory();
  if (history[0] && history[0].title === trimmed) return;
  history.unshift({
    ts: Date.now(),
    stationId: state.activeStation.id,
    stationName: state.activeStation.name,
    title: trimmed,
  });
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* localStorage full or unavailable */
  }
}
function formatRelative(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'gerade eben';
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `vor ${hr} h`;
  const d = Math.floor(hr / 24);
  return `vor ${d} Tag${d > 1 ? 'en' : ''}`;
}
function renderHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;
  const history = loadHistory();
  list.innerHTML = '';
  if (history.length === 0) {
    list.innerHTML = '<div class="history-empty">Noch nichts gehört.</div>';
    return;
  }
  for (const entry of history) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = entry.title;
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = `${entry.stationName} · ${formatRelative(entry.ts)}`;
    item.appendChild(title);
    item.appendChild(meta);
    list.appendChild(item);
  }
}
function showHistoryModal() {
  const modal = document.getElementById('history-modal');
  if (!modal) return;
  renderHistory();
  modal.classList.remove('hidden');
}
function hideHistoryModal() {
  document.getElementById('history-modal')?.classList.add('hidden');
}

safeAddListener('track-info-container', 'click', showHistoryModal);
const tic = document.getElementById('track-info-container');
if (tic) {
  tic.title = t('tooltip.history');
  tic.setAttribute('role', 'button');
  tic.setAttribute('tabindex', '0');
  tic.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      showHistoryModal();
    }
  });
}
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

// ── Listening Stats ──────────────────────────────
function renderStatsList() {
  const list = document.getElementById('stats-list');
  const overall = document.getElementById('stats-overall');
  if (!list) return;
  for (const s of state.allStations) {
    if (!localStorage.getItem(stationNameKey(s.id))) {
      localStorage.setItem(stationNameKey(s.id), s.name);
    }
  }
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

// ── Init ─────────────────────────────────────────
(async () => {
  const settings = loadSettings();
  applyTheme('nacht');
  setLang(settings.lang);
  api.setLang(settings.lang);

  showStationsLoading();
  state.allStations = await api.getStations();

  populateFilters();
  initListDragToScroll();
  populateRecents();
  initKeyboardNav();

  const appState = await api.getState();
  const lastStationId = localStorage.getItem('wl.lastStationId');
  let loadedStation = null;
  if (lastStationId) {
    loadedStation = state.allStations.find((s) => s.id === lastStationId);
  }
  if (!loadedStation && state.allStations.length > 0) {
    loadedStation = state.allStations[0];
  }
  if (loadedStation) {
    selectStation(loadedStation, { startWhenStopped: settings.autoplayOnStart });
  }

  renderStations();
  updatePlayerFavStar();

  setAppVersion(appState.version);
  setSleepEndsAt(appState.sleepEndsAt);
  updateListenBadge();

  updateVolSlider(loadInt(LS.vol, 80), false);
  setMuted(loadBool(LS.muted));
  loadEqFromStorage();
  updatePlayUI();

  state.visualizer.drawIdle();

  updateTimeTheme();
  setInterval(updateTimeTheme, 60_000);

  if (!localStorage.getItem('wl.vizHintSeen')) {
    localStorage.setItem('wl.vizHintSeen', '1');
    const strip = document.querySelector('.viz-strip');
    if (strip) {
      strip.classList.add('viz-hint');
      strip.addEventListener('animationend', () => strip.classList.remove('viz-hint'), { once: true });
    }
  }

  const isAudit = new URLSearchParams(location.search).get('audit') === '1';
  if (!isAudit && !localStorage.getItem('wl.onboardingDone')) {
    setTimeout(showOnboarding, 600);
  } else if (!isAudit && !localStorage.getItem('wl.shortcutsHintSeen')) {
    localStorage.setItem('wl.shortcutsHintSeen', '1');
    setTimeout(() => showToast(t('toast.shortcuts.hint'), { duration: 3500 }), 2500);
  }

  const wantPin = loadBool(LS.pin);
  const wantMini = settings.startMini || loadBool(LS.mini);
  const wantMuted = loadBool(LS.muted);
  if (wantPin !== appState.isPinned) api.togglePin();
  if (wantMini !== appState.isMini) triggerToggleMini();
  if (wantMuted !== appState.isMuted) api.toggleMute();

  if (loadBool(LS.playing)) api.playPause(true);

  const miniView = document.getElementById('mini-view');
  if (miniView) {
    miniView.addEventListener('mouseenter', () => {
      if (document.body.classList.contains('mini-mode')) document.body.classList.remove('mini-idle');
    });
    miniView.addEventListener('mouseleave', () => {
      if (document.body.classList.contains('mini-mode')) document.body.classList.add('mini-idle');
    });
    if (document.body.classList.contains('mini-mode')) document.body.classList.add('mini-idle');
  }

  initSettingsModal();

  state.isInitialized = true;
})();

// ── Settings Modal ───────────────────────────────
function initSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const saveBtn = document.getElementById('settings-save-btn');
  const openBtn = document.getElementById('btn-settings');
  if (!modal) return;

  openBtn?.addEventListener('click', showSettingsModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
  saveBtn?.addEventListener('click', saveAndClose);

  document.getElementById('lang-picker')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-btn');
    if (btn) highlightPicker('lang-picker', btn.dataset.lang, 'data-lang');
  });
}

function showSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  const s = loadSettings();

  highlightPicker('lang-picker', s.lang, 'data-lang');
  document.getElementById('setting-autoplay').checked = s.autoplayOnStart;
  document.getElementById('setting-startmini').checked = s.startMini;
  document.getElementById('setting-tracknotify').checked = s.trackNotify;

  api.getAutostart().then((on) => {
    document.getElementById('setting-autostart').checked = Boolean(on);
  });
  api.getAutoUpdateEnabled().then((on) => {
    document.getElementById('setting-autoupdate').checked = Boolean(on);
  });

  modal.classList.remove('hidden');
  modal.removeAttribute('aria-hidden');
  modal.querySelector('button')?.focus();
}

async function saveAndClose() {
  const lang = document.querySelector('#lang-picker .lang-btn.active')?.dataset.lang || 'de';
  const autoplayOn = document.getElementById('setting-autoplay').checked;
  const startMini = document.getElementById('setting-startmini').checked;
  const autostartOn = document.getElementById('setting-autostart').checked;
  const trackNotify = document.getElementById('setting-tracknotify').checked;
  const autoUpdateOn = document.getElementById('setting-autoupdate').checked;

  saveSettings({ lang, autoplayOnStart: autoplayOn, startMini, trackNotify });
  setLang(lang);
  api.setLang(lang);
  applyI18n();
  populateFilters();
  renderStations();
  updateListenBadge();
  updatePlayUI();
  if (state.activeStation) {
    const gainDb = loadInt(stationGainKey(state.activeStation.id), 0);
    const gainStr = gainDb !== 0 ? ` · ${gainDb > 0 ? '+' : ''}${gainDb} dB` : '';
    document.getElementById('active-station-subtitle').textContent =
      `${displayGenre(state.activeStation.genre)} · ${state.activeStation.country}${gainStr}`;
  }
  api.setAutostart(autostartOn);
  api.setAutoUpdateEnabled(autoUpdateOn);

  document.getElementById('settings-modal')?.classList.add('hidden');
}

function highlightPicker(pickerId, value, attr) {
  document.querySelectorAll(`#${pickerId} [${attr}]`).forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute(attr) === value);
  });
}
