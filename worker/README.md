# Unterkunfts-API – Einrichtung und Test

## Wichtig: getrennt von der Restaurant-App
Dieser Worker gehört ausschließlich zu „Unterkünfte am Tegernsee“.
Nicht den Worker `tegernsee-restaurants-api` und nicht die Datenbank `tegernsee-restaurants` verwenden.

## Bereits vorhanden
- `src/index.js`: API-Grundgerüst für veröffentlichte Unterkünfte, Preisangebote und geschützte Suchentwürfe.
- `../database/schema.sql`: SQL-Schema für die drei Tabellen `accommodations`, `price_offers` und `research_drafts`.
- `wrangler.toml`: verweist bereits auf die vorhandene Cloudflare-D1-Datenbank `unterkuenfte-am-tegernsee` mit der eingetragenen Datenbank-ID.

**Bitte keine zweite Datenbank anlegen und keine Datenbank-ID austauschen**, solange nicht ausdrücklich festgestellt wurde, dass die bestehende Datenbank falsch ist.

## Noch zu prüfen – am besten am Laptop/PC
1. In Cloudflare unter **Workers & Pages** den Worker für die Unterkünfte öffnen.
2. Prüfen, ob die D1-Bindung mit dem Namen `DB` auf die Datenbank `unterkuenfte-am-tegernsee` zeigt.
3. In Cloudflare D1 die vorhandene Datenbank öffnen und prüfen, ob das Schema ausgeführt wurde. Falls Tabellen fehlen, `database/schema.sql` dort ausführen. Vorhandene Daten vorher nicht löschen.
4. Im Worker als Secret `ADMIN_TOKEN` einen langen zufälligen Wert hinterlegen. Diesen Wert niemals in GitHub-Dateien oder öffentliche Webseiten schreiben.
5. Den Worker deployen, falls das noch nicht geschehen ist.
6. Im Browser `/api/health` aufrufen. Erfolg sieht ungefähr so aus: `{"ok":true,"service":"unterkuenfte-am-tegernsee-api","database":true}`.
7. `/api/accommodations` aufrufen. Ohne freigegebene Einträge ist eine leere Liste normal; ein Datenbank-/Schemafehler muss erst behoben werden.

## Vorhandene API-Funktionen
- `GET /api/health`: prüft die Datenbankverbindung.
- `GET /api/accommodations`: liefert nur veröffentlichte Unterkünfte samt Preisangeboten.
  Beispiel für einen Reisezeitraum: `/api/accommodations?town=Kreuth&arrival=2026-12-20&departure=2026-12-27`.
- Optionale Filter: `q`, `town`, `type`, `arrival` und `departure` (Datumsformat `YYYY-MM-DD`).
- Bei gültigem Reisezeitraum werden datumsbezogene Preisangebote gefiltert; allgemeine Angebote ohne Datumsbindung bleiben sichtbar. Das bestätigt keine aktuelle Verfügbarkeit.
- `GET /api/admin/drafts`: listet offene Entwürfe mit Bearer-Token.
- `POST /api/admin/drafts`: speichert einen Suchentwurf mit Bearer-Token.
- `POST /api/admin/research`: sucht über Tavily und speichert maximal fünf Treffer als **ungeprüften Entwurf**; benötigt das Worker-Secret `TAVILY_API_KEY` und den `ADMIN_TOKEN`.
- `POST /api/admin/drafts/:id/update`: speichert bearbeitete Angaben in einem offenen Entwurf, ohne ihn zu veröffentlichen.
- `POST /api/admin/drafts/:id/approve`: veröffentlicht einen geprüften Entwurf.
- `POST /api/admin/drafts/:id/reject`: verwirft einen Entwurf.

## Recherche über Tavily vorbereiten
Der Endpunkt `POST /api/admin/research` ist vorbereitet. Er ruft die Tavily-Suche auf und speichert bis zu fünf Treffer samt URL und kurzem Auszug als offenen Entwurf. Er veröffentlicht nichts automatisch und behandelt Treffer ausdrücklich nicht als bestätigte Preise.

Zum späteren Aktivieren im Cloudflare-Worker die Secrets `ADMIN_TOKEN` und `TAVILY_API_KEY` hinterlegen. Tavily listet aktuell einen kostenlosen Tarif mit 1.000 API-Credits pro Monat ohne Kreditkarte; das Kontingent ist begrenzt. Vor dem Einrichten bitte den aktuellen Tarif direkt prüfen: https://www.tavily.com/pricing. Keine kostenpflichtige Stufe aktivieren. Wenn Credits aufgebraucht sind, soll die Suche ausfallen statt automatisch auf einen bezahlten Tarif zu wechseln.

**Prüfoberfläche:** Im Repository gibt es jetzt `admin.html` für das Laden, Bearbeiten, Speichern, Ablehnen und Freigeben offener Entwürfe. Die Seite erwartet die tatsächliche Worker-Adresse und das Admin-Token als Eingabe; das Token wird nicht in die Datei geschrieben. Unterkunftsdaten und einzelne Preisangebote (Betrag, Einheit, Mindestnächte, Zeitraum, Endreinigung, Kurtaxe, weitere Kosten und Originalquelle) können dort bearbeitet werden. Die Oberfläche und die API sind noch nicht live getestet. Die Datenbank/Worker-Verbindung ist ebenfalls noch unbestätigt. Daher ist die Recherche noch nicht als vollständig nutzbare Funktion anzusehen.

Preise dürfen nur mit nachvollziehbarer Quelle gespeichert werden. Nicht auffindbare Preise müssen als „Preis auf Anfrage“ markiert werden; keine Preise erfinden. Suchergebnisse dürfen nicht ohne Prüfung automatisch veröffentlicht werden.

## Sicherheit und Kosten
- Vor der produktiven Nutzung die CORS-Freigabe auf die tatsächliche Website beschränken.
- `ADMIN_TOKEN` bleibt ausschließlich serverseitig.
- Vor der Wahl eines Suchanbieters dessen kostenlose Grenzen und Bedingungen prüfen; keine kostenpflichtige Nutzung ohne ausdrückliche Entscheidung.
