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
function adminAuthorized(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}
function id() {
  return crypto.randomUUID();
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
        const { results } = await env.DB.prepare(
          `SELECT a.id, a.name, a.town, a.address, a.type, a.description,
                  a.website_url, a.contact_email, a.contact_phone, a.booking_url,
                  a.updated_at
             FROM accommodations a
            WHERE a.published = 1
              AND (? = '' OR lower(a.name) LIKE lower(?) OR lower(coalesce(a.description, '')) LIKE lower(?))
              AND (? = '' OR lower(coalesce(a.town, '')) = lower(?))
              AND (? = '' OR lower(coalesce(a.type, '')) = lower(?))
            ORDER BY a.name COLLATE NOCASE`
        ).bind(q, `%${q}%`, `%${q}%`, town, town, type, type).all();
        // If a valid stay is supplied, retain general offers and offers whose stated dates cover that stay.
        // This is a date relevance filter, not a guarantee of live availability.
        const offers = await env.DB.prepare(
          `SELECT p.id, p.accommodation_id, p.price_amount, p.currency, p.price_unit,
                  p.min_nights, p.season_label, p.valid_from, p.valid_to,
                  p.arrival_date, p.departure_date, p.extra_cleaning_amount,
                  p.tourist_tax_note, p.additional_costs_note, p.price_on_request,
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
        const byAccommodation = new Map();
        for (const offer of offers.results) {
          if (!byAccommodation.has(offer.accommodation_id)) byAccommodation.set(offer.accommodation_id, []);
          byAccommodation.get(offer.accommodation_id).push(offer);
        }
        return json({ accommodations: results.map(a => ({ ...a, prices: byAccommodation.get(a.id) || [] })) });
      } catch {
        return json({ error: "Unterkünfte konnten nicht geladen werden. Datenbank-Schema prüfen." }, 503);
      }
    }

    if (path.startsWith("/api/admin/")) {
      if (!adminAuthorized(request, env)) return json({ error: "Nicht autorisiert." }, 401);
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
        const { results } = await env.DB.prepare(
          "SELECT id, name, town, address, type, description, website_url, contact_email, contact_phone, booking_url FROM accommodations WHERE published = 1 ORDER BY name COLLATE NOCASE"
        ).all();
        const { results: offers } = await env.DB.prepare(
          "SELECT id, accommodation_id, price_amount, currency, price_unit, min_nights, season_label, valid_from, valid_to, arrival_date, departure_date, extra_cleaning_amount, tourist_tax_note, additional_costs_note, price_on_request, source_url, source_name FROM price_offers ORDER BY researched_at DESC"
        ).all();
        const byAccommodation = new Map();
        for (const offer of offers) {
          if (!byAccommodation.has(offer.accommodation_id)) byAccommodation.set(offer.accommodation_id, []);
          byAccommodation.get(offer.accommodation_id).push(offer);
        }
        return json({ accommodations: results.map(a => ({ ...a, prices: byAccommodation.get(a.id) || [] })) });
      }
      if (request.method === "POST" && /^\\/api\\/admin\\/accommodations\\/[^/]+\\/update$/.test(path)) {
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
        const batch = [
          env.DB.prepare(
            "UPDATE accommodations SET name = ?, town = ?, address = ?, type = ?, description = ?, website_url = ?, contact_email = ?, contact_phone = ?, booking_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND published = 1"
          ).bind(p.name.trim().slice(0, 300), str("town"), str("address"), str("type"), str("description"), str("website_url"), str("contact_email"), str("contact_phone"), str("booking_url"), accommodationId)
        ];
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
          const sourceUrl = /^https?:\\/\\//i.test(sourceUrlInput) ? sourceUrlInput : (oldOffer?.source_url || "");
          if (!sourceUrl || !/^https?:\\/\\//i.test(sourceUrl)) {
            if (oldOffer) retainedIds.add(oldOffer.id);
            continue;
          }
          const amount = Number.isFinite(Number(price.price_amount)) && price.price_amount !== null && price.price_amount !== "" ? Number(price.price_amount) : null;
          const cleaning = Number.isFinite(Number(price.extra_cleaning_amount)) && price.extra_cleaning_amount !== null && price.extra_cleaning_amount !== "" ? Number(price.extra_cleaning_amount) : null;
          const minNights = Number.isInteger(Number(price.min_nights)) && price.min_nights !== null && price.min_nights !== "" ? Number(price.min_nights) : null;
          const values = [
            amount,
            typeof price.price_unit === "string" ? price.price_unit.slice(0, 100) : null,
            minNights,
            typeof price.season_label === "string" ? price.season_label.slice(0, 200) : null,
            typeof price.valid_from === "string" && price.valid_from ? price.valid_from : null,
            typeof price.valid_to === "string" && price.valid_to ? price.valid_to : null,
            typeof price.arrival_date === "string" && price.arrival_date ? price.arrival_date : null,
            typeof price.departure_date === "string" && price.departure_date ? price.departure_date : null,
            cleaning,
            typeof price.tourist_tax_note === "string" ? price.tourist_tax_note.slice(0, 1000) : null,
            typeof price.additional_costs_note === "string" ? price.additional_costs_note.slice(0, 1000) : null,
            price.price_on_request ? 1 : 0,
            sourceUrl.slice(0, 2000),
            (typeof price.source_name === "string" && price.source_name.trim() ? price.source_name.trim() : oldOffer?.source_name || "").slice(0, 300)
          ];
          if (oldOffer) {
            retainedIds.add(oldOffer.id);
            batch.push(env.DB.prepare(
              "UPDATE price_offers SET price_amount = ?, currency = 'EUR', price_unit = ?, min_nights = ?, season_label = ?, valid_from = ?, valid_to = ?, arrival_date = ?, departure_date = ?, extra_cleaning_amount = ?, tourist_tax_note = ?, additional_costs_note = ?, price_on_request = ?, source_url = ?, source_name = ? WHERE id = ? AND accommodation_id = ?"
            ).bind(...values, oldOffer.id, accommodationId));
          } else {
            const newId = id();
            batch.push(env.DB.prepare(
              `INSERT INTO price_offers
               (id, accommodation_id, price_amount, currency, price_unit, min_nights, season_label, valid_from, valid_to, arrival_date, departure_date, extra_cleaning_amount, tourist_tax_note, additional_costs_note, price_on_request, source_url, source_name)
               VALUES (?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(newId, accommodationId, ...values));
            retainedIds.add(newId);
          }
        }
        for (const oldOffer of existingOffers.results) {
          if (!retainedIds.has(oldOffer.id)) {
            batch.push(env.DB.prepare("DELETE FROM price_offers WHERE id = ? AND accommodation_id = ?").bind(oldOffer.id, accommodationId));
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
        await env.DB.batch([
          env.DB.prepare("DELETE FROM price_offers WHERE accommodation_id = ?").bind(accommodationId),
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
        const batch = [
          env.DB.prepare(
            `INSERT INTO accommodations (id, name, town, address, type, description, website_url, contact_email, contact_phone, booking_url, published)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          ).bind(accommodationId, payload.name.slice(0, 300), ...values)
        ];
        const prices = Array.isArray(payload.prices) ? payload.prices.slice(0, 30) : [];
        for (const price of prices) {
          const sourceUrl = typeof price.source_url === "string" ? price.source_url : null;
          if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) continue;
          const amount = Number.isFinite(Number(price.price_amount)) && price.price_amount !== null && price.price_amount !== "" ? Number(price.price_amount) : null;
          batch.push(env.DB.prepare(
            `INSERT INTO price_offers
             (id, accommodation_id, price_amount, currency, price_unit, min_nights, season_label, valid_from, valid_to, arrival_date, departure_date, extra_cleaning_amount, tourist_tax_note, additional_costs_note, price_on_request, source_url, source_name)
             VALUES (?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(id(), accommodationId, amount,
            typeof price.price_unit === "string" ? price.price_unit.slice(0, 100) : null,
            Number.isInteger(price.min_nights) ? price.min_nights : null,
            typeof price.season_label === "string" ? price.season_label.slice(0, 200) : null,
            typeof price.valid_from === "string" ? price.valid_from : null,
            typeof price.valid_to === "string" ? price.valid_to : null,
            typeof price.arrival_date === "string" ? price.arrival_date : null,
            typeof price.departure_date === "string" ? price.departure_date : null,
            Number.isFinite(Number(price.extra_cleaning_amount)) && price.extra_cleaning_amount !== null && price.extra_cleaning_amount !== "" ? Number(price.extra_cleaning_amount) : null,
            typeof price.tourist_tax_note === "string" ? price.tourist_tax_note.slice(0, 1000) : null,
            typeof price.additional_costs_note === "string" ? price.additional_costs_note.slice(0, 1000) : null,
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
