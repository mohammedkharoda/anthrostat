// ---------------------------------------------------------------------------
// settings.js — runtime settings = config.js defaults + persisted overrides.
//
// The UI (gear icon) writes overrides here; they persist to
// ~/.claude-battery/settings.json and win over config.js. Read every value
// through settings.get(key) so live changes take effect without a restart.
// ---------------------------------------------------------------------------

const fs = require("fs");
const os = require("os");
const path = require("path");
const defaults = require("./config");

const FILE = path.join(os.homedir(), ".claude-battery", "settings.json");

// Only these keys may be overridden from the UI.
const ALLOWED = [
  "liveEnabled",
  "liveTtlSeconds",
  "monthlyBudgetUSD",
  "alertsEnabled",
  "alertThreshold",
];

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

let overrides = load();

function get(key) {
  return key in overrides ? overrides[key] : defaults[key];
}

function all() {
  return { ...defaults, ...overrides };
}

function update(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (ALLOWED.includes(k)) overrides[k] = v;
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(overrides, null, 2));
  } catch {
    /* best-effort */
  }
  return all();
}

module.exports = { get, all, update, defaults, ALLOWED, FILE };
