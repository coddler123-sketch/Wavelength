// Runs in both Node (require) and browser (sets window.utils).
(function (exports) {
  function formatListen(ms) {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest  = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  function averageLevel(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  // Pure tray-state resolver — same logic as main.js trayState(), but testable.
  function trayState(connectionState, isMuted, isPlaying) {
    if (connectionState === 'reconnecting') return 'reconnecting';
    if (isMuted) return 'muted';
    return isPlaying ? 'playing' : 'stopped';
  }

  // Smooth multi-sine fake bar for the visualizer fallback animation.
  function fakeBar(t, i, count) {
    const shape = Math.pow(Math.sin((i / count) * Math.PI), 0.6);
    const n = (
      Math.sin(t * 1.1  + i * 0.35) * 0.30 +
      Math.sin(t * 2.3  + i * 0.19) * 0.22 +
      Math.sin(t * 0.7  + i * 0.52) * 0.18 +
      Math.sin(t * 3.7  + i * 0.11) * 0.14 +
      Math.sin(t * 0.31 + i * 0.73) * 0.08 +
      Math.sin(t * 5.1  + i * 0.27) * 0.05
    );
    return Math.max(0, Math.min(1, (n + 0.62) * shape));
  }

  exports.formatListen = formatListen;
  exports.averageLevel = averageLevel;
  exports.trayState    = trayState;
  exports.fakeBar      = fakeBar;
// eslint-disable-next-line no-undef
})(typeof module !== 'undefined' ? module.exports : (window.utils = {}));
