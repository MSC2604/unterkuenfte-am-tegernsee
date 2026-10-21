# Unterkünfte am Tegernsee

Eine persönliche Übersicht, um Unterkünfte am Tegernsee zu sammeln, Preise für einen Reisezeitraum zu vergleichen und den Vermieter direkt per E-Mail anzufragen.

## Ziel der App
1. Unterkunft einmal mit Name oder Website anlegen.
2. Öffentlich auffindbare Angaben und Preise automatisch recherchieren.
3. Fundstellen mit Quelle und Recherchedatum anzeigen.
4. Anreise und Abreise auswählen und vorhandene Preisangebote vergleichen.
5. Fehlende oder unklare Preise ehrlich als „Preis auf Anfrage“ kennzeichnen.
6. Ergebnisse vor der Veröffentlichung prüfen und korrigieren.
7. Den Vermieter direkt per E-Mail kontaktieren. Keine Buchung und keine Zahlung innerhalb der App.

## Projektstatus
- Website-Grundgerüst vorhanden.
- Cloudflare Worker-Grundgerüst vorhanden.
- Cloudflare-D1-Datenbank ist in `worker/wrangler.toml` eingetragen.
- Datenbankschema liegt in `database/schema.sql`.
- Öffentliche API-Abfrage und geschützte Entwurfs-Endpunkte sind vorbereitet.
- **Noch nicht bestätigt:** Datenbanktabellen eingerichtet, Worker-Bindung korrekt, Worker erfolgreich bereitgestellt.
- **Noch nicht vorhanden:** echte automatische Websuche und fertige Prüfoberfläche für Recherche-Ergebnisse.

## Nächste Schritte
1. Am PC Cloudflare-D1-Bindung und Schema prüfen, ohne bestehende Daten zu löschen.
2. `/api/health` testen.
3. Eine kostenfreie Suchmöglichkeit mit passenden Nutzungsbedingungen auswählen und serverseitig integrieren.
4. Rechercheergebnisse als Entwurf speichern und vor der Veröffentlichung überprüfen.
5. Suche nach Reisedaten und E-Mail-Anfrage verbinden.

## Kostenlos bleiben
Die Umsetzung soll im kostenlosen Rahmen bleiben. Vor der Integration eines Suchanbieters werden dessen Kontingente und Bedingungen geprüft. Es wird keine kostenpflichtige Nutzung aktiviert, ohne dass dies ausdrücklich entschieden wurde.

## Wichtig
Dieses Repository gehört ausschließlich zu „Unterkünfte am Tegernsee“. Die bestehende Restaurant-App und ihr Worker bzw. ihre Datenbank bleiben unangetastet.
