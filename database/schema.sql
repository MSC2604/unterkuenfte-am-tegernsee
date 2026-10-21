-- Separate Datenbank für „Unterkünfte am Tegernsee“.
-- Keine Verbindung zur Restaurant-App und keine Restaurantdaten.
-- Nur geprüfte Unterkünfte werden in accommodations veröffentlicht.
-- research_drafts hält Suchergebnisse bis zur manuellen Freigabe zurück.

CREATE TABLE IF NOT EXISTS accommodations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  town TEXT,
  address TEXT,
  type TEXT,
  description TEXT,
  website_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  booking_url TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_offers (
  id TEXT PRIMARY KEY,
  accommodation_id TEXT NOT NULL,
  price_amount REAL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  price_unit TEXT,
  min_nights INTEGER,
  season_label TEXT,
  valid_from TEXT,
  valid_to TEXT,
  arrival_date TEXT,
  departure_date TEXT,
  extra_cleaning_amount REAL,
  tourist_tax_note TEXT,
  additional_costs_note TEXT,
  price_on_request INTEGER NOT NULL DEFAULT 0,
  source_url TEXT NOT NULL,
  source_name TEXT,
  researched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (accommodation_id) REFERENCES accommodations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS research_drafts (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  researched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_accommodations_published
  ON accommodations(published, town, type);
CREATE INDEX IF NOT EXISTS idx_price_offers_accommodation
  ON price_offers(accommodation_id, researched_at);
CREATE INDEX IF NOT EXISTS idx_research_drafts_status
  ON research_drafts(status, researched_at);
