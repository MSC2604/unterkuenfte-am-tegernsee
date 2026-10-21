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
- Optionale Filter: `q`, `town`, `type`.
- `GET /api/admin/drafts`: listet offene Entwürfe mit Bearer-Token.
- `POST /api/admin/drafts`: speichert einen Suchentwurf mit Bearer-Token.
- `POST /api/admin/drafts/:id/approve`: veröffentlicht einen geprüften Entwurf.
- `POST /api/admin/drafts/:id/reject`: verwirft einen Entwurf.

## Was noch nicht fertig ist
Die automatische Websuche ist **noch nicht integriert**. Es gibt noch keine fertige Admin-Oberfläche für die gefundenen Daten. Der nächste Entwicklungsschritt nach erfolgreichem Datenbanktest ist eine Suche mit öffentlich verfügbaren Quellen, die Ergebnisse als Entwurf speichert und vor der Freigabe prüfbar macht.

Preise dürfen nur mit nachvollziehbarer Quelle gespeichert werden. Nicht auffindbare Preise müssen als „Preis auf Anfrage“ markiert werden; keine Preise erfinden. Suchergebnisse dürfen nicht ohne Prüfung automatisch veröffentlicht werden.

## Sicherheit und Kosten
- Vor der produktiven Nutzung die CORS-Freigabe auf die tatsächliche Website beschränken.
- `ADMIN_TOKEN` bleibt ausschließlich serverseitig.
- Vor der Wahl eines Suchanbieters dessen kostenlose Grenzen und Bedingungen prüfen; keine kostenpflichtige Nutzung ohne ausdrückliche Entscheidung.
