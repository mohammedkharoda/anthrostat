// ---------------------------------------------------------------------------
// account.js — LIVE account limits from Anthropic.
//
// Reads the OAuth token Claude Code already stored in ~/.claude/.credentials.json
// and makes one minimal authenticated request to api.anthropic.com. The real
// 5-hour and 7-day limit utilisation come back as `anthropic-ratelimit-unified-*`
// response headers (the same numbers Claude Code shows).
//
// - The token is read fresh each poll, so when Claude Code refreshes it, we pick
//   up the new one automatically.
// - Results are cached for `liveTtlSeconds` so we hit the API sparingly.
// - A small sample history is persisted to compute a real weekly burn rate.
// - The token is never logged and only ever sent to api.anthropic.com.
// ---------------------------------------------------------------------------

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const cfg = require("./config");
const settings = require("./settings");

const CRED = path.join(cfg.claudeDir, ".credentials.json");
const STATE_DIR = path.join(os.homedir(), ".anthrostat");
const STATE_FILE = path.join(STATE_DIR, "state.json");

// Public OAuth client id Claude Code uses; refresh endpoint on console.anthropic.com.
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

let _cache = null; // { fetchedAt, data }

function readToken() {
  const c = JSON.parse(fs.readFileSync(CRED, "utf8"));
  const o = c.claudeAiOauth || c;
  return { token: o.accessToken, expiresAt: o.expiresAt, refreshToken: o.refreshToken };
}

// Is the stored access token expired (or about to be)?
function tokenStatus() {
  try {
    const t = readToken();
    if (!t.token) return { present: false, expired: true };
    const expired = t.expiresAt ? t.expiresAt <= Date.now() + 30000 : false;
    return { present: true, expired, expiresAt: t.expiresAt, canRefresh: !!t.refreshToken };
  } catch {
    return { present: false, expired: true };
  }
}

// Refresh the access token using the stored refresh token, then write the new
// tokens back to .credentials.json (with a backup). Claude Code reads the same
// file fresh, so both stay in sync.
function refreshAccessToken() {
  return new Promise((resolve) => {
    let creds, o;
    try {
      creds = JSON.parse(fs.readFileSync(CRED, "utf8"));
      o = creds.claudeAiOauth || creds;
    } catch {
      return resolve({ ok: false, error: "no-credentials" });
    }
    if (!o.refreshToken) return resolve({ ok: false, error: "no-refresh-token" });

    const body = JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: o.refreshToken,
      client_id: CLIENT_ID,
    });
    const req = https.request(
      {
        hostname: "console.anthropic.com",
        path: "/v1/oauth/token",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          if (res.statusCode !== 200)
            return resolve({ ok: false, error: "refresh-failed", status: res.statusCode });
          let j;
          try {
            j = JSON.parse(d);
          } catch {
            return resolve({ ok: false, error: "bad-response" });
          }
          if (!j.access_token) return resolve({ ok: false, error: "no-access-token" });
          try {
            o.accessToken = j.access_token;
            if (j.refresh_token) o.refreshToken = j.refresh_token;
            if (j.expires_in) o.expiresAt = Date.now() + j.expires_in * 1000;
            if (creds.claudeAiOauth) creds.claudeAiOauth = o;
            try {
              fs.copyFileSync(CRED, CRED + ".anthrostat.bak");
            } catch {
              /* backup best-effort */
            }
            const tmp = CRED + ".tmp";
            fs.writeFileSync(tmp, JSON.stringify(creds, null, 2));
            fs.renameSync(tmp, CRED);
          } catch {
            return resolve({ ok: false, error: "write-failed" });
          }
          resolve({ ok: true, expiresAt: o.expiresAt });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.code || "network" }));
    req.write(body);
    req.end();
  });
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { samples: [] };
  }
}

function saveState(s) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s));
  } catch {
    /* best-effort */
  }
}

function requestHeaders(now) {
  return new Promise((resolve) => {
    let token;
    try {
      token = readToken().token;
    } catch (e) {
      return resolve({ ok: false, error: "no-credentials" });
    }
    if (!token) return resolve({ ok: false, error: "no-token" });

    const body = JSON.stringify({
      model: settings.get("apiModel"),
      max_tokens: 1,
      system: [
        { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      ],
      messages: [{ role: "user", content: "." }],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          authorization: "Bearer " + token,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "claude-cli/2.1.217",
        },
        timeout: 8000,
      },
      (res) => {
        const h = res.headers;
        res.on("data", () => {});
        res.on("end", () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            return resolve({ ok: false, error: "auth", status: res.statusCode });
          }
          const num = (k) => {
            const v = h[k];
            return v == null ? null : Number(v);
          };
          const s5 = h["anthropic-ratelimit-unified-5h-status"];
          if (s5 == null && h["anthropic-ratelimit-unified-status"] == null) {
            return resolve({ ok: false, error: "no-headers", status: res.statusCode });
          }
          resolve({
            ok: true,
            status: res.statusCode,
            overallStatus: h["anthropic-ratelimit-unified-status"] || null,
            session: {
              utilization: num("anthropic-ratelimit-unified-5h-utilization"),
              resetSec: num("anthropic-ratelimit-unified-5h-reset"),
              status: h["anthropic-ratelimit-unified-5h-status"] || null,
            },
            weekly: {
              utilization: num("anthropic-ratelimit-unified-7d-utilization"),
              resetSec: num("anthropic-ratelimit-unified-7d-reset"),
              status: h["anthropic-ratelimit-unified-7d-status"] || null,
            },
            overage: {
              status: h["anthropic-ratelimit-unified-overage-status"] || null,
              reason: h["anthropic-ratelimit-unified-overage-disabled-reason"] || null,
            },
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "timeout" });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.code || "network" }));
    req.write(body);
    req.end();
  });
}

// Compute a real weekly burn rate (%/hr) and trend from the persisted samples.
function analyseTrend(state, weeklyPct, now) {
  const samples = state.samples || [];
  const dayAgo = now - 24 * 3600 * 1000;
  const recent = samples.filter((s) => s.t >= dayAgo);
  let burnPctPerHr = 0;
  if (recent.length >= 2) {
    const a = recent[0];
    const b = recent[recent.length - 1];
    const hrs = (b.t - a.t) / 3600000;
    if (hrs > 0.05) burnPctPerHr = Math.max(0, (b.w7 - a.w7) / hrs);
  }
  // Trend: compare the two halves of the recent window.
  let trend = "Steady";
  if (recent.length >= 4) {
    const mid = recent[Math.floor(recent.length / 2)];
    const first = recent[0];
    const last = recent[recent.length - 1];
    const r1 = (mid.w7 - first.w7) / Math.max(0.05, (mid.t - first.t) / 3600000);
    const r2 = (last.w7 - mid.w7) / Math.max(0.05, (last.t - mid.t) / 3600000);
    if (r2 > r1 * 1.15 + 0.01) trend = "Increasing";
    else if (r2 < r1 * 0.85 - 0.01) trend = "Decreasing";
  } else if (burnPctPerHr > 0) {
    trend = "Increasing";
  }
  return { burnPctPerHr, trend };
}

async function getLiveLimits() {
  const now = Date.now();
  const ttl = (settings.get("liveTtlSeconds") || 180) * 1000;
  if (_cache && now - _cache.fetchedAt < ttl) return _cache.data;

  const r = await requestHeaders(now);
  if (!r.ok) {
    // Keep serving the last good sample (marked stale) if we have one.
    if (_cache) return { ..._cache.data, stale: true, error: r.error };
    return { ok: false, error: r.error };
  }

  // Persist a sample for burn-rate math.
  const state = loadState();
  state.samples = (state.samples || []).filter(
    (s) => s.t >= now - 8 * 24 * 3600 * 1000
  );
  state.samples.push({
    t: now,
    w5: r.session.utilization,
    w7: r.weekly.utilization,
  });
  state.overage = r.overage; // remember for offline / estimate mode
  saveState(state);

  const { burnPctPerHr, trend } = analyseTrend(
    state,
    (r.weekly.utilization || 0) * 100,
    now
  );

  const data = { ...r, ok: true, fetchedAt: now, burnPctPerHr, trend };
  _cache = { fetchedAt: now, data };
  return data;
}

function getLastOverage() {
  const s = loadState();
  return s.overage || null;
}

// Force an immediate live fetch, ignoring the TTL cache.
async function forceRefresh() {
  _cache = null;
  return getLiveLimits();
}

// "Reconnect": retry live; if the token is dead, refresh it and retry.
async function reconnect() {
  _cache = null;
  let live = await getLiveLimits();
  if (live.ok && !live.stale) return { ok: true, refreshed: false };

  const status = tokenStatus();
  if (!status.canRefresh) {
    return { ok: false, error: "no-refresh-token", needsClaudeCode: true };
  }
  const r = await refreshAccessToken();
  if (!r.ok) {
    return { ok: false, error: r.error, needsClaudeCode: true };
  }
  _cache = null;
  live = await getLiveLimits();
  return { ok: live.ok, refreshed: true, error: live.ok ? null : live.error };
}

module.exports = {
  getLiveLimits,
  getLastOverage,
  forceRefresh,
  reconnect,
  tokenStatus,
};
