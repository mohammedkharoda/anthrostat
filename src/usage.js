// ---------------------------------------------------------------------------
// usage.js — reads real Claude Code usage from ~/.claude/projects/**/*.jsonl.
//
// Pure Node, runs in the Electron main process. Returns aggregated raw stats;
// data.js turns those into the shape the UI renders.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const cfg = require("./config");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// ----- log discovery + parsing ---------------------------------------------

function listLogFiles() {
  const root = path.join(cfg.claudeDir, "projects");
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  }
  walk(root);
  return out;
}

// Signature of the logs (paths + size + mtime) so we can cache between refreshes.
function logsSignature(files) {
  return files
    .map((f) => {
      try {
        const s = fs.statSync(f);
        return `${f}:${s.size}:${s.mtimeMs}`;
      } catch {
        return f + ":0";
      }
    })
    .join("|");
}

function priceFor(model) {
  return cfg.pricing[model] || cfg.pricing.default;
}

// Cost in USD for one usage object.
function costOf(model, u) {
  const p = priceFor(model);
  const cc = u.cache_creation || {};
  const write1h = cc.ephemeral_1h_input_tokens || 0;
  const write5m =
    cc.ephemeral_5m_input_tokens != null
      ? cc.ephemeral_5m_input_tokens
      : Math.max(0, (u.cache_creation_input_tokens || 0) - write1h);
  const tok =
    (u.input_tokens || 0) * p.in +
    (u.output_tokens || 0) * p.out +
    (u.cache_read_input_tokens || 0) * p.cacheRead +
    write5m * p.cacheWrite5m +
    write1h * p.cacheWrite1h;
  return tok / 1_000_000;
}

// Billable token weight (excludes cache reads, which are cheap) for % meters.
function weightOf(u) {
  return (
    (u.input_tokens || 0) +
    (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    Math.round((u.cache_read_input_tokens || 0) * 0.1)
  );
}

// Returns a flat, time-sorted array of usage events: {ts, model, tokens, cost}.
function readEvents() {
  const files = listLogFiles();
  const events = [];
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.includes('"usage"')) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      const msg = d.message;
      const u = msg && msg.usage;
      if (!u || !d.timestamp) continue;
      const ts = Date.parse(d.timestamp);
      if (Number.isNaN(ts)) continue;
      events.push({
        ts,
        model: msg.model || "default",
        tokens: weightOf(u),
        cost: costOf(msg.model || "default", u),
      });
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  return { events, signature: logsSignature(files) };
}

// ----- 5-hour session blocks (ccusage-style) -------------------------------

function buildBlocks(events, now) {
  const win = cfg.sessionWindowHours * HOUR;
  const blocks = [];
  let cur = null;
  for (const e of events) {
    if (
      !cur ||
      e.ts - cur.start >= win ||
      e.ts - cur.lastTs > win // long idle gap starts a fresh block
    ) {
      const startHour = Math.floor(e.ts / HOUR) * HOUR; // round down to the hour
      cur = { start: startHour, lastTs: e.ts, tokens: 0, cost: 0 };
      blocks.push(cur);
    }
    cur.lastTs = e.ts;
    cur.tokens += e.tokens;
    cur.cost += e.cost;
  }
  const active =
    cur && now - cur.lastTs < win ? cur : null;
  return { blocks, active };
}

// ----- daily aggregation ----------------------------------------------------

function localDayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function byDay(events) {
  const m = new Map();
  for (const e of events) {
    const k = localDayKey(e.ts);
    const cur = m.get(k) || { tokens: 0, cost: 0 };
    cur.tokens += e.tokens;
    cur.cost += e.cost;
    m.set(k, cur);
  }
  return m;
}

// ----- weekly reset math ----------------------------------------------------

function lastWeeklyReset(now) {
  const d = new Date(now);
  const back = (d.getDay() - cfg.resetWeekday + 7) % 7;
  d.setDate(d.getDate() - back);
  d.setHours(cfg.resetHour, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 7);
  return d.getTime();
}

function nextWeeklyReset(now) {
  return lastWeeklyReset(now) + 7 * DAY;
}

module.exports = {
  readEvents,
  buildBlocks,
  byDay,
  localDayKey,
  lastWeeklyReset,
  nextWeeklyReset,
  HOUR,
  DAY,
};
