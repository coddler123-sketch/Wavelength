import { t } from './i18n.js';

export function connectionLabel(state) {
  const key = {
    reconnecting: 'status.reconnecting',
    muted:        'status.muted',
    live:         'status.live',
    connecting:   'status.connecting',
    stopped:      'status.stopped',
  }[state] || 'status.stopped';
  return t(key);
}

export function playStopLabel(isPlaying) {
  return isPlaying ? t('tooltip.stop') : t('tooltip.play');
}

export function bassTooltip(level) {
  const labels = [t('tooltip.bass.off'), '+6 dB', '+12 dB'];
  return t('tooltip.bass.level', labels[level] ?? labels[0]);
}

export const MEDIA_SESSION_FALLBACK = {
  title: 'Livestream',
  artist: 'Wavelength',
  album: 'Multi-Sender-Radio',
};
