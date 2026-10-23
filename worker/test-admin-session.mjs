import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./src/index.js", import.meta.url), "utf8");
const { default: worker } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

class FakeDB {
  sessions = new Map();
  prepare(sql) {
    const db = this;
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async run() {
        if (/INSERT INTO admin_sessions/i.test(sql)) {
          db.sessions.set(args[0], { token_hash: args[0], expires_at: args[1], created_at: args[2] });
        } else if (/DELETE FROM admin_sessions/i.test(sql)) {
          db.sessions.delete(args[0]);
        }
        return { meta: { changes: 1 } };
      },
      async first() {
        if (/SELECT expires_at FROM admin_sessions/i.test(sql)) return db.sessions.get(args[0]) || null;
        return null;
      },
      async all() {
        if (/research_drafts WHERE status = 'pending'/i.test(sql)) return { results: [] };
        return { results: [] };
      }
    };
    return statement;
  }
}

const env = { DB: new FakeDB(), ADMIN_TOKEN: "test-admin-token" };
const call = (path, { method = "GET", token, body } = {}) => worker.fetch(new Request("https://unit.test" + path, {
  method,
  headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined
}), env);

test("Login gibt eine Sitzung mit 60 Minuten Laufzeit aus", async () => {
  const before = Math.floor(Date.now() / 1000);
  const response = await call("/api/admin/session-login", { method: "POST", body: { token: env.ADMIN_TOKEN } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.token);
  assert.ok(data.expiresAt >= before + 3600 && data.expiresAt <= Math.floor(Date.now() / 1000) + 3600);
  globalThis.testSessionToken = data.token;
});

test("Master-Token allein gewährt keinen Zugriff auf geschützte Admin-Routen", async () => {
  const response = await call("/api/admin/drafts", { token: env.ADMIN_TOKEN });
  assert.equal(response.status, 401);
});

test("Gültige Sitzung darf Admin-Entwürfe laden", async () => {
  const response = await call("/api/admin/drafts", { token: globalThis.testSessionToken });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { drafts: [] });
});

test("Abmelden widerruft die Sitzung serverseitig", async () => {
  const response = await call("/api/admin/session-logout", { method: "POST", token: globalThis.testSessionToken, body: {} });
  assert.equal(response.status, 200);
  const afterLogout = await call("/api/admin/drafts", { token: globalThis.testSessionToken });
  assert.equal(afterLogout.status, 401);
});

test("Abgelaufene Sitzung wird abgewiesen", async () => {
  const login = await call("/api/admin/session-login", { method: "POST", body: { token: env.ADMIN_TOKEN } });
  const data = await login.json();
  const { default: crypto } = await import("node:crypto").catch(() => ({ default: null }));
  const bytes = new TextEncoder().encode(data.token);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
  env.DB.sessions.get(digest).expires_at = Math.floor(Date.now() / 1000) - 1;
  const response = await call("/api/admin/drafts", { token: data.token });
  assert.equal(response.status, 401);
});
