# 3-Band-Equalizer — Design

**Datum:** 2026-07-03
**Status:** Approved (brainstorming), bereit für Implementierungsplan

## Ziel

Der bestehende 1-Band-Bass-Boost (`renderer-audio.js`, `BASS_GAINS = [0, 6, 12]`, Cycle-Button `btn-bass`) wird durch einen 3-Band-Equalizer (Bass/Mid/Treble) mit stufenlosen Reglern ersetzt. Der Bass-Boost-Button und sein Zustand entfallen ersatzlos.

## Technischer Ansatz

Web Audio API bietet keinen fertigen Mehrband-EQ-Node. Die Kette aus drei `BiquadFilterNode`s in Serie (wie der bestehende `bassFilter`) ist der etablierte, einfache Weg dafür. Eine `AudioWorklet`-basierte Eigenimplementierung wäre für drei feste Bänder unverhältnismäßiger Aufwand — verworfen.

### Audio-Kette (in `initAudioCtx()`, `renderer-audio.js`)

Ersetzt den einzelnen `bassFilter` durch drei Filter in Serie:

| Band | Typ | Frequenz | Q |
|------|-----|----------|---|
| Bass | `lowshelf` | 200 Hz | — |
| Mid | `peaking` | 1000 Hz | 1 |
| Treble | `highshelf` | 4000 Hz | — |

Neue Kette:
```
source → eqBass → eqMid → eqTreble → analyser → stationGain → limiter → destination
```

Jeder Filter startet mit `gain.value = 0` (flat) und wird beim Start aus `localStorage` befüllt.

### Wertebereich

Jeder Regler: **−15 dB bis +15 dB**, Default **0 dB**.

## UI

- Der bestehende `btn-bass`-Button wird zu `btn-eq` (gleiche Position in der Control-Leiste, neues Icon/Tooltip statt Bass-Boost-Icon).
- Klick öffnet ein **Popover** (kein Modal, keine Fenstergrößenänderung — das Fenster ist fest 460×520, `resizable: false`) mit drei horizontalen Slidern, gestylt wie der bestehende Lautstärke-Slider (Track, Thumb, Accent-Glow).
- Reihenfolge im Popover: Bass, Mid, Treble (oben nach unten), jeweils mit Label und aktuellem dB-Wert als Text (z. B. "Bass +3 dB").
- Unterhalb der Slider: ein **"Zurücksetzen"**-Button/Link, der alle drei Werte auf 0 dB setzt (UI + Filter + Storage).
- Popover schließt bei Klick außerhalb (gleiches Verhalten wie das bestehende Context-Menü-Muster, falls vorhanden) oder erneutem Klick auf `btn-eq`.

## Datenfluss & Persistenz

Drei neue `localStorage`-Keys in `LS` (`renderer-ui.js`):
```js
eqBass: 'wl.eqBass',
eqMid: 'wl.eqMid',
eqTreble: 'wl.eqTreble',
```

Jeweils der dB-Wert als Zahl (String-serialisiert). Fallback beim Fehlen: `0`.

**Entfernt:** `LS.bass`, `BASS_GAINS`, `state.bassBoostLevel`, `applyBassBoost()`, `cycleBassBoost()`, `bassTooltip()` (aus `ui-labels.mjs`), zugehörige HTML-Elemente/CSS für `btn-bass`, zugehörige i18n-Strings für Bass-Tooltips.

**Tastenkürzel:** Die Taste **B** (bisher "Bass-Boost cyclen") wird zum EQ-Popover-Toggle umgewidmet — öffnet/schließt das Popover, analog zur alten Kurzfunktion "B für Bass".

**Migration:** Kein automatischer Migrationspfad von `wl.bassBoost` (0/1/2) zu den neuen dB-Werten nötig — Neustart mit flat (0 dB) ist akzeptabel, da es sich um eine Klangeinstellung handelt, die der Nutzer bei Bedarf neu setzt.

## Fehlerbehandlung

Kein zusätzliches Error-Handling nötig — `BiquadFilterNode` kann nicht fehlschlagen, sobald `AudioContext` existiert (bestehendes Verhalten von `bassFilter` unverändert übernommen).

## Tests

- **Unit:** Analog zum bestehenden IPC/UMD-Kontrakttest prüfen, dass alte Exporte (`BASS_GAINS`, `applyBassBoost`, `cycleBassBoost`) entfernt sind und keine toten Referenzen mehr existieren (ESLint `--max-warnings 0` deckt das ohnehin ab). Kein Node-Test für die Audio-Kette selbst möglich (kein `AudioContext` in Node) — bleibt wie bisher ungetestet auf Unit-Ebene.
- **E2E (Playwright):** Popover öffnen (`btn-eq`-Klick), einen Slider per `fill`/`evaluate` auf einen Wert setzen, Popover schließen, App-Reload simulieren (oder direkt `localStorage`-Wert prüfen), Wert muss persistiert sein. Reset-Test: Werte setzen, Reset klicken, alle drei müssen 0 sein.
- **Manuell:** Hörprobe mit echtem Stream, dass alle drei Bänder hörbar wirken und sich nicht gegenseitig unerwartet verstärken (Clipping wird vom bestehenden `DynamicsCompressor`-Limiter nach der Kette abgefangen, unverändert).

## Scope-Abgrenzung

Dieser Spec deckt **nur** den Equalizer ab. Die beiden weiteren geplanten Features (globale Tastenkürzel, Verlaufs-/Statistik-Ansicht) sind unabhängige Subsysteme und werden separat gebrainstormt, jeweils mit eigenem Spec und Implementierungsplan.
