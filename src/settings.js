const KEY = 'wl.settings';

export const DEFAULTS = {
  lang: 'de',
  theme: 'nacht',
  autoplayOnStart: false,
  startMini: false,
  trackNotify: false,
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  localStorage.setItem(KEY, JSON.stringify({ ...loadSettings(), ...patch }));
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'nacht';
}
