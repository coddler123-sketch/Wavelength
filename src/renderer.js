import { state } from './renderer-state.js';
import {
  LS, loadInt, loadBool, saveBool,
  stationTodayKey, stationTotalKey, stationGainKey,
  updatePlayUI, updateListenBadge, reportConnectionState,
  displayTrackInfo, setActiveStationName,
  updateVolSlider, applyStationGain,
  adjustStationGain, resetStationGain, STATION_GAIN_STEP_DB,
  setMini, setPinned, setMuted, setAppVersion,
  setSleepEndsAt, showToast, updateTimeTheme, setThemeLevel,
  sendTrayIcons, switchView,
  showAboutModal, hideAboutModal,
} from './renderer-ui.js';
import {
  BASS_GAINS, applyBassBoost, cycleBassBoost,
  startPlay, stopPlay, updateMediaSession,
  startListenTimer, stopListenTimer,
  scheduleReconnect, cancelReconnect, RECONNECT_DELAYS,
} from './renderer-audio.js';
import {
  renderStations, selectStation, populateFilters,
  populateRecents, initKeyboardNav, toggleFavorite,
  updatePlayerFavStar,
} from './renderer-stations.js';

const api = window.electronAPI;

// ── Visualizer ───────────────────────────────────
const { averageLevel } = window.utils;
state.visualizer = WavelengthVisualizer.create({
  canvas:       document.getElementById('visualizer'),
  miniCanvas:   document.getElementById('mini-visualizer'),
  storageKey:   LS.vizMode,
  averageLevel,
  getAnalyser:  () => state.analyser,
  getState:     () => ({ playing: state.playing, muted: state.muted, windowVisible: state.windowVisible }),
  onLevel:      setThemeLevel,
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
  state.bassBoostLevel = 0;
  applyBassBoost();
  state.visualizer.resetMode();
  updatePlayUI();
  updateListenBadge();
  if (state.allStations.length > 0) {
    selectStation(state.allStations[0]);
  }
}

// ── Button Wiring ────────────────────────────────
safeAddListener('btn-playstop',     'click', () => api.playPause());
safeAddListener('mini-playstop',    'click', () => api.playPause());
safeAddListener('btn-mute',         'click', () => api.toggleMute());
safeAddListener('vol-slider',       'input', (e) => updateVolSlider(parseInt(e.target.value, 10)));
safeAddListener('mini-vol',         'input', (e) => updateVolSlider(parseInt(e.target.value, 10)));
safeAddListener('btn-pin',          'click', () => api.togglePin());
function triggerToggleMini() {
  if (state.visualizer) state.visualizer.stop();
  setTimeout(() => {
    api.toggleMini();
  }, 16);
}

safeAddListener('btn-toggle-mini',  'click', () => triggerToggleMini());
safeAddListener('mini-expand',      'click', () => triggerToggleMini());
safeAddListener('btn-hide',         'click', () => api.hideWindow());
safeAddListener('mini-hide',        'click', () => api.hideWindow());
safeAddListener('btn-sleep',        'click', () => api.cycleSleepTimer());
safeAddListener('btn-bass',         'click', cycleBassBoost);
safeAddListener('station-gain-pill', 'click', resetStationGain);
safeAddListener('visualizer',       'click', () => state.visualizer.toggleMode());

safeAddListener('btn-view-toggle', 'click', () => {
  const isList = document.body.classList.contains('view-list-active');
  switchView(isList ? 'player' : 'list');
});
safeAddListener('player-fav-btn', 'click', () => {
  if (state.activeStation) toggleFavorite(state.activeStation.id);
});

safeAddListener('station-search', 'input',  () => renderStations());
safeAddListener('genre-filter',   'change', () => renderStations());
safeAddListener('lang-filter',    'change', () => renderStations());
safeAddListener('btn-fav-filter', 'click', () => {
  state.favFilterActive = !state.favFilterActive;
  const btn = document.getElementById('btn-fav-filter');
  if (btn) btn.classList.toggle('active', state.favFilterActive);
  renderStations();
});

// ── Visualizer Context Menu ───────────────────────
const vizCanvas    = document.getElementById('visualizer');
const contextMenu  = document.getElementById('viz-context-menu');

if (vizCanvas && contextMenu) {
  vizCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextMenu.innerHTML = '<div class="context-menu-title">Visualizer Modus</div>';
    const currentMode = state.visualizer.getMode();
    WavelengthVisualizer.VISUALIZER_MODES.forEach(m => {
      const item = document.createElement('div');
      item.className = 'context-menu-item' + (m === currentMode ? ' active' : '');
      item.textContent = WavelengthVisualizer.VISUALIZER_LABELS[m] || m;
      item.addEventListener('click', () => {
        state.visualizer.setMode(m);
        contextMenu.style.display = 'none';
      });
      contextMenu.appendChild(item);
    });
    let x = e.clientX, y = e.clientY;
    const menuWidth = 142, menuHeight = 240;
    const winWidth = window.innerWidth, winHeight = window.innerHeight;
    if (x + menuWidth  > winWidth)  x = winWidth  - menuWidth  - 8;
    if (y + menuHeight > winHeight) y = winHeight - menuHeight - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    contextMenu.style.left = x + 'px';
    contextMenu.style.top  = y + 'px';
    contextMenu.style.display = 'block';
  });
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) contextMenu.style.display = 'none';
  });
}

// ── Double Click Drag Areas ──────────────────────
safeQueryListener('.logo-area',  'dblclick', (e) => { if (e.target.closest('button') || e.target.closest('input')) return; triggerToggleMini(); });
safeQueryListener('.mini-info',  'dblclick', (e) => { if (e.target.closest('button') || e.target.closest('input')) return; triggerToggleMini(); });
safeQueryListener('.mini-logo',  'dblclick', (e) => { if (e.target.closest('button') || e.target.closest('input')) return; triggerToggleMini(); });

// ── About Modal Wiring ───────────────────────────
const aboutModal = document.getElementById('about-modal');
safeAddListener('about-close-btn', 'click', hideAboutModal);
safeAddListener('about-ok-btn',    'click', hideAboutModal);
safeAddListener('about-web-btn',   'click', () => {
  if (state.activeStation && state.activeStation.website) api.openExternal(state.activeStation.website);
  hideAboutModal();
});
if (aboutModal) {
  aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) hideAboutModal(); });
}

// ── Keyboard Shortcuts ───────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && aboutModal && aboutModal.style.display === 'flex') {
    e.preventDefault();
    hideAboutModal();
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  const vol = () => parseInt(document.getElementById('vol-slider').value, 10);
  switch (e.code) {
    case 'Space':    e.preventDefault(); api.playPause(); break;
    case 'KeyM':     api.toggleMute(); break;
    case 'KeyB':     cycleBassBoost(); break;
    case 'KeyV':     state.visualizer.toggleMode(); break;
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
window.addEventListener('wheel', (e) => {
  const picker = e.target.closest('.station-picker');
  if (picker) {
    const list = document.getElementById('station-list');
    if (list) list.scrollTop += e.deltaY;
    return;
  }
  if (e.target.closest('#viz-context-menu') || e.target.closest('.context-menu')) return;
  e.preventDefault();
  const vol = parseInt(document.getElementById('vol-slider').value, 10);
  updateVolSlider(Math.max(0, Math.min(100, vol + (e.deltaY < 0 ? 5 : -5))));
  if (!localStorage.getItem('wl.scrollHintSeen')) {
    localStorage.setItem('wl.scrollHintSeen', '1');
    showToast('Mausrad = Lautstärke');
  }
}, { passive: false });

// ── IPC from main ────────────────────────────────
api.onSetPlaying((val) => { val ? startPlay() : stopPlay(); });
api.onSetPinned(setPinned);
api.onSetMini((on) => {
  setMini(on);
  if (state.playing && state.visualizer) {
    state.visualizer.start();
  }
});
api.onSetMuted(setMuted);
api.onSleepUpdate(setSleepEndsAt);
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
api.onSetStation((station) => {
  if (state.isInitialized && station && (!state.activeStation || state.activeStation.id !== station.id)) {
    selectStation(station);
  }
});
api.onTrackInfo((title) => {
  displayTrackInfo(title);
  updateMediaSession(state.playing);
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
    setTimeout(() => { state.isListDragging = false; }, 50);
  });

  list.addEventListener('mousemove', (e) => {
    if (!state.isListDragging) return;
    const delta = e.pageY - state.listDragStart;
    if (Math.abs(delta) > 5) state.hasDraggedSignificant = true;
    list.scrollTop = state.listScrollStart - delta;
  });
}

// ── Init ─────────────────────────────────────────
(async () => {
  state.allStations = await api.getStations();

  populateFilters();
  initListDragToScroll();
  populateRecents();
  initKeyboardNav();

  const appState     = await api.getState();
  const lastStationId = localStorage.getItem('wl.lastStationId');
  let loadedStation   = null;
  if (lastStationId) {
    loadedStation = state.allStations.find(s => s.id === lastStationId);
  }
  if (!loadedStation && state.allStations.length > 0) {
    loadedStation = state.allStations[0];
  }
  if (loadedStation) {
    selectStation(loadedStation);
  }

  renderStations();
  updatePlayerFavStar();

  setAppVersion(appState.version);
  setSleepEndsAt(appState.sleepEndsAt);
  updateListenBadge();

  updateVolSlider(loadInt(LS.vol, 80), false);
  setMuted(loadBool(LS.muted));
  state.bassBoostLevel = loadInt(LS.bass, 0);
  applyBassBoost();
  updatePlayUI();

  sendTrayIcons();
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

  const wantPin   = loadBool(LS.pin);
  const wantMini  = loadBool(LS.mini);
  const wantMuted = loadBool(LS.muted);
  if (wantPin   !== appState.isPinned) api.togglePin();
  if (wantMini  !== appState.isMini)   triggerToggleMini();
  if (wantMuted !== appState.isMuted)  api.toggleMute();

  if (loadBool(LS.playing)) api.playPause();

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

  state.isInitialized = true;
})();
