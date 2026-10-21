# Datenmodell – Unterkünfte am Tegernsee

Diese Datei gehört ausschließlich zur Unterkunfts-App. Sie ist unabhängig von
`tegernsee-lieblinge` und dessen Worker/Datenbank.

## Tabellen

- `accommodations`: Unterkunftsstammdaten; `published = 1` erst nach Freigabe.
- `price_offers`: Preisangaben mit Einheit, Saison/Zeitraum, Mindestnächten,
  Zusatzkosten, Quelle und Recherchedatum. Wenn kein öffentlicher Preis existiert,
  wird `price_on_request = 1` gespeichert statt einen Betrag zu erfinden.
- `research_drafts`: unbearbeitete Web-Suchergebnisse. Diese bleiben Entwürfe,
  bis der Betreiber sie prüft und ausdrücklich freigibt.

## Geplanter Ablauf

1. Betreiber gibt Unterkunftsname oder Suchbegriff ein.
2. Server sucht öffentlich verfügbare Informationen und Preise.
3. Ergebnisse werden mit Quellenlinks und Recherchedatum als Entwurf angezeigt.
4. Betreiber prüft/korrigiert Felder und wählt explizit „Übernehmen und veröffentlichen“.
5. Nur freigegebene Unterkünfte erscheinen auf der öffentlichen Startseite.
6. Gäste senden Anfragen direkt an den Vermieter; keine Zahlungen, kein Checkout,
   keine Provision und keine automatische Buchungsbestätigung.

## Preisregeln

Preise werden in der vom Anbieter angegebenen Form erfasst: pro Nacht, pro Aufenthalt,
saisonal oder abhängig von konkreten Daten. Gültigkeitszeitraum, Mindestaufenthalt
und öffentlich angegebene Zusatzkosten werden soweit verfügbar gespeichert.
Quelle und Recherchedatum sind erforderlich. Suchtreffer sind nicht automatisch
eine Bestätigung der Verfügbarkeit oder eines verbindlichen Preises.

## Nächster technischer Schritt

Das SQL-Schema muss in einer **neuen, separaten Cloudflare-D1-Datenbank** ausgeführt
und an einen **neuen Unterkunfts-Worker** gebunden werden. Noch nicht bereitgestellt:
Backend, Suchanbieter-Anbindung, Admin-Login und Live-Speicherung. Bis dahin darf die
öffentliche Seite keine erfundenen Angebote oder Testdaten anzeigen.
