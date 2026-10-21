# Unterkunfts-API – Einrichtung

## Wichtige Trennung
Dieser Worker ist ausschließlich für „Unterkünfte am Tegernsee“. Er darf weder den
Restaurant-Worker `tegernsee-restaurants-api` noch die Datenbank `tegernsee-restaurants`
verwenden.

## Bereits vorbereitet
- `src/index.js`: API-Grundgerüst für öffentliche, freigegebene Unterkünfte,
  geschützte Entwurfsverwaltung und explizite Freigabe/Ablehnung.
- `../database/schema.sql`: Tabellen für Unterkünfte, Preisangebote und Suchentwürfe.
- `wrangler.toml`: Konfiguration mit absichtlichem Platzhalter für die neue D1-ID.

## Noch manuell im Cloudflare-Dashboard erforderlich
1. Eine **neue D1-Datenbank** namens `unterkuenfte-am-tegernsee` erstellen.
2. Den Inhalt von `database/schema.sql` im SQL-Editor dieser neuen Datenbank ausführen.
3. Die neue D1-ID in `wrangler.toml` einsetzen.
4. Einen neuen Worker aus diesem Ordner deployen.
5. Im Worker unter Settings/Variables einen zufälligen, langen Secret-Wert
   `ADMIN_TOKEN` setzen. Diesen Token niemals in GitHub-Dateien eintragen.
6. Endpunkte testen: `/api/health` und `/api/accommodations`.

## API-Grundfunktionen
- `GET /api/health`: prüft, ob D1 erreichbar ist.
- `GET /api/accommodations`: liefert ausschließlich veröffentlichte Unterkünfte.
- `GET /api/admin/drafts`: listet Entwürfe mit Bearer-Token.
- `POST /api/admin/drafts`: speichert einen Suchentwurf mit Bearer-Token.
- `POST /api/admin/drafts/:id/approve`: veröffentlicht nach Prüfung den Entwurf.
- `POST /api/admin/drafts/:id/reject`: lehnt einen Entwurf ab.

## Sicherheits- und Funktionshinweise
Die Admin-API nutzt derzeit einen geheimen Bearer-Token als technische Übergangslösung;
eine richtige Admin-Oberfläche und Anmeldung müssen noch gebaut werden. Der Token darf
nur serverseitig verwahrt werden. Die öffentliche CORS-Konfiguration ist vor produktiver
Nutzung auf die tatsächliche Website einzuschränken.

Die Websuche selbst ist **noch nicht integriert**. Dieser Worker speichert und verwaltet
Entwürfe, aber er erfindet keine Ergebnisse und ruft derzeit keinen Suchanbieter auf.
Als nächstes braucht es einen Suchanbieter mit passendem Tarif/Schlüssel und eine Admin-
Oberfläche, die gefundene Daten vor dem Speichern anzeigt.
