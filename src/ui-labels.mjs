export const CONNECTION_LABELS = {
  reconnecting: 'Erneut verbinden',
  muted: 'Stumm',
  live: 'Live',
  connecting: 'Verbinden',
  stopped: 'Gestoppt',
};

export const BASS_LABELS = ['aus', '+6 dB', '+12 dB'];

export const MEDIA_SESSION_FALLBACK = {
  title: 'Livestream',
  artist: 'Wavelength',
  album: 'Multi-Sender-Radio',
};

export function connectionLabel(state) {
  return CONNECTION_LABELS[state] || CONNECTION_LABELS.stopped;
}

export function playStopLabel(isPlaying) {
  return isPlaying ? 'Stoppen' : 'Abspielen';
}

export function bassTooltip(level) {
  return `Bassverstärkung: ${BASS_LABELS[level] || BASS_LABELS[0]}`;
}
