# Projektübersicht — Api

Alle aktiven Projekte, Technologien und aktueller Stand. Stand: August 2026.

---

## 1. Trading Journal — Mobile App

**Repo:** `gastj01/trading-journal-app1`
**Gerät:** Samsung Galaxy Z Fold 8 (Android 16)
**Build:** GitHub Actions → APK (kein lokaler Build)

### Tech Stack
- Expo SDK 57 + Expo Router + React Native 0.86.2
- New Architecture (`newArchEnabled: true`)
- Supabase (Auth, PostgreSQL, Storage)
- TypeScript
- Claude Sonnet 4.6 (KI-Analyse)

### Features
- Trade-Erfassung (Entry, SL, TP-Levels, Break Even, Positionsgröße)
- Trade-Management (SL → BE, Partial Close, TP-Hit Events)
- Screenshot-Upload pro Trade (Supabase Storage: `trade-screenshots`)
- MFE/MAE-Analyse mit Binance-Kerzendaten (live fetch)
- Strategie-Profile mit Regelwerk + Checkliste
- Tag-System (mistake / execution / context)
- Analytics: Win Rate, Total R, Profit Factor, Equity-Kurve, Heatmap, Session-Auswertung, Tag-Analyse, Management-Auswertung
- **KI-Features (Claude Sonnet 4.6):**
  - Auto-Tag & KI Review pro Trade (ki_notes Feld, tags automatisch gesetzt)
  - Strategie-Bewertung (Performance-Analyse mit Haiku)
  - Regelwerk-Analyse: alle Trades mit Kerzendaten + bis zu 8 Screenshots (beste 4 + schlechteste 4)
  - Regelwerk-Verlauf (`strategy_ruleset_history` — alte Versionen werden gesichert)
  - Trade-Plan-Bewertung im neuen Trade: Screenshot + Kerzen vor Entry → KI prüft gegen Regelwerk
- Candle-Toggle im KI Review: kompakt (max. 150 Kerzen) oder vollständig

### Supabase-Tabellen (wichtigste)
| Tabelle | Zweck |
|---|---|
| `trades` | Kerntabelle inkl. `ki_notes` |
| `trade_partial_profits` | TP-Levels + BE-Trigger |
| `trade_management_events` | SL/TP-Bewegungen, Exits |
| `trade_tag_definitions` | Tag-Definitionen |
| `trade_tag_assignments` | Tag → Trade Verknüpfungen |
| `strategy_profiles` | Strategie mit Regelwerk |
| `strategy_ruleset_history` | Versionierung des Regelwerks |
| `strategy_checklist_items` | Checkliste pro Strategie |
| `trading_accounts` | Konten (live / prop / backtest) |
| `market_candles` | Kerzen-Cache (aktuell leer, Binance live) |

### Bekannte Einschränkungen
- Split Screen auf Fold 8 nicht funktionsfähig (RNGH native touch dispatch Bug)
- expo-image-picker crasht nativ → Screenshot-Upload via expo-document-picker

---

## 2. Trading Journal — PC / Web App

**Pfad lokal:** `~/tj-extract/trading-journal/`
**Datenbank:** Selbe Supabase-Instanz wie Mobile (geteilte Tabellen)

### Tech Stack
- Next.js (App Router)
- Supabase (Auth, PostgreSQL, Storage)
- TypeScript
- Binance API (Kerzendaten)
- Claude Vision (Screenshot-Erkennung)

### Features (über Mobile hinaus)
- **Screenshot-Erkennung:** Claude Vision OCR erkennt Entry, SL, Symbol automatisch aus Chart-Screenshots
- **Szenario-Lab:** Was-wäre-wenn-Analyse mit alternativen SL/TP-Positionen + Candle-Replay
- **Szenario-Vergleich:** Mehrere Management-Strategien gleichzeitig vergleichen
- **Trailing SL / Profit SL:** Backtesting verschiedener Exit-Methoden
- **Management-Timeline:** Visueller Chart mit allen Events (SL-Bewegungen, Partials, TP-Hits)
- **Live-Management-Modus:** Echtzeit-Trade-Begleitung während offener Positionen
- **Strategie-Playbook:** Detaillierte Regelwerk-Verwaltung mit Setups
- **Performance-Auswertung:** Setup-Performance, Datenqualitäts-Check, Tag-Analyse
- **Binance-Kerzen-Cache:** Kerzendaten werden in Supabase `market_candles` gecacht

### Hinweis
Die PC App hat mehr Features als die Mobile App — insbesondere Szenario-Lab und Screenshot-Erkennung. Neue Features werden zunächst in der PC App entwickelt, dann bei Bedarf in die Mobile App portiert.

---

## 3. MMT Touch Pad

**Repo:** lokal unter `~/mmt-touch-pad/`
**Gerät:** Samsung Galaxy Z Fold 8 (Android 16, kein Root)
**Build:** on-device in Termux (`./gradlew assembleDebug`)

### Zweck
Android-App die MMT (`app.mmt.gg`, TradingView-ähnliche Charting-App) über Touch steuerbar macht — ohne externe Tastatur oder Maus. Sendet echte (`isTrusted=true`) Eingabe-Events via uinput-Kernel-Device.

### Tech Stack
- Kotlin + JNI (C++ für uinput ioctl-Calls)
- Shizuku (Shell-uid 2000 UserService — kein Root nötig)
- `TYPE_APPLICATION_OVERLAY` Foreground Service
- Referenz-Implementierung: `github.com/pgratz1/AR-Touchpad` (Apache 2.0)

### Warum uinput statt DOM-Events
MMT lehnt synthetische DOM-Events ab (`isTrusted=false`). Nur echte uinput-Devices erzeugen trusted Events. Bestätigt durch Test mit "Real Mouse" App (Shizuku + uinput → MMT Context Menu öffnet sich).

### Features
- **Floating Bubble:** Kleines kreisförmiges Panel, dockbar an Bildschirmrand
- **12 Slots:** Frei belegbar mit Tastenkombinationen (Ctrl/Shift/Alt + Taste) oder Rechtsklick-Trigger
- **Custom Labels:** Slots zeigen frei gewählten Namen, nicht die rohe Tastenkombination
- **Tap-to-place Rechtsklick:** Bubble schließt sich, transparentes Overlay fängt nächsten Tap ab, klickt dort per uinput-Maus
- **Absoluter Klick (Beta):** `EV_ABS` mapping — direkte Koordinaten ohne Lag
- **Config persistent:** SharedPreferences / JSON (`SlotStore.kt`)
- **Kein Autostart** — manueller Start pro Session (Shizuku überlebt Neustart sowieso nicht ohne Root)

### Build-Umgebung (verifiziert Aug 2026)
- NDK: `lzhiyong/termux-ndk` r29 → `~/android-ndk-r29/`
- Termux-native Tools: `aidl`, `cmake`, `ninja`, `aapt2`
- `build-tools/34.0.0/aidl` ersetzt durch Shell-Wrapper auf Termux-`aidl`

### Status
✅ Build läuft durch — `app-debug.apk` (2,4 MB), on-device getestet, funktioniert einwandfrei.

---

## Gemeinsame Infrastruktur

| Dienst | Zweck |
|---|---|
| Supabase | Auth, PostgreSQL DB, File Storage (Screenshots) |
| Binance API | OHLCV Kerzendaten (live + gecacht) |
| Anthropic API | Claude Sonnet 4.6 für KI-Analyse, Claude Haiku für Performance-Bewertung |
| GitHub Actions | APK-Build für Mobile App (push → master → APK artifact) |

---

## Geräte-Setup

**Samsung Galaxy Z Fold 8**
- Android 16
- Termux (Entwicklungsumgebung on-device)
- Shizuku (Wireless Debugging, kein Root)
- Claude Code CLI in Termux
