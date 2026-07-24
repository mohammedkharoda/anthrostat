// ---------------------------------------------------------------------------
// config.js — knobs you can safely edit.
//
// The token COUNTS, timestamps, streaks and burn rate are read 100% from your
// real Claude Code logs. The things below can't be read from disk (Claude does
// not publish your plan's exact limits), so they're configurable here:
//   - session/weekly limits used to turn token counts into a %,
//   - the weekly reset schedule,
//   - the extra-usage $ budget,
//   - per-model pricing used to compute $ spend.
// Leave a limit as null to auto-calibrate it from your own historical peak.
// ---------------------------------------------------------------------------

const os = require("os");
const path = require("path");

module.exports = {
  // Where Claude Code stores its logs. Override with CLAUDE_CONFIG_DIR.
  claudeDir:
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),

  // Turn token usage into a percentage. null => auto-calibrate to your peak
  // (so 100% == your busiest-ever 5h block / 7-day span).
  sessionTokenLimit: null,
  weeklyTokenLimit: null,

  // Weekly limit reset schedule (local time). 5 = Friday, 4 = 4:00 AM.
  resetWeekday: 5,
  resetHour: 4,

  // "Extra usage" dollar budget (matches the original mock's $200).
  monthlyBudgetUSD: 200,
  billingWindowDays: 30,

  // Session window length Claude uses for the short-term limit.
  sessionWindowHours: 5,

  // --- LIVE account data (real 5h/7d limits from your Claude login) ---
  // When true, session & weekly % come straight from Anthropic's
  // anthropic-ratelimit-unified headers (exactly what Claude Code reports).
  liveEnabled: true,
  // How often to actually call the API. Uses a tiny (max_tokens:1) request.
  liveTtlSeconds: 180,
  // Cheapest model to ping for the headers.
  apiModel: "claude-haiku-4-5-20251001",

  // --- Usage alerts ---
  // Fire a desktop notification when session or weekly crosses the threshold.
  alertsEnabled: true,
  alertThreshold: 80, // percent

  // USD per 1,000,000 tokens. Edit to match your actual rates.
  // Fallback ("default") is used for any model not listed.
  pricing: {
    "claude-opus-4-8": { in: 15, out: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
    "claude-opus-4-1": { in: 15, out: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
    "claude-sonnet-5": { in: 3, out: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
    "claude-fable-5": { in: 3, out: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
    "claude-haiku-4-5-20251001": { in: 1, out: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
    default: { in: 3, out: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  },
};
