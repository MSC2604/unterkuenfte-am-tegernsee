import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
// Deployment trigger: no application logic or data changes.
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
async function adminAuthorized(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = env.ADMIN_TOKEN;
  if (token && auth === `Bearer ${token}`) return true;
  const sessionToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!sessionToken) return false;
  await ensurePasskeyTables(env);
  const tokenHash = await hashToken(sessionToken);
  const session = await env.DB.prepare("SELECT token_hash FROM passkey_sessions WHERE token_hash = ? AND expires_at > datetime('now')").bind(tokenHash).first();
  return !!session;
}
const PASSKEY_RP_ID = "msc2604.github.io";
const PASSKEY_ORIGIN = "https://msc2604.github.io";
async function hashToken(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
}
async function ensurePasskeyTables(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS passkey_credentials (credential_id TEXT PRIMARY KEY, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports_json TEXT NOT NULL DEFAULT '[]', device_type TEXT, backed_up INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS passkey_challenges (challenge_id TEXT PRIMARY KEY, challenge TEXT NOT NULL, purpose TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS passkey_sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
  ]);
}
async function saveChallenge(env, purpose, challenge) {
  const challengeId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO passkey_challenges (challenge_id, challenge, purpose, expires_at) VALUES (?, ?, ?, datetime('now','+5 minutes'))").bind(challengeId, challenge, purpose).run();
  return challengeId;
}
async function takeChallenge(env, challengeId, purpose) {
  const row = await env.DB.prepare("SELECT challenge FROM passkey_challenges WHERE challenge_id = ? AND purpose = ? AND expires_at > datetime('now')").bind(challengeId, purpose).first();
  await env.DB.prepare("DELETE FROM passkey_challenges WHERE challenge_id = ?").bind(challengeId).run();
  return row?.challenge || null;
}
function id() {
  return crypto.randomUUID();
}
async function ensureAccommodationImageTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS accommodation_images (accommodation_id TEXT PRIMARY KEY, image_data TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();
}
function safeAccommodationImage(value) {
  return typeof value === "string" && /^data:image\/(jpeg|webp|png);base64,/i.test(value) && value.length <= 260000 ? value : "";
}
async function ensureOccupancyColumn(env) {
  const { results } = await env.DB.prepare("PRAGMA table_info(price_offers)").all();
  if (!results.some(column => column.name === "occupancy")) {
    await env.DB.prepare("ALTER TABLE price_offers ADD COLUMN occupancy INTEGER").run();
  }
}
async function ensurePriceDisplayNoteColumn(env) {
  const { results } = await env.DB.prepare("PRAGMA table_info(price_offers)").all();
  if (!results.some(column => column.name === "price_display_note")) {
    await env.DB.prepare("ALTER TABLE price_offers ADD COLUMN price_display_note TEXT").run();
  }
}
async function ensureUnitDescriptionColumn(env) {
  const { results } = await env.DB.prepare("PRAGMA table_info(price_offers)").all();
  if (!results.some(column => column.name === "unit_description")) {
    await env.DB.prepare("ALTER TABLE price_offers ADD COLUMN unit_description TEXT").run();
  }
}
async function ensureShowPriceAbColumn(env) {
  const { results } = await env.DB.prepare("PRAGMA table_info(price_offers)").all();
  if (!results.some(column => column.name === "show_price_ab")) {
    await env.DB.prepare("ALTER TABLE price_offers ADD COLUMN show_price_ab INTEGER NOT NULL DEFAULT 1").run();
  }
}
async function ensureGalleryTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS price_offer_galleries (
    price_offer_id TEXT PRIMARY KEY,
    accommodation_id TEXT NOT NULL,
    images_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`).run();
}
function safeGalleryImages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).filter(x => typeof x === "string" && /^data:image\/(jpeg|webp|png);base64,/i.test(x) && x.length <= 260000).map(x => x);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "GET" && path === "/api/health") {
      try {
        await env.DB.prepare("SELECT 1").first();
        return json({ ok: true, service: "unterkuenfte-am-tegernsee-api", database: true });
      } catch {
        return json({ ok: false, database: false, error: "Datenbank nicht erreichbar oder nicht eingerichtet." }, 503);
      }
    }

    if (request.method === "GET" && path === "/api/accommodations") {
      try {
        // Optional filters for the public accommodation search. Values are bound, never interpolated into SQL.
        const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
        const town = (url.searchParams.get("town") || "").trim().slice(0, 100);
        const type = (url.searchParams.get("type") || "").trim().slice(0, 80);
        const arrival = (url.searchParams.get("arrival") || "").trim();
        const departure = (url.searchParams.get("departure") || "").trim();
        const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
        const hasValidStay = validDate(arrival) && validDate(departure) && departure > arrival;
        await ensureAccommodationImageTable(env);
        const { results } = await env.DB.prepare(
          `SELECT a.id, a.name, a.town, a.address, a.type, a.description,
                  a.website_url, a.contact_email, a.contact_phone, a.booking_url,
                  a.updated_at, ai.image_data AS image_url
             FROM accommodations a
             LEFT JOIN accommodation_images ai ON ai.accommodation_id = a.id
            WHERE a.published = 1
              AND (? = '' OR lower(a.name) LIKE lower(?) OR lower(coalesce(a.description, '')) LIKE lower(?))
              AND (? = '' OR lower(coalesce(a.town, '')) = lower(?))
              AND (? = '' OR lower(coalesce(a.type, '')) = lower(?))
            ORDER BY a.name COLLATE NOCASE`
        ).bind(q, `%${q}%`, `%${q}%`, town, town, type, type).all();
        // If a valid stay is supplied, retain general offers and offers whose stated dates cover that stay.
        // This is a date relevance filter, not a guarantee of live availability.
        await ensureGalleryTable(env);
        await ensureOccupancyColumn(env);
        await ensurePriceDisplayNoteColumn(env);
        await ensureUnitDescriptionColumn(env);
        await ensureShowPriceAbColumn(env);
        const offers = await env.DB.prepare(
          `SELECT p.id, p.accommodation_id, p.price_amount, p.currency, p.price_unit,
                  p.min_nights, p.season_label, p.occupancy, p.valid_from, p.valid_to,
                  p.arrival_date, p.departure_date, p.extra_cleaning_amount,
                  p.tourist_tax_note, p.additional_costs_note, p.price_display_note, p.unit_description, p.show_price_ab, p.price_on_request,
                  p.source_url, p.source_name, p.researched_at
             FROM price_offers p
             JOIN accommodations a ON a.id = p.accommodation_id
            WHERE a.published = 1
              AND (
                ? = 0
                OR (
                  p.arrival_date IS NULL AND p.departure_date IS NULL
                  AND p.valid_from IS NULL AND p.valid_to IS NULL
                )
                OR (
                  p.arrival_date IS NOT NULL AND p.departure_date IS NOT NULL
                  AND p.arrival_date = ? AND p.departure_date = ?
                )
                OR (
                  p.valid_from IS NOT NULL AND p.valid_to IS NOT NULL
                  AND p.valid_from <= ? AND p.valid_to >= ?
                )
              )
            ORDER BY p.researched_at DESC`
        ).bind(hasValidStay ? 1 : 0, arrival, departure, arrival, departure).all();
        const { results: galleries } = await env.DB.prepare("SELECT price_offer_id, images_json FROM price_offer_galleries").all();
        const galleryByOffer = new Map();
        for (const gallery of galleries) { try { galleryByOffer.set(gallery.price_offer_id, JSON.parse(gallery.images_json || "[]")); } catch {} }
        const byAccommodation = new Map();
        for (const offer of offers.results) {
          offer.gallery_images = galleryByOffer.get(offer.id) || [];
          if (!byAccommodation.has(offer.accommodation_id)) byAccommodation.set(offer.accommodation_id, []);
          byAccommodation.get(offer.accommodation_id).push(offer);
        }
        return json({ accommodations: results.map(a => ({ ...a, prices: byAccommodation.get(a.id) || [] })) });
      } catch {
        return json({ error: "Unterkünfte konnten nicht geladen werden. Datenbank-Schema prüfen." }, 503);
      }
    }

    // Passkey authentication endpoints. These only affect the new passkey tables.
    if (request.method === "POST" && path === "/api/passkey/login-options") {
      try {
        await ensurePasskeyTables(env);
        const { results } = await env.DB.prepare("SELECT credential_id, transports_json FROM passkey_credentials").all();
        if (!results.length) return json({ error: "Noch kein Passkey eingerichtet. Bitte zuerst mit Admin-Token verbinden und einen Passkey registrieren." }, 409);
        const options = await generateAuthenticationOptions({
          rpID: PASSKEY_RP_ID,
          allowCredentials: results.map(c => ({ id: c.credential_id, transports: JSON.parse(c.transports_json || "[]") })),
          userVerification: "required"
        });
        const challengeId = await saveChallenge(env, "login", options.challenge);
        return json({ ...options, challengeId });
      } catch (e) { return json({ error: "Passkey-Anmeldung konnte nicht vorbereitet werden." }, 500); }
    }

    if (request.method === "POST" && path === "/api/passkey/login-verify") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Ungültiges JSON." }, 400); }
      try {
        await ensurePasskeyTables(env);
        const challenge = await takeChallenge(env, String(body.challengeId || ""), "login");
        if (!challenge) return json({ error: "Anmeldeversuch abgelaufen. Bitte erneut versuchen." }, 400);
        const credentialId = body.response?.id;
        const stored = await env.DB.prepare("SELECT * FROM passkey_credentials WHERE credential_id = ?").bind(credentialId).first();
        if (!stored) return json({ error: "Dieser Passkey ist nicht registriert." }, 401);
        const verification = await verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: PASSKEY_ORIGIN,
          expectedRPID: PASSKEY_RP_ID,
          requireUserVerification: true,
          credential: {
            id: stored.credential_id,
            publicKey: Uint8Array.from(atob(stored.public_key), c => c.charCodeAt(0)),
            counter: stored.counter,
            transports: JSON.parse(stored.transports_json || "[]")
          }
        });
        if (!verification.verified) return json({ error: "Passkey konnte nicht bestätigt werden." }, 401);
        const info = verification.authenticationInfo;
        await env.DB.prepare("UPDATE passkey_credentials SET counter = ? WHERE credential_id = ?").bind(info.newCounter, stored.credential_id).run();
        const sessionToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,"0")).join("");
        const tokenHash = await hashToken(sessionToken);
        await env.DB.prepare("INSERT INTO passkey_sessions (token_hash, expires_at) VALUES (?, datetime('now','+12 hours'))").bind(tokenHash).run();
        return json({ verified: true, token: sessionToken, expiresIn: 43200 });
      } catch (e) { return json({ error: "Passkey-Prüfung fehlgeschlagen. Bitte erneut anmelden." }, 401); }
    }

    if (request.method === "POST" && path === "/api/admin/passkey/register-options") {
      if (!(await adminAuthorized(request, env))) return json({ error: "Bitte zuerst mit dem Admin-Token anmelden." }, 401);
      try {
        await ensurePasskeyTables(env);
        const { results } = await env.DB.prepare("SELECT credential_id, transports_json FROM passkey_credentials").all();
        const options = await generateRegistrationOptions({
          rpName: "Unterkünfte am Tegernsee – Verwaltung",
          rpID: PASSKEY_RP_ID,
          userName: "Unterkunftsverwaltung",
          userDisplayName: "Unterkünfte am Tegernsee",
          attestationType: "none",
          authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
          excludeCredentials: results.map(c => ({ id: c.credential_id, transports: JSON.parse(c.transports_json || "[]") })),
          supportedAlgorithmIDs: [-7, -257]
        });
        const challengeId = await saveChallenge(env, "register", options.challenge);
        return json({ ...options, challengeId });
      } catch (e) { return json({ error: "Passkey-Registrierung konnte nicht vorbereitet werden." }, 500); }
    }

    if (request.method === "POST" && path === "/api/admin/passkey/register-verify") {
      if (!(await adminAuthorized(request, env))) return json({ error: "Bitte zuerst mit dem Admin-Token anmelden." }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Ungültiges JSON." }, 400); }
      try {
        await ensurePasskeyTables(env);
        const challenge = await takeChallenge(env, String(body.challengeId || ""), "register");
        if (!challenge) return json({ error: "Registrierung abgelaufen. Bitte erneut versuchen." }, 400);
        const verification = await verifyRegistrationResponse({
          response: body.response,
          expectedChallenge: challenge,
          expectedOrigin: PASSKEY_ORIGIN,
          expectedRPID: PASSKEY_RP_ID,
          requireUserVerification: true
        });
        if (!verification.verified || !verification.registrationInfo) return json({ error: "Passkey konnte nicht bestätigt werden." }, 400);
        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
        const publicKey = btoa(String.fromCharCode(...credential.publicKey));
        await env.DB.prepare("INSERT OR REPLACE INTO passkey_credentials (credential_id, public_key, counter, transports_json, device_type, backed_up) VALUES (?, ?, ?, ?, ?, ?)").bind(
          credential.id, publicKey, credential.counter, JSON.stringify(credential.transports || []), credentialDeviceType, credentialBackedUp ? 1 : 0
        ).run();
        return json({ verified: true, message: "Passkey wurde registriert." }, 201);
      } catch (e) { return json({ error: "Passkey-Registrierung fehlgeschlagen. Bitte erneut versuchen." }, 400); }
    }

    if (path.startsWith("/api/admin/")) {
      if (!(await adminAuthorized(request, env))) return json({ error: "Nicht autorisiert." }, 401);
      if (request.method === "POST" && path === "/api/admin/research") {
        if (!env.TAVILY_API_KEY) {
          return json({ error: "Automatische Recherche ist noch nicht eingerichtet. Im Worker fehlt das Secret TAVILY_API_KEY." }, 503);
        }
        let body;
        try { body = await request.json(); } catch { return json({ error: "Ungültiges JSON." }, 400); }
        if (!body || typeof body.query !== "string" || !body.query.trim()) {
          return json({ error: "Bitte einen Unterkunftsnamen oder eine Website als query angeben." }, 400);
        }
        const query = body.query.trim().slice(0, 300);
        let searchResponse;
        try {
          searchResponse = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              api_key: env.TAVILY_API_KEY,
              query: query + " Tegernsee Unterkunft Gastgeber Ferienwohnung Zimmer Apartment Ferienhaus offizielle Website Preise Kontakt",
              search_depth: "basic",
              max_results: 8,
              include_answer: false
            })
          });
        } catch {
          return json({ error: "Der Suchanbieter ist momentan nicht erreichbar. Es wurde nichts gespeichert." }, 502);
        }
        if (!searchResponse.ok) {
          return json({ error: "Die Websuche ist fehlgeschlagen. Bitte Kontingent und API-Schlüssel prüfen.", provider_status: searchResponse.status }, 502);
        }
        let searchData;
        try { searchData = await searchResponse.json(); } catch {
          return json({ error: "Der Suchanbieter hat keine lesbare Antwort geliefert." }, 502);
        }
        const seenUrls = new Set();
        const rawResults = (Array.isArray(searchData.results) ? searchData.results : []).filter(item => {
          if (typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) return false;
          try {
            const u = new URL(item.url);
            u.hash = "";
            for (const key of ["utm_source", "utm_medium", "utm_campaign", "gclid"]) u.searchParams.delete(key);
            const normalized = u.href.replace(/\/$/, "").toLowerCase();
            if (seenUrls.has(normalized)) return false;
            seenUrls.add(normalized);
            return true;
          } catch { return false; }
        });
        const stopTerms = ["ferienwohnung", "ferienwohnungen", "unterkunft", "unterkünfte", "tegernsee", "finden", "suche", "gastgeber", "zimmer", "apartment", "apartments", "ferienhaus", "preise", "kontakt", "offizielle", "website"];
        const terms = query.toLowerCase().split(/[^a-zäöüß0-9]+/i).filter(x => x.length >= 3 && !stopTerms.includes(x));
        const scored = rawResults.map(item => {
          const url = String(item.url || "");
          const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
          const title = String(item.title || "");
          const content = String(item.content || "");
          const titleText = (title + " " + url).toLowerCase();
          const haystack = (title + " " + content + " " + url).toLowerCase();
          const matchedTerms = terms.filter(term => haystack.includes(term));
          const titleMatchCount = terms.filter(term => titleText.includes(term)).length;
          const matchCount = matchedTerms.length;
          const officialTegernsee = host === "tegernsee.com" || host.endsWith(".tegernsee.com");
          const likelyHostSite = !["bayregio.de", "booking.com", "airbnb.de", "tripadvisor.de"].some(domain => host === domain || host.endsWith("." + domain));
          // When a name was provided, matches in the title/URL are stronger evidence than incidental mentions in long snippets.
          const unrelated = terms.length > 0 && titleMatchCount === 0 && matchCount === 0;
          const weakIdentity = terms.length > 0 && titleMatchCount === 0 && matchCount > 0;
          return { item, host, matchCount, titleMatchCount, officialTegernsee, likelyHostSite, unrelated, weakIdentity };
        });
        // Prefer direct name matches. Keep official regional directory entries as reviewable sources,
        // but do not pad a property-specific draft with unrelated nearby accommodation listings.
        const directMatches = scored.filter(x => x.titleMatchCount > 0 || x.officialTegernsee && x.matchCount > 0);
        const relevant = scored.filter(x => !x.unrelated && (!x.weakIdentity || x.officialTegernsee || x.matchCount >= Math.min(2, terms.length)));
        const results = (directMatches.length ? relevant : scored.filter(x => !x.unrelated)).slice(0, 8);
        const sources = results.map(x => x.item.url).slice(0, 8);
        const researchResults = results.map(({ item, host, matchCount, officialTegernsee, likelyHostSite, unrelated }) => ({
          title: typeof item.title === "string" ? item.title.slice(0, 500) : "",
          url: typeof item.url === "string" && /^https?:\/\//i.test(item.url) ? item.url : "",
          content: typeof item.content === "string" ? item.content.slice(0, 1600) : "",
          published_date: typeof item.published_date === "string" ? item.published_date : null,
          source_type: officialTegernsee ? "Tegernsee.com – Gastgeberquelle" : (likelyHostSite ? "Mögliche Gastgeber- oder Buchungsseite" : "Drittanbieter – Zuordnung prüfen"),
          match_count: matchCount,
          needs_identity_check: unrelated
        }));
        const draftId = id();
        const payload = {
          name: query,
          research_status: results.length ? "results_found_needs_review" : "no_results",
          researched_at: new Date().toISOString(),
          prices_verified: false,
          prices_note: "Suchtreffer sind keine bestätigten Preise oder Verfügbarkeiten. Angaben vor Veröffentlichung auf der Originalquelle prüfen.",
          research_results: researchResults
        };
        await env.DB.prepare(
          "INSERT INTO research_drafts (id, query, payload_json, source_urls_json, status) VALUES (?, ?, ?, ?, 'pending')"
        ).bind(draftId, query, JSON.stringify(payload), JSON.stringify(sources)).run();
        return json({
          id: draftId,
          status: "pending",
          results_found: results.length,
          sources,
          message: "Recherche als Entwurf gespeichert. Noch nicht veröffentlicht; Preise und Kontaktdaten müssen anhand der Quellen geprüft werden."
        }, 201);
      }
      if (request.method === "GET" && path === "/api/admin/accommodations") {
        await ensureGalleryTable(env);
        await ensureOccupancyColumn(env);
        await ensurePriceDisplayNoteColumn(env);
        await ensureUnitDescriptionColumn(env);
        await ensureShowPriceAbColumn(env);
        await ensureAccommodationImageTable(env);
        const { results } = await env.DB.prepare(
          "SELECT a.id, a.name, a.town, a.address, a.type, a.description, a.website_url, a.contact_email, a.contact_phone, a.booking_url, ai.image_data AS image_url FROM accommodations a LEFT JOIN accommodation_images ai ON ai.accommodation_id = a.id WHERE a.published = 1 ORDER BY a.name COLLATE NOCASE"
        ).all();
        const { results: offers } = await env.DB.prepare(
          "SELECT id, accommodation_id, price_amount, currency, price_unit, min_nights, season_label, occupancy, valid_from, valid_to, arrival_date, departure_date, extra_cleaning_amount, tourist_tax_note, additional_costs_note, price_display_note, unit_description, show_price_ab, price_on_request, source_url, source_name FROM price_offers ORDER BY researched_at DESC"
        ).all();
        const { results: galleries } = await env.DB.prepare("SELECT price_offer_id, images_json FROM price_offer_galleries").all();
        const galleryByOffer = new Map();
        for (const gallery of galleries) { try { galleryByOffer.set(gallery.price_offer_id, JSON.parse(gallery.images_json || "[]")); } catch {} }
        const byAccommodation = new Map();
        for (const offer of offers) {
          try { offer.gallery_images = galleryByOffer.get(offer.id) || []; } catch { offer.gallery_images = []; }
          if (!byAccommodation.has(offer.accommodation_id)) byAccommodation.set(offer.accommodation_id, []);
          byAccommodation.get(offer.accommodation_id).push(offer);
        }
        return json({ accommodations: results.map(a => ({ ...a, prices: byAccommodation.get(a.id) || [] })) });
      }
      if (request.method === "POST" && /^\/api\/admin\/accommodations\/[^/]+\/update$/.test(path)) {
        await ensureGalleryTable(env);
        const accommodationId = path.split("/")[4];
        let body;
        try { body = await request.json(); } catch { return json({ error: "Ungültiges JSON." }, 400); }
        const p = body?.payload;
        if (!p || typeof p !== "object" || Array.isArray(p) || typeof p.name !== "string" || !p.name.trim()) {
          return json({ error: "Bitte einen Unterkunftsnamen angeben." }, 400);
        }
        const existing = await env.DB.prepare(
          "SELECT id FROM accommodations WHERE id = ? AND published = 1"
        ).bind(accommodationId).first();
        if (!existing) return json({ error: "Veröffentlichte Unterkunft nicht gefunden." }, 404);
        const str = key => typeof p[key] === "string" ? p[key].trim().slice(0, key === "description" ? 5000 : 3000) || null : null;
        await ensureAccommodationImageTable(env);
        const batch = [
          env.DB.prepare(
            "UPDATE accommodations SET name = ?, town = ?, address = ?, type = ?, description = ?, website_url = ?, contact_email = ?, contact_phone = ?, booking_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND published = 1"
          ).bind(p.name.trim().slice(0, 300), str("town"), str("address"), str("type"), str("description"), str("website_url"), str("contact_email"), str("contact_phone"), str("booking_url"), accommodationId)
        ];
        if (typeof p.image_url === "string") {
          const image = safeAccommodationImage(p.image_url);
          if (image) batch.push(env.DB.prepare("INSERT INTO accommodation_images (accommodation_id, image_data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(accommodation_id) DO UPDATE SET image_data = excluded.image_data, updated_at = CURRENT_TIMESTAMP").bind(accommodationId, image));
          else batch.push(env.DB.prepare("DELETE FROM accommodation_images WHERE accommodation_id = ?").bind(accommodationId));
        }
        const existingOffers = await env.DB.prepare(
          "SELECT id, source_url, source_name FROM price_offers WHERE accommodation_id = ?"
        ).bind(accommodationId).all();
        const existingById = new Map(existingOffers.results.map(item => [item.id, item]));
        const prices = Array.isArray(p.prices) ? p.prices.slice(0, 30) : [];
        const retainedIds = new Set();
        for (const price of prices) {
          const submittedId = typeof price.id === "string" ? price.id : "";
          const oldOffer = submittedId ? existingById.get(submittedId) : null;
          if (submittedId && !oldOffer) continue;
          const sourceUrlInput = typeof price.source_url === "string" ? price.source_url.trim() : "";
          const accommodationUrl = typeof p.website_url === "string" && /^https?:\/\//i.test(p.website_url.trim())
            ? p.website_url.trim()
            : (typeof p.booking_url === "string" && /^https?:\/\//i.test(p.booking_url.trim()) ? p.booking_url.trim() : "");
          const sourceUrl = /^https?:\/\//i.test(sourceUrlInput) ? sourceUrlInput : (oldOffer?.source_url || accommodationUrl || "");
          const amount = Number.isFinite(Number(price.price_amount)) && price.price_amount !== null && price.price_amount !== "" ? Number(price.price_amount) : null;
          const cleaning = Number.isFinite(Number(price.extra_cleaning_amount)) && price.extra_cleaning_amount !== null && price.extra_cleaning_amount !== "" ? Number(price.extra_cleaning_amount) : null;
          const minNights = Number.isInteger(Number(price.min_nights)) && price.min_nights !== null && price.min_nights !== "" ? Number(price.min_nights) : null;
          const values = [
            amount,
            typeof price.price_unit === "string" ? price.price_unit.slice(0, 100) : null,
            minNights,
            typeof price.season_label === "string" ? price.season_label.slice(0, 200) : null,
            Number.isInteger(Number(price.occupancy)) && price.occupancy !== null && price.occupancy !== "" ? Number(price.occupancy) : null,
            typeof price.valid_from === "string" && price.valid_from ? price.valid_from : null,
            typeof price.valid_to === "string" && price.valid_to ? price.valid_to : null,
            typeof price.arrival_date === "string" && price.arrival_date ? price.arrival_date : null,
            typeof price.departure_date === "string" && price.departure_date ? price.departure_date : null,
            cleaning,
            typeof price.tourist_tax_note === "string" ? price.tourist_tax_note.slice(0, 1000) : null,
            typeof price.additional_costs_note === "string" ? price.additional_costs_note.slice(0, 1000) : null,
            ["zzgl. Kurtaxe und Endreinigung", "zzgl. Kurtaxe und inkl. Endreinigung"].includes(price.price_display_note) ? price.price_display_note : null,
            typeof price.unit_description === "string" && price.unit_description.trim() ? price.unit_description.trim().slice(0, 5000) : null,
            price.show_price_ab === false || price.show_price_ab === 0 || price.show_price_ab === "0" ? 0 : 1,
            price.price_on_request ? 1 : 0,
            sourceUrl.slice(0, 2000),
            (typeof price.source_name === "string" && price.source_name.trim() ? price.source_name.trim() : oldOffer?.source_name || (sourceUrl ? "Website der Unterkunft" : "Manuelle Eingabe")).slice(0, 300)
          ];
          let targetOfferId;
          if (oldOffer) {
            targetOfferId = oldOffer.id;
            retainedIds.add(oldOffer.id);
            batch.push(env.DB.prepare(
              "UPDATE price_offers SET price_amount = ?, currency = 'EUR', price_unit = ?, min_nights = ?, season_label = ?, occupancy = ?, valid_from = ?, valid_to = ?, arrival_date = ?, departure_date = ?, extra_cleaning_amount = ?, tourist_tax_note = ?, additional_costs_note = ?, price_display_note = ?, unit_description = ?, show_price_ab = ?, price_on_request = ?, source_url = ?, source_name = ? WHERE id = ? AND accommodation_id = ?"
            ).bind(...values, oldOffer.id, accommodationId));
          } else {
            const newId = id();
            targetOfferId = newId;
            batch.push(env.DB.prepare(
              `INSERT INTO price_offers
               (id, accommodation_id, price_amount, currency, price_unit, min_nights, season_label, occupancy, valid_from, valid_to, arrival_date, departure_date, extra_cleaning_amount, tourist_tax_note, additional_costs_note, price_display_note, unit_description, show_price_ab, price_on_request, source_url, source_name)
               VALUES (?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(newId, accommodationId, ...values));
            retainedIds.add(newId);
          }
          const galleryImages = safeGalleryImages(price.gallery_images);
          batch.push(env.DB.prepare(
            "INSERT INTO price_offer_galleries (price_offer_id, accommodation_id, images_json, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(price_offer_id) DO UPDATE SET accommodation_id = excluded.accommodation_id, images_json = excluded.images_json, updated_at = CURRENT_TIMESTAMP"
          ).bind(targetOfferId, accommodationId, JSON.stringify(galleryImages)));
        }
        for (const oldOffer of existingOffers.results) {
          if (!retainedIds.has(oldOffer.id)) {
            batch.push(env.DB.prepare("DELETE FROM price_offers WHERE id = ? AND accommodation_id = ?").bind(oldOffer.id, accommodationId));
            batch.push(env.DB.prepare("DELETE FROM price_offer_galleries WHERE price_offer_id = ? AND accommodation_id = ?").bind(oldOffer.id, accommodationId));
          }
        }
        await env.DB.batch(batch);
        return json({ success: true, message: "Unterkunft und Preisangebote wurden aktualisiert." });
      }
      if (request.method === "POST" && /^\/api\/admin\/accommodations\/[^/]+\/delete$/.test(path)) {
        const accommodationId = path.split("/")[4];
        const existing = await env.DB.prepare(
          "SELECT id, name FROM accommodations WHERE id = ? AND published = 1"
        ).bind(accommodationId).first();
        if (!existing) return json({ error: "Veröffentlichte Unterkunft nicht gefunden." }, 404);
        await ensureAccommodationImageTable(env);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM price_offer_galleries WHERE accommodation_id = ?").bind(accommodationId),
          env.DB.prepare("DELETE FROM price_offers WHERE accommodation_id = ?").bind(accommodationId),
          env.DB.prepare("DELETE FROM accommodation_images WHERE accommodation_id = ?").bind(accommodationId),
          env.DB.prepare("DELETE FROM accommodations WHERE id = ? AND published = 1").bind(accommodationId)
        ]);
        return json({ success: true, deleted_name: existing.name, message: "Unterkunft und zugehörige Preisangebote wurden endgültig gelöscht." });
      }
      if (request.method === "GET" && path === "/api/admin/drafts") {
        const { results } = await env.DB.prepare(
          "SELECT id, query, payload_json, source_urls_json, status, researched_at FROM research_drafts WHERE status = 'pending' ORDER BY researched_at DESC"
        ).all();
        return json({ drafts: results });
      }
      if (request.method === "POST" && path === "/api/admin/drafts") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Ungültiges JSON." }, 400); }
        if (!body || typeof body.query !== "string" || typeof body.payload !== "object" || body.payload === null) {
          return json({ error: "query und payload sind erforderlich." }, 400);
        }
        const draftId = id();
        const sources = Array.isArray(body.source_urls) ? body.source_urls.filter(x => typeof x === "string").slice(0, 30) : [];
        await env.DB.prepare(
          "INSERT INTO research_drafts (id, query, payload_json, source_urls_json, status) VALUES (?, ?, ?, ?, 'pending')"
        ).bind(draftId, body.query.slice(0, 500), JSON.stringify(body.payload), JSON.stringify(sources)).run();
        return json({ id: draftId, status: "pending", message: "Als Entwurf gespeichert; noch nicht veröffentlicht." }, 201);
      }
      if (request.method === "POST" && /^\/api\/admin\/drafts\/[^/]+\/update$/.test(path)) {
        const draftId = path.split("/")[4];
        let body;
        try { body = await request.json(); } catch { return json({ error: "Ungültiges JSON." }, 400); }
        if (!body || typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload)) {
          return json({ error: "Ein gültiges payload-Objekt ist erforderlich." }, 400);
        }
        const existing = await env.DB.prepare(
          "SELECT id FROM research_drafts WHERE id = ? AND status = 'pending'"
        ).bind(draftId).first();
        if (!existing) return json({ error: "Entwurf nicht gefunden oder bereits bearbeitet." }, 404);
        const result = await env.DB.prepare(
          "UPDATE research_drafts SET payload_json = ? WHERE id = ? AND status = 'pending'"
        ).bind(JSON.stringify(body.payload), draftId).run();
        return json({ success: (result.meta?.changes || 0) > 0, message: "Entwurf gespeichert, noch nicht veröffentlicht." });
      }
      if (request.method === "POST" && /^\/api\/admin\/drafts\/[^/]+\/reject$/.test(path)) {
        const draftId = path.split("/")[4];
        const result = await env.DB.prepare(
          "UPDATE research_drafts SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
        ).bind(draftId).run();
        return json({ success: (result.meta?.changes || 0) > 0 });
      }
      if (request.method === "POST" && /^\/api\/admin\/drafts\/[^/]+\/approve$/.test(path)) {
        await ensureOccupancyColumn(env);
        await ensurePriceDisplayNoteColumn(env);
        await ensureUnitDescriptionColumn(env);
        await ensureShowPriceAbColumn(env);
        const draftId = path.split("/")[4];
        const draft = await env.DB.prepare(
          "SELECT id, payload_json, source_urls_json FROM research_drafts WHERE id = ? AND status = 'pending'"
        ).bind(draftId).first();
        if (!draft) return json({ error: "Entwurf nicht gefunden oder bereits bearbeitet." }, 404);
        let payload;
        try { payload = JSON.parse(draft.payload_json); } catch { return json({ error: "Entwurfsdaten sind ungültig." }, 400); }
        if (!payload.name || typeof payload.name !== "string") return json({ error: "Vor Freigabe muss ein Unterkunftsname vorhanden sein." }, 400);
        const accommodationId = id();
        const fields = ["town", "address", "type", "description", "website_url", "contact_email", "contact_phone", "booking_url"];
        const values = fields.map(key => typeof payload[key] === "string" ? payload[key].slice(0, 3000) : null);
        await ensureAccommodationImageTable(env);
        const batch = [
          env.DB.prepare(
            `INSERT INTO accommodations (id, name, town, address, type, description, website_url, contact_email, contact_phone, booking_url, published)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          ).bind(accommodationId, payload.name.slice(0, 300), ...values)
        ];
        const accommodationImage = safeAccommodationImage(payload.image_url);
        if (accommodationImage) batch.push(env.DB.prepare("INSERT INTO accommodation_images (accommodation_id, image_data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").bind(accommodationId, accommodationImage));
        const prices = Array.isArray(payload.prices) ? payload.prices.slice(0, 30) : [];
        for (const price of prices) {
          const sourceUrlInput = typeof price.source_url === "string" ? price.source_url.trim() : "";
          const fallbackUrl = typeof payload.website_url === "string" && /^https?:\/\//i.test(payload.website_url.trim())
            ? payload.website_url.trim()
            : (typeof payload.booking_url === "string" && /^https?:\/\//i.test(payload.booking_url.trim()) ? payload.booking_url.trim() : "");
          const sourceUrl = /^https?:\/\//i.test(sourceUrlInput) ? sourceUrlInput : fallbackUrl;
          const amount = Number.isFinite(Number(price.price_amount)) && price.price_amount !== null && price.price_amount !== "" ? Number(price.price_amount) : null;
          batch.push(env.DB.prepare(
            `INSERT INTO price_offers
             (id, accommodation_id, price_amount, currency, price_unit, min_nights, season_label, occupancy, valid_from, valid_to, arrival_date, departure_date, extra_cleaning_amount, tourist_tax_note, additional_costs_note, price_display_note, unit_description, show_price_ab, price_on_request, source_url, source_name)
             VALUES (?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(id(), accommodationId, amount,
            typeof price.price_unit === "string" ? price.price_unit.slice(0, 100) : null,
            Number.isInteger(price.min_nights) ? price.min_nights : null,
            typeof price.season_label === "string" ? price.season_label.slice(0, 200) : null,
            Number.isInteger(Number(price.occupancy)) && price.occupancy !== null && price.occupancy !== "" ? Number(price.occupancy) : null,
            typeof price.valid_from === "string" ? price.valid_from : null,
            typeof price.valid_to === "string" ? price.valid_to : null,
            typeof price.arrival_date === "string" ? price.arrival_date : null,
            typeof price.departure_date === "string" ? price.departure_date : null,
            Number.isFinite(Number(price.extra_cleaning_amount)) && price.extra_cleaning_amount !== null && price.extra_cleaning_amount !== "" ? Number(price.extra_cleaning_amount) : null,
            typeof price.tourist_tax_note === "string" ? price.tourist_tax_note.slice(0, 1000) : null,
            typeof price.additional_costs_note === "string" ? price.additional_costs_note.slice(0, 1000) : null,
            ["zzgl. Kurtaxe und Endreinigung", "zzgl. Kurtaxe und inkl. Endreinigung"].includes(price.price_display_note) ? price.price_display_note : null,
            price.price_on_request ? 1 : 0, sourceUrl.slice(0, 2000),
            typeof price.source_name === "string" ? price.source_name.slice(0, 300) : null));
        }
        batch.push(env.DB.prepare(
          "UPDATE research_drafts SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
        ).bind(draftId));
        await env.DB.batch(batch);
        return json({ success: true, accommodation_id: accommodationId, prices_saved: prices.length });
      }
    }
    return json({ error: "Nicht gefunden." }, 404);
  }
};
