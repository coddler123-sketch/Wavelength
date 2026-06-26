const T = {
  de: {
    'settings.title':      'Einstellungen',
    'settings.appearance': 'Darstellung',
    'settings.theme':      'Design',
    'settings.lang':       'Sprache',
    'settings.startup':    'Startverhalten',
    'settings.autoplay':   'Letzten Sender automatisch abspielen',
    'settings.startMini':  'Im Mini-Modus starten',
    'settings.autostart':  'Mit Windows starten',
    'settings.save':       'Speichern',
    'status.stopped':      'Gestoppt',
    'status.connecting':   'Verbinden',
    'status.reconnecting': 'Erneut verbinden',
    'status.live':         'Live',
    'status.muted':        'Stumm',
    'empty.fav.title':          'Keine Favoriten',
    'empty.fav.hint':           'Markiere Sender mit dem Stern, um sie hier zu sehen.',
    'empty.search.title':       'Keine Treffer',
    'empty.search.hint.query':  'Nichts gefunden für „{0}“.',
    'empty.search.hint.filter': 'Versuche andere Filter.',
    'empty.none.title':         'Keine Sender',
    'empty.none.hint':          'Füge eigene Sender über das Plus-Symbol hinzu.',
    'toast.sleep.on':  'Sleep in {0} min',
    'toast.sleep.off': 'Sleep aus',
    'toast.stream.error': 'Stream nicht erreichbar ({0})',
    'toast.retry': 'Nochmal',
  },
  en: {
    'settings.title':      'Settings',
    'settings.appearance': 'Appearance',
    'settings.theme':      'Theme',
    'settings.lang':       'Language',
    'settings.startup':    'Startup',
    'settings.autoplay':   'Auto-play last station on start',
    'settings.startMini':  'Start in mini mode',
    'settings.autostart':  'Start with Windows',
    'settings.save':       'Save',
    'status.stopped':      'Stopped',
    'status.connecting':   'Connecting',
    'status.reconnecting': 'Reconnecting',
    'status.live':         'Live',
    'status.muted':        'Muted',
    'empty.fav.title':          'No Favorites',
    'empty.fav.hint':           'Star a station to add it here.',
    'empty.search.title':       'No results',
    'empty.search.hint.query':  'Nothing found for “{0}”.',
    'empty.search.hint.filter': 'Try different filters.',
    'empty.none.title':         'No stations',
    'empty.none.hint':          'Add custom stations using the + button.',
    'toast.sleep.on':  'Sleep in {0} min',
    'toast.sleep.off': 'Sleep timer off',
    'toast.stream.error': 'Stream unreachable ({0})',
    'toast.retry': 'Retry',
  },
};

let _lang = 'de';

export function setLang(l) {
  _lang = T[l] ? l : 'de';
  document.documentElement.lang = _lang;
}
export function getLang() { return _lang; }

export function t(key, ...args) {
  const str = T[_lang]?.[key] ?? T.de[key] ?? key;
  return args.reduce((s, a, i) => s.replace(`{${i}}`, a), str);
}

export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}
