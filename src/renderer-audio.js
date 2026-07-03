import { state, audio } from './renderer-state.js';
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
import { t } from './i18n.js';
import {
  shouldScheduleReconnect,
  reconnectDelayForAttempt,
  nextReconnectAttempt,
} from './reconnect-policy.mjs';

export { RECONNECT_DELAYS } from './reconnect-policy.mjs';

const api = window.electronAPI;
const { mediaSessionFields } = window.utils;

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

// ── Audio Context ────────────────────────────────
export function initAudioCtx() {
  if (state.audioCtx) {
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
    return;
  }
  state.audioCtx = new AudioContext({ latencyHint: 'playback' });
  const source = state.audioCtx.createMediaElementSource(audio);
  state.analyser = state.audioCtx.createAnalyser();
  state.analyser.fftSize = 256;
  state.analyser.smoothingTimeConstant = 0.82;

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
}

// ── Auto-reconnect ───────────────────────────────
function setReconnecting(on) {
  document.body.classList.toggle('reconnecting', on);
  if (on) reportConnectionState('reconnecting');
}

export function scheduleReconnect() {
  if (!shouldScheduleReconnect(state.reconnectTimer, state.playing)) return;
  setReconnecting(true);
  const delay = reconnectDelayForAttempt(state.reconnectAttempt);
  state.reconnectAttempt = nextReconnectAttempt(state.reconnectAttempt);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (state.playing) {
      audio.src = state.streamUrl;
      audio.load();
      audio.play().catch(() => scheduleReconnect());
    }
  }, delay);
}

export function cancelReconnect() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.reconnectAttempt = 0;
  setReconnecting(false);
  if (state.playing) reportConnectionState(state.muted ? 'muted' : 'live');
}

// ── Windows Media Session (SMTC) ─────────────────
export function updateMediaSession(isPlaying) {
  if (!('mediaSession' in navigator)) return;
  if (state.activeStation) {
    const { title, artist } = mediaSessionFields(state.currentTrackInfoText, state.activeStation.name);
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: `${state.activeStation.genre} · ${state.activeStation.country}`,
      artwork: state.activeStation.iconUrl
        ? [{ src: state.activeStation.iconUrl, sizes: '128x128', type: 'image/png' }]
        : [],
    });
  } else {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: MEDIA_SESSION_FALLBACK.title,
      artist: MEDIA_SESSION_FALLBACK.artist,
      album: MEDIA_SESSION_FALLBACK.album,
    });
  }
  navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => api.playPause());
  navigator.mediaSession.setActionHandler('pause', () => api.playPause());
  navigator.mediaSession.setActionHandler('stop', () => {
    if (state.playing) api.playPause();
  });
}

// ── Listen Timer ─────────────────────────────────
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function addListenTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0 || !state.activeStation) return;
  ensureListenDate();
  const rounded = Math.round(ms);
  const id = state.activeStation.id;
  const today = parseInt(localStorage.getItem(stationTodayKey(id)) || '0', 10) + rounded;
  const total = parseInt(localStorage.getItem(stationTotalKey(id)) || '0', 10) + rounded;
  const overall = parseInt(localStorage.getItem(LS.listenOverallTotal) || '0', 10) + rounded;
  localStorage.setItem(stationTodayKey(id), String(today));
  localStorage.setItem(stationTotalKey(id), String(total));
  localStorage.setItem(LS.listenOverallTotal, String(overall));
  updateListenBadge();
}

function recordListenTick() {
  const now = Date.now();
  const delta = state.lastListenAt ? now - state.lastListenAt : 0;
  state.lastListenAt = now;
  if (state.playing && delta >= 1000 && delta <= 90_000) addListenTime(delta);
}

export function startListenTimer() {
  if (state.listenTimer) return;
  state.lastListenAt = Date.now();
  state.listenTimer = setInterval(recordListenTick, 15_000);
}

export function stopListenTimer() {
  recordListenTick();
  if (state.listenTimer) {
    clearInterval(state.listenTimer);
    state.listenTimer = null;
  }
  state.lastListenAt = 0;
}

// ── Playback ─────────────────────────────────────
export function startPlay() {
  if (!state.streamUrl) {
    console.warn('Cannot play: streamUrl is empty.');
    return;
  }
  if (state.playing) return;
  initAudioCtx();
  audio.src = state.streamUrl;
  audio.load();
  reportConnectionState('connecting');
  audio.play().catch(() => scheduleReconnect());
  state.playing = true;

  state.currentTrackInfoText = '';
  displayTrackInfo('');

  saveBool(LS.playing, true);
  updatePlayUI();
  updateMediaSession(true);
  startListenTimer();
  if (state.visualizer) state.visualizer.start();
}

export function stopPlay() {
  state.playing = false;
  audio.pause();
  audio.src = '';
  try {
    audio.load();
  } catch (e) {
    console.warn('[audio] load() after stop failed:', e);
  }
  cancelReconnect();
  stopListenTimer();
  reportConnectionState('stopped');

  state.currentTrackInfoText = '';
  displayTrackInfo('');

  saveBool(LS.playing, false);
  updatePlayUI();
  updateMediaSession(false);
  if (state.visualizer) state.visualizer.drawIdle();
}

// ── Audio Element Events ─────────────────────────
audio.addEventListener('error', () => {
  if (!state.playing) return;
  const err = audio.error;
  if (err && err.code === 1) return; // MEDIA_ERR_ABORTED — normal source change
  scheduleReconnect();
});
audio.addEventListener('stalled', () => {
  if (state.playing) scheduleReconnect();
});
audio.addEventListener('ended', () => {
  if (state.playing) scheduleReconnect();
});
audio.addEventListener('playing', () => {
  cancelReconnect();
  reportConnectionState(state.muted ? 'muted' : 'live');
});
