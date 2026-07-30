# ImpactLens Benchmark

**Stand der Auswertung:** 50 primäre Runs über 5 Tickets (je 5 WITH / 5 WITHOUT)  
**Quellen:** Rohdaten in `summary/*-with-impactlens-summary.md` und `summary/*-without-impactlens-summary.md`, Zwischenfazits in `benchmarkSummary/10_runs.md`–`50_runs.md`, Feedback in `feedback/`  
**Methodik:** Mediane aus Einzelruns; Navigationsaktionen = klassische Repository-Suchen (`rawCounts.searches`) + ImpactLens-Befehle (`rawCounts.impactLensCommands`); geöffnete Dateien = eindeutige Read-/Open-Pfade ohne Benchmark-Infrastruktur (`.cursor/`, `impactlens/`, Skill-/Benchmark-Dateien, `package.json` u. ä.); Edits zählen nicht als Opens; Git-Baseline, Environment-Setup und Cleanup zählen nicht als Navigation.

Formel für relative Änderungen: `(WITHOUT − WITH) / WITHOUT × 100`.

---

## Gesamtfazit nach allen Benchmark-Läufen

| Größe | Wert |
| ----- | ---- |
| Analysierte Tickets | **5** |
| Runs gesamt (primäre Auswertung) | **50** |
| WITH ImpactLens | **25** |
| WITHOUT ImpactLens | **25** |
| Abgeschlossene Runs (`status: completed`) | **50 / 50** |
| Runs mit Datenqualitäts-Einschränkungen | **11** (siehe Anhang) |
| Zusätzliche fullIsoCode-WITH-Runs außerhalb der primären 50 | **2** (im Rohanhang, nicht in Ticket-Medianen) |

**Kurzfazit:** ImpactLens reduzierte in allen fünf Tickets die klassischen Repository-Suchen und die Zahl geöffneter Repository-Dateien. Die gesamten Navigationsaktionen sanken in vier von fünf Tickets; in einem Ticket blieb die Navigationsanzahl gleich (Suchen wurden durch ImpactLens-Befehle ersetzt). Die Completion Rate war in beiden Bedingungen 100 %. Eine konsistente Laufzeitverbesserung zeigte sich nicht: nur ein Ticket war mit ImpactLens schneller, eines praktisch gleich, drei langsamer.

---

## Ergebnisse pro Ticket

Mediane. Navigationsmetriken für Multiview-WITHOUT ohne den Run mit unvollständiger Telemetrie (`933aad21`, 0 Events trotz geänderter Dateien).

| Ticket | Runs | Dauer WITH | Dauer WITHOUT | Laufzeitvergleich | Dateien WITH | Dateien WITHOUT | Datei-Reduktion | Suchen WITH | Suchen WITHOUT | Such-Reduktion | Navigation WITH | Navigation WITHOUT | Navigationsvergleich | Completion |
| ------ | ---: | ---------: | ------------: | ----------------- | -----------: | --------------: | --------------- | ----------: | -------------: | -------------- | --------------: | -----------------: | -------------------- | ---------- |
| UTR – CMS Toggle Download videos | 5/5 | 198 s | 230 s | 14 % schneller | 17 | 22 | 23 % weniger | 9 | 17 | 47 % weniger | 13 | 17 | 24 % weniger | 5/5 vs 5/5 |
| TICKET-16945 – fullIsoCode | 5/5 | 371 s | 222 s | 67 % langsamer | 10 | 16 | 38 % weniger | 3 | 9 | 67 % weniger | 6 | 9 | 33 % weniger | 5/5 vs 5/5 |
| [B] Image duplicates (CMS) | 5/5 | 190 s | 189 s | kein Unterschied | 6 | 14 | 57 % weniger | 4 | 8 | 50 % weniger | 6 | 8 | 25 % weniger | 5/5 vs 5/5 |
| [API] Related contents / Cat3 | 5/5 | 300 s | 182 s | 65 % langsamer | 9 | 11 | 18 % weniger | 6 | 10 | 40 % weniger | 8 | 10 | 20 % weniger | 5/5 vs 5/5 |
| [API] Multiview / userCountry | 5/5 | 306 s | 245 s | 25 % langsamer | 14 | 16,5 | 15 % weniger | 4 | 7 | 43 % weniger | 7 | 7 | kein Unterschied | 5/5 vs 5/5 |

### Sensitivitätsanalyse Laufzeit (ergänzend, nicht primär)

| Ticket | Anpassung | Dauer WITH | Dauer WITHOUT | Vergleich |
| ------ | --------- | ---------: | ------------: | --------- |
| fullIsoCode | ohne gestörten WITH-Run 521 s (`a7f3c2e8`) | 340,5 s | 222 s | 53 % langsamer |
| Related contents / Cat3 | ohne WITH-Run 420 s (`4efcbef2`, EPERM + DB-Umweg) | 279 s | 182 s | 53 % langsamer |
| Multiview | Navigationsmetriken nur mit 4 gültigen WITHOUT-Runs | — | — | siehe Tabelle oben |

Auch nach Ausschluss der Laufzeit-Ausreißer bleiben fullIsoCode und Cat3 mit ImpactLens deutlich langsamer. Es gibt keinen Beleg für einen systematischen Laufzeitvorteil.

---

## Ticket-spezifische Erkenntnisse

### UTR – CMS Toggle for Download videos by User

* **Stärkster messbarer Vorteil:** weniger Navigation und Kontext (Mediane: −47 % klassische Suchen, −23 % geöffnete Dateien, −24 % Navigationsaktionen) bei gleichzeitig **14 % kürzerer** Mediandauer.
* **Laufzeit:** einziger Ticket mit klarem Laufzeitvorteil für WITH.
* **Completion:** 5/5 vs 5/5.
* **Erster relevanter Einstieg:** in 4/5 Feedback-Einträgen als hilfreich bewertet; `find` auf `PlayerSetting` / `DownloadUrl` lieferte CMS- und FE-Einstiege vor breitem Grep.
* **Fallback-Suche:** in allen WITH-Runs nötig (Preview-Proxy-Route, Middleware, Feldverdrahtung).
* **Graph-Limits:** fehlende Route-/Call-Kanten für `DownloadUrlController`; `contents/preview` und `download_videos` nicht im Graph.
* **Störungen:** PHPUnit lokal oft durch fehlende Redis-Extension blockiert (beide Bedingungen); ein WITH-Run mit Sandbox/EPERM-Rauschen bei ImpactLens. Navigationstelemetrie bleibt nutzbar; Laufzeit enthält ggf. Test-Umwege, ohne klaren Einzel-Ausreißer wie bei fullIsoCode/Cat3.
* **Root Cause:** alle 10 Runs konvergierten auf dieselbe Ursache (Toggle hinter `apiSetting.download_url`, direkte S3-URLs, fehlendes Player-Setting + Proxy).

### TICKET-16945 – CMS-driven fullIsoCode

* **Stärkster messbarer Vorteil:** −67 % klassische Suchen und −33 % Navigationsaktionen; −38 % geöffnete Dateien (infra-bereinigt).
* **Laufzeit:** WITH deutlich langsamer (371 s vs 222 s; ohne 521-s-Run weiterhin 53 % langsamer).
* **Completion:** 5/5 vs 5/5.
* **Erster Einstieg:** gemischt (Feedback: 2× hilfreich, 3× nicht / Route-Find ohne Treffer); wenn `find` traf, oft `SettingController` / Settings-Pfad.
* **Fallback-Suche:** in allen WITH-Runs erforderlich.
* **Graph-Limits:** Route-Kind-Queries auf `GET /api/v3/config/settings` oft ohne Treffer.
* **Störungen:** erster WITH-Run 521 s technisch gestört; Feature-Tests mehrfach durch fehlende Redis/DB blockiert. Zwei weitere WITH-Runs existieren außerhalb der primären 50 und sind nur im Anhang.
* **Root Cause:** alle Runs auf fehlendes CMS-konfigurierbares BCP-47-`fullIsoCode` an `base_config_languages` / Settings-API.

### [B] Image duplicates after CMS image update

* **Stärkster messbarer Vorteil:** −57 % geöffnete Dateien (stärkste Dateireduktion aller Tickets); −50 % Suchen; −25 % Navigation.
* **Laufzeit:** praktisch identisch (190 s vs 189 s).
* **Completion:** 5/5 vs 5/5.
* **Erster Einstieg:** gemischt; bei erfolgreichem Graph-Zugriff oft Nähe zu Editorial-/Content-Pfaden, aber Route-Finds unzuverlässig.
* **Fallback-Suche:** immer; in mehreren Runs war ImpactLens wegen EPERM/`tsx`-IPC zeitweise unbrauchbar.
* **Graph-Limits:** V3-Editorial-Persistenzpfad und `GET /api/v3/contents/{id}` nicht zuverlässig indexiert.
* **Störungen:** 4/5 WITH-Runs mit Sandbox/EPERM; ein WITH-Run startete mit dirty Worktree (Reset verworfen). Navigationstelemetrie dennoch vorhanden und in der Auswertung behalten.
* **Root Cause:** alle 10 Runs auf `EditorialService` / `removeImageFormRecording` nur für Recording-Content → verwaiste Pivot-Zeilen bei CMS-Updates.

### [API] Related contents / Cat3 matching

* **Stärkster messbarer Vorteil:** −40 % klassische Suchen; moderate Reduktion bei Dateien (−18 %) und Navigation (−20 %).
* **Laufzeit:** WITH deutlich langsamer (300 s vs 182 s; ohne 420-s-Run weiterhin 53 % langsamer).
* **Completion:** 5/5 vs 5/5 – aber **fachliche Semantik nicht voll identisch** (teilweise „Cat3 allein reicht“, teilweise „Cat3 nur in derselben Cat1-Hierarchie“). Navigationsmetriken nutzbar; Qualitätsgleichheit der Implementierungen nicht behauptet.
* **Erster Einstieg:** Feedback durchgängig hilfreich für Route/Controller; Query-Root-Cause danach per Grep.
* **Fallback-Suche:** immer nötig bis `BaseConfigEventContentRelatedQuery::applyRelatedContentCriteria`.
* **Graph-Limits:** Related-Query und Cat3-Kriterien nicht direkt über `ai-context`/`trace` erreichbar.
* **Störungen:** EPERM/Sandbox in 2 WITH-Runs; ein Run mit lokalem DB-Ausfall und Podman-Umweg (420 s).
* **Root Cause (Richtung):** alle Runs landen in derselben Query-Methode; Detail der Cat3-OR-Semantik divergiert.

### [API] Multiview country-restricted content

* **Stärkster messbarer Vorteil:** −43 % klassische Suchen; −15 % Dateien; Navigation **unverändert** (ImpactLens ersetzt Suchen, reduziert die Schrittzahl nicht).
* **Laufzeit:** WITH langsamer (306 s vs 245 s).
* **Completion:** 5/5 vs 5/5.
* **Erster Einstieg:** Feedback 5/5 hilfreich; Controller-/Keyword-Find oft vor Query-Details.
* **Fallback-Suche:** nötig für `LegacyMultiviewContentQuery` / `MetadataMultiviewContentQuery` und Geo-Join.
* **Graph-Limits:** exakte Multiview-Route und Trace auf Controller-Methoden oft ohne Kanten; Flow zu Query-Klassen unvollständig.
* **Störungen:** WITHOUT-Run `933aad21` ohne brauchbare Navigationstelemetrie (0 Events, trotzdem 6 geänderte Dateien) – nur Dauer/Completion verwendet. WITHOUT-Run `d38b6b38` mit dirty initial Worktree (Reset während Baseline).
* **Root Cause:** alle 10 Runs auf dieselben zwei Kernprobleme (Legacy ohne `userCountry`; Metadata-Join auf `event_contents.id` statt `base_config_event_contents.id`).

---

## Gesamtvergleich

### Ticket-Ebene (5 Ticket-Mediane, nicht gemittelte Prozentwerte als Primärergebnis)

| Metrik | Typisches Ergebnis über die Tickets | Interpretation |
| ---------------------- | ----------------------------------- | -------------- |
| Gesamtdauer | 1 Ticket schneller, 1 praktisch gleich, 3 langsamer; Spanne ca. +14 % bis −67 %; Median der Ticket-%: ca. **25 % langsamer** | Weniger Navigation ≠ kürzere Laufzeit |
| Geöffnete Dateien | **5/5 Tickets** weniger; Spanne ca. 15–57 % weniger; Median der Ticket-%: ca. **23 % weniger** | Stabiler Kontextvorteil |
| Klassische Suchvorgänge | **5/5 Tickets** weniger; Spanne ca. 40–67 % weniger; Median der Ticket-%: ca. **47 % weniger** | Stärkstes und konsistentestes Signal |
| Navigationsaktionen | **4/5** weniger, **1/5** unverändert; Spanne 0–33 % weniger; Median der Ticket-%: ca. **24 % weniger** | Oft Ersatz klassischer Suchen durch Graph-Befehle |
| Completion Rate | **50/50** completed | Kein Completion-Nachteil |
| Root-Cause-Konvergenz | 4/5 Tickets volle Konvergenz; Cat3 gleiche Klasse, abweichende Match-Semantik | Navigation messbar; fachliche Gleichheit ticketabhängig |

Der **Median der Ticket-Prozentwerte** ist nur eine sekundäre Zusammenfassung und ersetzt nicht die Ticket-Tabelle oder die gepoolte Run-Auswertung.

### Gepoolte Run-Ebene (alle 25 WITH vs 25 WITHOUT; Navigation ohne unvollständigen Multiview-WITHOUT-Run)

| Metrik | Median WITH | Median WITHOUT | Vergleich |
| ---------------------- | ----------: | -------------: | --------- |
| Gesamtdauer | 280 s | 221 s | 27 % langsamer |
| Geöffnete Dateien | 9 | 15,5 | 42 % weniger |
| Klassische Suchvorgänge | 4 | 8,5 | 53 % weniger |
| Navigationsaktionen | 7 | 8,5 | 18 % weniger |

Die gepoolte Betrachtung mischt unterschiedliche Tickets und ist **nicht** dasselbe wie ein Ticket-Vergleich. Sie bestätigt Richtung und Größenordnung der Navigations-/Kontexteffekte und den fehlenden Laufzeitvorteil.

---

## Cross-ticket interpretation

1. **Klassische Suchen:** Ja – in allen fünf Tickets niedrigerer Median WITH.
2. **Geöffnete Dateien:** Ja – in allen fünf Tickets niedrigerer Median WITH.
3. **Gesamtnavigation:** Überwiegend Reduktion (4/5); bei Multiview vor allem **Ersatz** klassischer Suchen durch ImpactLens-Befehle bei gleicher Navigationsanzahl.
4. **Laufzeit:** Nein – reduzierte Navigation übersetzt sich nicht konsistent in kürzere Dauer; nur UTR zeigt einen klaren Zeitvorteil.
5. **Nützlichste Tickettypen:** CMS-/Service-Bugs mit klarem Symbol-/Controller-Anker (Image Duplicates, UTR Download) und API-Tickets, bei denen Route/Controller im Graph liegen (Multiview, Cat3-Einstieg). Am schwächsten, wenn die Root Cause tief in Query-Buildern liegt und Route-Finds scheitern (fullIsoCode-Routen, Cat3-Query).
6. **Fallback durch Graph-Lücken:** praktisch überall – fehlende HTTP-Route-Kanten, fehlende Trace-Kanten zu Query-/Service-Klassen, Sandbox/EPERM bei CLI-Aufrufen.
7. **Marketing-Reife:** Für vorsichtige Aussagen zu **weniger Suche / weniger geöffnetem Repository-Kontext** bei gleicher Completion: ja, mit Einschränkungen. Für „schneller“ oder „besserer Code“: nein.
8. **Unterstützte vs. irreführende Claims:** siehe nächste Abschnitte.

---

## Supported claims

Geeignet für README / Benchmark-Seite (konservativ):

* ImpactLens reduzierte die Zahl **klassischer Repository-Suchen** in **5 von 5** ausgewerteten Tickets (Ticket-Mediane; Spanne ca. 40–67 % weniger).
* ImpactLens reduzierte die Zahl **geöffneter Repository-Dateien** in **5 von 5** Tickets (Spanne ca. 15–57 % weniger; Infrastrukturdateien nicht mitgezählt).
* ImpactLens reduzierte die **gesamten Navigationsaktionen** in **4 von 5** Tickets; in 1 Ticket blieb die Anzahl gleich.
* In **allen 50** primären Runs wurde das Ticket als completed markiert (WITH und WITHOUT).
* In **4 von 5** Tickets konvergierten WITH- und WITHOUT-Runs auf dieselbe Root-Cause-Region; beim Cat3-Ticket lag die Implementierung in derselben Query-Methode, die Match-Semantik war jedoch nicht einheitlich.
* **Navigationsreduktion führte nicht konsistent zu kürzerer Gesamtdauer.** Nur 1 Ticket war mit ImpactLens schneller; 3 waren langsamer.

Nicht gestützt / irreführend:

* „ImpactLens macht Agenten durchgängig schneller.“
* „Weniger geöffnete Dateien = weniger LLM-Tokens.“
* „ImpactLens schreibt besseren Code.“
* Eine einzelne Gesamtprozentzahl als Durchschnitt der Ticket-Prozente ohne Kennzeichnung.

---

## Limitations

* Nur **5 Tickets**, jeweils **10 Runs** – kleine Stichprobe.
* Wiederholte Runs im **selben Repository** (`benchmark-monorepo`) und oft derselben Branch/Base-Commit – Generalisierung auf andere Codebases unklar.
* Modell-, Prompt- und Cache-/Warm-up-Effekte nicht kontrolliert.
* Sandbox-/EPERM-Störungen, fehlende Redis-Extension, Podman/DB-Umwege und dirty Worktrees in mehreren Runs.
* Ein WITHOUT-Run ohne Navigationstelemetrie; zwei zusätzliche fullIsoCode-WITH-Runs nicht in der primären 50er-Auswertung.
* **Keine direkte Token-Messung.**
* Ticketformulierung und vorgegebene Anker (API-Pfade, Klassennamen) beeinflussen Navigation stark.
* Cat3: Completion ≠ identische fachliche Lösung.
* Ergebnisse gelten für Repository-Navigation und -Kontext, nicht für Codequalität.

---

## Final conclusion

**Was ImpactLens bisher gezeigt hat:** Unter den gemessenen Bedingungen hilft ImpactLens Agenten, mit **weniger klassischer Repository-Suche** und **weniger geöffneten Repository-Dateien** dieselben Tickets abzuschließen. Die Gesamtnavigation sinkt häufig, manchmal werden Suchen aber nur durch Graph-Befehle ersetzt.

**Was es nicht gezeigt hat:** einen zuverlässigen **Laufzeitvorteil**, eine Token-Ersparnis oder bessere Codequalität. In drei von fünf Tickets war WITH sogar klar langsamer.

**Weiter Richtung 50 Runs?** Die 50 primären Runs sind erreicht. Für belastbarere öffentliche Claims braucht es vor allem **mehr unterschiedliche Tickets/Repos**, stabilere ImpactLens-Ausführung (Sandbox/EPERM) und bessere Graph-Abdeckung von Routes/Query-Flows – nicht nur weitere Wiederholungen derselben fünf Tickets.

**Verbesserungen an ImpactLens aus dem Benchmark:**

1. Zuverlässige CLI-Ausführung ohne Sandbox/EPERM-Brüche.
2. Bessere Indexierung von HTTP-Routes und Controller→Service/Query-Kanten.
3. Weniger Notwendigkeit für sofortigen Grep-Fallback nach dem ersten `find`.
4. Klarere Telemetrie und Validierung unvollständiger Event-Logs.
5. Ticket-Semantik in Benchmarks vorab fixieren (Lehrstück Cat3).

---

## Anhang A – Runs mit Datenqualitäts-Einschränkungen

Keine stillschweigende Entfernung. Primäre Laufzeit- und Completion-Werte behalten die Runs, sofern nicht anders vermerkt. Navigationsausschlüsse nur bei unbrauchbarer Telemetrie.

| Ticket | Run-ID (kurz) | Bedingung | Problem | Nutzbar | Ausschließen / anpassen |
| ------ | ------------- | --------- | ------- | ------- | ----------------------- |
| UTR | `8a4f2c1d` | WITH | Sandbox/EPERM bei ImpactLens | Dauer, Completion, Navigation (mit Rauschen) | Kein Ausschluss; Wirkung von ImpactLens abgeschwächt |
| fullIsoCode | `a7f3c2e8` | WITH | Technisch gestörte Command-Ausführung, 521 s | Navigation, Completion | Sensitivität: Laufzeit ohne diesen Run |
| Image | `4bc92165` | WITH | Dirty Worktree, Reset zu Beginn | Dauer, Navigation, Completion | Baseline-Aufwand in Dauer enthalten |
| Image | `7f3a9c2e` (12:58) | WITH | EPERM/Sandbox | wie oben | Kein Ausschluss |
| Image | `7f3a9c2e` (13:04) | WITH | EPERM/Sandbox | wie oben | Kein Ausschluss |
| Image | `2bdb4b77` | WITH | EPERM/Sandbox | wie oben | Kein Ausschluss |
| Image | `4f552c08` | WITH | EPERM/Sandbox; Test-DB zeitweise unavailable | wie oben | Kein Ausschluss |
| Cat3 | `4efcbef2` | WITH | EPERM + lokale DB nicht erreichbar, Podman-Umweg, 420 s | Navigation, Completion | Sensitivität: Laufzeit ohne diesen Run |
| Cat3 | `f1d04c51` | WITH | EPERM/Sandbox; `ai-context`-Retry blockiert | Navigation, Completion | Kein Ausschluss |
| Multiview | `d38b6b38` | WITHOUT | Dirty Worktree, Reset während Baseline | Dauer, Navigation, Completion | Laufzeit vorsichtig interpretieren |
| Multiview | `933aad21` | WITHOUT | Unvollständige Telemetrie (0 Events, 0 Suchen, 0 Dateien, aber Dateiänderungen) | Dauer, Completion | **Nicht** für Dateien/Suchen/Navigation |

Zusätzlich (breit, beide Bedingungen): fehlende Redis-PHP-Extension / lokale Test-DB blockierte PHPUnit häufig; Validierung oft nur teilweise oder via Podman. Das betrifft vor allem Test-Completion vor Ort, nicht die Navigationszählung.

---

## Anhang B – Rohmediane der Einzelruns (primäre 50)

### UTR Download-Toggle

| Bedingung | Dauer (s) | Dateien | Suchen | ImpactLens | Navigation |
| --------- | --------- | ------: | -----: | ---------: | ---------: |
| WITH | 257, 180, 281, 169, 198 | 17, 17, 28, 14, 22 | 9, 8, 20, 8, 11 | 3, 6, 5, 4, 2 | 12, 14, 25, 12, 13 |
| WITHOUT | 230, 221, 252, 242, 227 | 22, 22, 16, 17, 24 | 17, 18, 10, 5, 25 | 0 | 17, 18, 10, 5, 25 |
| **Median** | **198 / 230** | **17 / 22** | **9 / 17** | — | **13 / 17** |

### fullIsoCode (erste 5 WITH chronologisch)

| Bedingung | Dauer (s) | Dateien | Suchen | ImpactLens | Navigation |
| --------- | --------- | ------: | -----: | ---------: | ---------: |
| WITH | 521, 295, 422, 371, 310 | 7, 21, 3, 16, 10 | 3, 5, 2, 4, 3 | 3, 1, 1, 2, 3 | 6, 6, 3, 6, 6 |
| WITHOUT | 222, 202, 220, 340, 266 | 20, 10, 16, 27, 8 | 17, 9, 3, 22, 5 | 0 | 17, 9, 3, 22, 5 |
| **Median** | **371 / 222** | **10 / 16** | **3 / 9** | — | **6 / 9** |

Nicht in primärer Auswertung: zusätzliche WITH-Runs `7c4e9a2b` (218 s), `da521878` (274 s).

### Image duplicates

| Bedingung | Dauer (s) | Dateien | Suchen | ImpactLens | Navigation |
| --------- | --------- | ------: | -----: | ---------: | ---------: |
| WITH | 266, 169, 184, 190, 250 | 4, 5, 6, 8, 6 | 2, 4, 7, 4, 4 | 2, 1, 3, 4, 2 | 4, 5, 10, 8, 6 |
| WITHOUT | 154, 430, 192, 139, 189 | 18, 9, 14, 16, 1 | 16, 3, 8, 8, 2 | 0 | 16, 3, 8, 8, 2 |
| **Median** | **190 / 189** | **6 / 14** | **4 / 8** | — | **6 / 8** |

### Related contents / Cat3

| Bedingung | Dauer (s) | Dateien | Suchen | ImpactLens | Navigation |
| --------- | --------- | ------: | -----: | ---------: | ---------: |
| WITH | 182, 420, 258, 302, 300 | 9, 8, 9, 9, 13 | 3, 6, 3, 6, 10 | 2, 2, 1, 2, 2 | 5, 8, 4, 8, 12 |
| WITHOUT | 123, 209, 275, 179, 182 | 12, 11, 7, 13, 11 | 10, 12, 3, 11, 6 | 0 | 10, 12, 3, 11, 6 |
| **Median** | **300 / 182** | **9 / 11** | **6 / 10** | — | **8 / 10** |

### Multiview / userCountry

| Bedingung | Dauer (s) | Dateien | Suchen | ImpactLens | Navigation |
| --------- | --------- | ------: | -----: | ---------: | ---------: |
| WITH | 367, 280, 241, 306, 398 | 7, 14, 3, 20, 14 | 2, 4, 2, 9, 4 | 2, 4, 3, 6, 3 | 4, 8, 5, 15, 7 |
| WITHOUT (nav-gültig) | 358, 245, 291, 145 | 13, 18, 20, 15 | 7, 9, 7, 3 | 0 | 7, 9, 7, 3 |
| WITHOUT `933aad21` | 167 | Telemetrie unbrauchbar | — | — | ausgeschlossen |
| **Median** | **306 / 245** | **14 / 16,5** | **4 / 7** | — | **7 / 7** |

---

## Anhang C – Verifikation ausgewählter Prozentwerte

| Ticket | Metrik | Rechnung | Gerundet |
| ------ | ------ | -------- | -------- |
| UTR Dauer | (230−198)/230 | 13,91 % | 14 % schneller |
| UTR Dateien | (22−17)/22 | 22,73 % | 23 % weniger |
| UTR Suchen | (17−9)/17 | 47,06 % | 47 % weniger |
| UTR Navigation | (17−13)/17 | 23,53 % | 24 % weniger |
| fullIsoCode Dauer | (222−371)/222 | −67,12 % | 67 % langsamer |
| fullIsoCode Suchen | (9−3)/9 | 66,67 % | 67 % weniger |
| Image Dauer | (189−190)/189 | −0,53 % | kein Unterschied |
| Image Dateien | (14−6)/14 | 57,14 % | 57 % weniger |
| Cat3 Dauer | (182−300)/182 | −64,84 % | 65 % langsamer |
| Multiview Dateien | (16,5−14)/16,5 | 15,15 % | 15 % weniger |
| Multiview Navigation | (7−7)/7 | 0 % | kein Unterschied |
| Gepoolt Dauer | (221−280)/221 | −26,70 % | 27 % langsamer |
| Gepoolt Suchen | (8,5−4)/8,5 | 52,94 % | 53 % weniger |

Abweichungen zu einzelnen Zwischenfazit-Dateien (z. B. fullIsoCode-Dateien 12 vs 10) entstehen durch die hier verbindliche **Infrastruktur-Bereinigung** der Open-Pfade; Such- und Navigationsmediane stimmen mit den Zwischenfazits im Wesentlichen überein.
