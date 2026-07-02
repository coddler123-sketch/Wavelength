import { state, audio } from './renderer-state.js';
import {
  LS,
  saveBool,
  stationTodayKey,
  stationTotalKey,
  loadInt,
  updatePlayUI,
  reportConnectionState,
  displayTrackInfo,
  showToast,
  applyStationGain,
  updateListenBadge,
} from './renderer-ui.js';
import { bassTooltip, MEDIA_SESSION_FALLBACK } from './ui-labels.mjs';
import { t } from './i18n.js';
import {
  RECONNECT_DELAYS,
  shouldScheduleReconnect,
  reconnectDelayForAttempt,
  nextReconnectAttempt,
} from './reconnect-policy.mjs';

export { RECONNECT_DELAYS } from './reconnect-policy.mjs';

const api = window.electronAPI;
const { mediaSessionFields } = window.utils;

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
