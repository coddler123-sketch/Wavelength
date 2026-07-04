# Hörstatistik-Ansicht — Design

**Datum:** 2026-07-04
**Status:** Approved (brainstorming), bereit für Implementierungsplan

## Ziel

Eine neue, rein lesende Statistik-Ansicht zeigt, welche Sender wie lange gehört wurden — basierend ausschließlich auf bereits vorhandenen `localStorage`-Daten (`stationTotalKey`, `stationTodayKey`, `LS.listenOverallTotal`). Keine neue Persistenzlogik, keine Zeitverlauf-/Trend-Funktion (siehe Scope-Abgrenzung).

## Datengrundlage (bereits vorhanden, unverändert)

- `stationTotalKey(id)` → `wl.listenTotalMs_<id>`: Lifetime-Hördauer in ms pro Sender.
- `stationTodayKey(id)` → `wl.listenTodayMs_<id>`: Hördauer in ms pro Sender, täglich auf 0 zurückgesetzt (siehe `LS.listenDate`-Vergleich in `renderer-ui.js`).
- `LS.listenOverallTotal` (`wl.listenOverallTotalMs`): globale Lifetime-Summe über alle Sender.

## Technischer Ansatz

**Reine Logik in `src/utils.js` (UMD, wie `buildRecentsList`/`formatListen` — Node-testbar ohne Browser):**

```js
function buildStatsList(stations, listenData) {
  // listenData: { [stationId]: { total: number, today: number } } in ms
  return stations
    .map((s) => ({ id: s.id, name: s.name, total: listenData[s.id]?.total ?? 0, today: listenData[s.id]?.today ?? 0 }))
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);
}
```

Exportiert per UMD wie die bestehenden Utility-Funktionen. Kein `localStorage`-Zugriff, kein DOM-Zugriff — reine Transformation, damit sie 1:1 nach dem Muster von `buildRecentsList` (`scripts/test.js`) unit-testbar ist.

**Renderer-seitige Glue-Funktion in `src/renderer-ui.js`** (analog zu bestehenden Read-Helpern wie `loadInt`):

```js
function collectListenData(stations) {
  const data = {};
  for (const s of stations) {
    data[s.id] = {
      total: loadInt(stationTotalKey(s.id), 0),
      today: loadInt(stationTodayKey(s.id), 0),
    };
  }
  return data;
}
```

Diese Funktion liest `localStorage`, `buildStatsList()` bleibt frei davon.

**Rendering in `src/renderer.js`** (das bestehende `#history-modal`-Öffnen/Schließen/Rendern lebt komplett dort, kein separates Modal-Modul — neue Funktion folgt demselben Ort): `renderStatsList()` ruft `collectListenData(state.allStations)` → `buildStatsList(...)` auf, baut die Liste als HTML in `#stats-list` (analog zum bestehenden `#history-list`-Rendering), formatiert Zeiten über `formatListen()`. Öffnen/Schließen des Modals folgt demselben `classList.add/remove('hidden')`-Muster wie `#history-modal`.

## UI

- **Einstiegspunkt:** Neuer Abschnitt "Statistik" im bestehenden `#settings-modal` (`src/index.html`, nach dem "System"-Abschnitt), mit einem Button `#btn-show-stats` ("Statistik anzeigen").
- **Modal:** Neues `#stats-modal`, exakt nach dem Muster von `#history-modal` aufgebaut: `class="modal-overlay hidden"`, `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `.modal-content`, Titel via `data-i18n`, Liste-Container (`#stats-list`, `aria-live="polite"`), `.modal-buttons--full` mit einem Schließen-Button.
- **Inhalt:**
  - Kopfzeile: "Insgesamt gehört: {formatListen(LS.listenOverallTotal)}".
  - Darunter eine Zeile pro Sender aus `buildStatsList()`-Ergebnis: Sendername, Gesamt-Hördauer (`formatListen(total)`), und falls `today > 0` zusätzlich "heute: {formatListen(today)}".
  - Leerer Zustand (kein Sender mit Total > 0): Hinweistext, analog zum bestehenden `empty.none`-Pattern in `i18n.js` (z. B. "Noch keine Hördaten vorhanden").

## Fehlerbehandlung

Keine — reine Anzeige bestehender, bereits validierter `localStorage`-Werte (`loadInt` liefert bei fehlendem/ungültigem Wert bereits `0` als Fallback, wie im gesamten übrigen Code).

## Tests

- **Unit (`scripts/test.js`):** `buildStatsList()` — Sortierung nach `total` absteigend, Filterung auf `total > 0`, korrekte Zuordnung von `today`/`total` pro Sender, leeres Array bei keinem Treffer. Analog zu den bestehenden `buildRecentsList`-Tests.
- **Smoke-Check:** `#btn-show-stats` und `#stats-modal`/`#stats-list` zu den geprüften HTML-IDs hinzufügen (analog zum bestehenden Muster für `history-modal`/`history-list`, falls dort geprüft — sonst neu ergänzen).
- **E2E (Playwright):** Einstellungen öffnen → "Statistik anzeigen" klicken → Modal sichtbar, mindestens ein Eintrag vorhanden (da die laufende Test-Session bereits Sender abgespielt hat) → Schließen-Button schließt Modal. Nach der in dieser Session neu etablierten Regel zum visuellen Gegenlesen: vor dem Release zusätzlich einen echten Screenshot der Modal-Darstellung prüfen, nicht nur `toBeVisible()`.

## Scope-Abgrenzung

- **Keine Zeitverlauf-/Trend-Ansicht.** Es werden keine neuen täglichen Snapshots gespeichert — nur die bereits vorhandenen Werte (Lifetime-Total, heutiger Wert, globale Summe) werden angezeigt. Diese Entscheidung wurde im Brainstorming explizit getroffen (YAGNI — nicht angefragt).
- **Keine Änderung an der bestehenden Tracking-Logik** in `renderer-ui.js` (wie/wann `stationTodayKey`/`stationTotalKey` geschrieben werden) — nur lesender Zugriff.
- **Keine Änderung am bestehenden Track-History-Modal** (`#history-modal`, Song-Verlauf via ICY-Metadaten) — das ist ein separates, unverändertes Feature.
