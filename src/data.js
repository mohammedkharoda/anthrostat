// ---------------------------------------------------------------------------
// data.js — produces the exact shape the UI renders, from REAL Claude logs.
//
// Token counts, timestamps, streaks, spend and burn rate are read from your
// ~/.claude logs (see usage.js). The only assumptions live in config.js
// (plan limits, reset schedule, pricing) and are clearly labelled there.
//
// If no logs are found, we fall back to representative mock data so the app
// still renders (set by MOCK_FALLBACK).
// ---------------------------------------------------------------------------

const cfg = require("./config");
const U = require("./usage");
const account = require("./account");
const settings = require("./settings");

const MOCK_FALLBACK = true;

// Cache parsed events between refreshes; re-read only when logs change.
let _cache = { signature: null, events: null };

function loadEvents() {
  const { events, signature } = U.readEvents();
  if (signature !== _cache.signature) {
    _cache = { signature, events };
  }
  return _cache.events || events;
}

function round(n) {
  return Math.round(n);
}

function sumTokens(events, fromTs, toTs) {
  let t = 0;
  for (const e of events) if (e.ts >= fromTs && e.ts < toTs) t += e.tokens;
  return t;
}

function peakRollingWeek(events, now) {
  // Largest total tokens in any trailing 7-day window (for auto-calibration).
  if (!events.length) return 0;
  let peak = 0;
  // Evaluate a window ending at each event plus one ending "now".
  const ends = events.map((e) => e.ts).concat([now]);
  for (const end of ends) {
    const start = end - 7 * U.DAY;
    const s = sumTokens(events, start, end + 1);
    if (s > peak) peak = s;
  }
  return peak;
}

function computeReal(now) {
  const events = loadEvents();
  if (!events.length) return null;

  // --- session (current 5-hour block) ---
  const { blocks, active } = U.buildBlocks(events, now);
  const peakBlock = blocks.reduce((m, b) => Math.max(m, b.tokens), 0);
  const sessionLimit = cfg.sessionTokenLimit || Math.max(peakBlock, 1);
  const win = cfg.sessionWindowHours * U.HOUR;
  const sessionTokens = active ? active.tokens : 0;
  const sessionUsedPct = Math.min(100, (sessionTokens / sessionLimit) * 100);
  const sessionRemainingMs = active
    ? Math.max(0, active.start + win - now)
    : win;

  // --- weekly (since last reset) ---
  const lastReset = U.lastWeeklyReset(now);
  const nextReset = U.nextWeeklyReset(now);
  const weekTokens = sumTokens(events, lastReset, now + 1);
  const weeklyLimit =
    cfg.weeklyTokenLimit ||
    Math.max(peakRollingWeek(events, now), weekTokens, 1);
  const weeklyUsedPct = Math.min(100, (weekTokens / weeklyLimit) * 100);

  // --- extra usage / overage (real status; no $ is available from the API) ---
  const extra = overageCard(account.getLastOverage());

  // --- projections / burn rate ---
  const last24 = sumTokens(events, now - U.DAY, now + 1);
  const prev24 = sumTokens(events, now - 2 * U.DAY, now - U.DAY);
  const burnPctPerHr = (last24 / weeklyLimit) * 100 / 24;
  const hoursToReset = (nextReset - now) / U.HOUR;
  const projectedPctAtReset = Math.min(
    100,
    weeklyUsedPct + burnPctPerHr * hoursToReset
  );
  let trend = "Steady";
  if (last24 > prev24 * 1.15) trend = "Increasing";
  else if (last24 < prev24 * 0.85) trend = "Decreasing";

  // --- daily aggregation for streak / heatmap / chart ---
  const days = U.byDay(events);

  // streak: consecutive days with usage ending today or yesterday.
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(U.localDayKey(now))) cursor.setDate(cursor.getDate() - 1); // allow "yesterday" anchor
  while (days.has(U.localDayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // last-30-day heatmap (oldest -> newest), level 0..4 by daily volume.
  const maxDay = Math.max(1, ...[...days.values()].map((v) => v.tokens));
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(now - i * U.DAY);
    const rec = days.get(U.localDayKey(dt.getTime()));
    let level = 0;
    if (rec && rec.tokens > 0) {
      const r = rec.tokens / maxDay;
      level = r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
    }
    last30.push({ date: dt.toISOString(), level });
  }

  // 7-day chart: daily usage as % of the daily share of the weekly limit.
  const dailyLimit = weeklyLimit / 7;
  const series = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(now - i * U.DAY);
    const rec = days.get(U.localDayKey(dt.getTime()));
    const pct = rec ? Math.min(100, (rec.tokens / dailyLimit) * 100) : 0;
    series.push({
      day: dt.toLocaleDateString(undefined, { weekday: "short" }),
      pct: round(pct),
    });
  }
  const todayRec = days.get(U.localDayKey(now));
  const todayPct = todayRec
    ? Math.min(100, round((todayRec.tokens / dailyLimit) * 100))
    : 0;

  return {
    session: {
      usedPct: round(sessionUsedPct),
      remainingMs: sessionRemainingMs,
      windowHours: cfg.sessionWindowHours,
    },
    weekly: { usedPct: round(weeklyUsedPct), resetAt: new Date(nextReset).toISOString() },
    extra,
    projections: {
      trend,
      projectedPctAtReset: round(projectedPctAtReset),
      burnRatePerHr: Math.round(burnPctPerHr * 10) / 10,
    },
    streak: { days: streak, last30 },
    sevenDay: { todayPct, series },
    updatedAt: now,
    real: true,
  };
}

// ----- mock fallback (only if no real logs found) --------------------------

function mock(now) {
  const reset = new Date(now);
  reset.setDate(reset.getDate() + ((5 - reset.getDay() + 7) % 7 || 7));
  reset.setHours(4, 0, 0, 0);
  const last30 = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(now - (29 - i) * U.DAY).toISOString(),
    level: [0, 1, 1, 2, 2, 3, 4][(i * 37) % 7],
  }));
  return {
    session: { usedPct: 8, remainingMs: 3 * 3600000 + 34 * 60000, windowHours: 5 },
    weekly: { usedPct: 75, resetAt: reset.toISOString() },
    extra: { status: "unknown", reason: null },
    projections: { trend: "Increasing", projectedPctAtReset: 14, burnRatePerHr: 1.9 },
    streak: { days: 39, last30 },
    sevenDay: {
      todayPct: 36,
      series: [
        { day: "Wed", pct: 30 }, { day: "Thu", pct: 62 }, { day: "Fri", pct: 55 },
        { day: "Sat", pct: 58 }, { day: "Sun", pct: 44 }, { day: "Mon", pct: 33 },
        { day: "Tue", pct: 36 },
      ],
    },
    updatedAt: now,
    real: false,
  };
}

// Normalise an overage header object into a small display card.
function overageCard(ov) {
  if (!ov || !ov.status) return { status: "unknown", reason: null };
  const off = ov.status !== "allowed";
  return { status: off ? "disabled" : "active", reason: ov.reason || null };
}

// Overlay real live account limits (session/weekly/projections/extra) onto a
// base object whose streak/heatmap/7-day chart come from the local logs.
function applyLive(base, live, now) {
  if (!live || !live.ok) {
    base.source = "estimate";
    base.liveError = live && live.error ? live.error : "unavailable";
    return base;
  }

  // Session (5-hour).
  if (live.session && live.session.utilization != null) {
    base.session.usedPct = round(live.session.utilization * 100);
    if (live.session.resetSec) {
      base.session.remainingMs = Math.max(0, live.session.resetSec * 1000 - now);
    }
    base.session.status = live.session.status;
  }

  // Weekly (7-day).
  if (live.weekly && live.weekly.utilization != null) {
    base.weekly.usedPct = round(live.weekly.utilization * 100);
    if (live.weekly.resetSec) {
      base.weekly.resetAt = new Date(live.weekly.resetSec * 1000).toISOString();
    }
    base.weekly.status = live.weekly.status;
  }

  // Projections from the real weekly burn rate.
  const burn = live.burnPctPerHr || 0;
  const hoursToReset =
    live.weekly && live.weekly.resetSec
      ? Math.max(0, (live.weekly.resetSec * 1000 - now) / U.HOUR)
      : 0;
  base.projections = {
    trend: live.trend || "Steady",
    projectedPctAtReset: Math.min(100, round(base.weekly.usedPct + burn * hoursToReset)),
    burnRatePerHr: Math.round(burn * 10) / 10,
  };

  // Extra usage: reflect the real overage status.
  base.extra = overageCard(live.overage);

  base.source = live.stale ? "live-stale" : "live";
  base.overallStatus = live.overallStatus;
  return base;
}

async function getUsageData() {
  const now = Date.now();
  const base = computeReal(now) || (MOCK_FALLBACK ? mock(now) : null);
  if (!base) throw new Error("No Claude usage logs found.");

  if (!settings.get("liveEnabled")) {
    base.source = "estimate";
    return base;
  }

  let live = null;
  try {
    live = await account.getLiveLimits();
  } catch (e) {
    live = { ok: false, error: "exception" };
  }
  return applyLive(base, live, now);
}

module.exports = { getUsageData };
