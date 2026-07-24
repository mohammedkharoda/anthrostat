// Renders the usage data into the popover. Pure DOM — no framework.

// Fallback so the popover can be opened in a plain browser for design work
// (outside Electron there is no preload-injected `window.battery`).
if (typeof window.battery === "undefined") {
  const reset = new Date();
  reset.setDate(reset.getDate() + ((5 - reset.getDay() + 7) % 7 || 7));
  reset.setHours(4, 0, 0, 0);
  const last30 = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - (29 - i) * 86400000).toISOString(),
    level: [0, 1, 1, 2, 2, 3, 4][((i * 37) % 7)],
  }));
  const sample = {
    session: { usedPct: 28, remainingMs: 3 * 3600000 + 55 * 60000, windowHours: 5, status: "allowed" },
    weekly: { usedPct: 3, resetAt: reset.toISOString(), status: "allowed" },
    extra: { status: "disabled", reason: "org_level_disabled" },
    projections: { trend: "Steady", projectedPctAtReset: 3, burnRatePerHr: 0 },
    streak: { days: 1, last30 },
    sevenDay: {
      todayPct: 38,
      series: [
        { day: "Fri", pct: 0 }, { day: "Sat", pct: 0 }, { day: "Sun", pct: 0 },
        { day: "Mon", pct: 0 }, { day: "Tue", pct: 0 }, { day: "Wed", pct: 0 },
        { day: "Thu", pct: 38 },
      ],
    },
    source: "live",
  };
  let fakeSettings = { liveEnabled: true, liveTtlSeconds: 180, monthlyBudgetUSD: 200, startAtLogin: false, alertsEnabled: true, alertThreshold: 80 };
  window.battery = {
    getUsage: async () => sample,
    setTrayIcon: () => {},
    setTrayTooltip: () => {},
    hidePopover: () => {},
    getSettings: async () => fakeSettings,
    setSettings: async (patch) => (fakeSettings = { ...fakeSettings, ...patch }),
    reconnect: async () => ({ ok: false, needsClaudeCode: true }),
  };
}

const RING_R = 37;
const RING_CIRC = 2 * Math.PI * RING_R;

function fmtRemaining(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function fmtReset(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "long" });
  const md = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}, ${md} at ${h}:${mm} ${ampm}`;
}

function trendArrow(t) {
  if (t === "Increasing") return "↗ Increasing";
  if (t === "Decreasing") return "↘ Decreasing";
  return "→ Steady";
}

function buildHeatmap(cells) {
  const grid = document.getElementById("heat-grid");
  grid.innerHTML = "";
  cells.forEach((c) => {
    const el = document.createElement("div");
    el.className = "cell l" + c.level;
    el.title = new Date(c.date).toLocaleDateString();
    grid.appendChild(el);
  });
}

function buildChart(series) {
  const svg = document.getElementById("chart");
  const W = 320;
  const H = 110;
  const pad = 8;
  const max = 100;
  const n = series.length;
  const step = (W - pad * 2) / (n - 1);
  const pts = series.map((s, i) => {
    const x = pad + i * step;
    const y = H - pad - (s.pct / max) * (H - pad * 2);
    return [x, y];
  });

  const line = pts.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ");
  const area =
    `M ${pts[0][0]} ${H - pad} ` +
    pts.map((p) => `L ${p[0]} ${p[1]}`).join(" ") +
    ` L ${pts[n - 1][0]} ${H - pad} Z`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(209,96,61,0.35)"/>
        <stop offset="100%" stop-color="rgba(209,96,61,0.02)"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#fill)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5"
          stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="4" fill="var(--accent-deep)"/>
  `;

  const labels = document.getElementById("c-labels");
  labels.innerHTML = series.map((s) => `<span>${s.day}</span>`).join("");
}

async function render() {
  const d = await window.battery.getUsage();

  // Session ring
  const sPct = d.session.usedPct;
  document.getElementById("ring-num").textContent = sPct;
  document.getElementById("s-pct").innerHTML = `${sPct}% <span>used</span>`;
  document.getElementById("s-rem").textContent = fmtRemaining(d.session.remainingMs);
  const arc = document.getElementById("ring-arc");
  if (arc) {
    const pct = Math.min(100, Math.max(0, sPct));
    arc.style.strokeDasharray = RING_CIRC;
    arc.style.strokeDashoffset = RING_CIRC * (1 - pct / 100);
  }

  // Weekly
  document.getElementById("w-pct").textContent = d.weekly.usedPct + "%";
  document.getElementById("w-bar").style.width = d.weekly.usedPct + "%";
  document.getElementById("w-reset").textContent = fmtReset(d.weekly.resetAt);

  // Extra usage (real overage status — no $ figure exists in the API)
  const ex = d.extra || {};
  const statusEl = document.getElementById("x-status");
  const noteEl = document.getElementById("x-note");
  if (ex.status === "disabled") {
    statusEl.textContent = "Off";
    noteEl.textContent =
      ex.reason === "org_level_disabled" ? "Not enabled on your plan" : "Pay-as-you-go disabled";
  } else if (ex.status === "active") {
    statusEl.textContent = "On";
    noteEl.textContent = "Pay-as-you-go enabled";
  } else {
    statusEl.textContent = "—";
    noteEl.textContent = "Connect to see overage status";
  }

  // Projections
  document.getElementById("p-trend").textContent = trendArrow(d.projections.trend);
  document.getElementById("p-proj").textContent = d.projections.projectedPctAtReset + "%";
  document.getElementById("p-burn").textContent = d.projections.burnRatePerHr + "%/hr";

  // Streak
  document.getElementById("st-days").textContent = d.streak.days;
  buildHeatmap(d.streak.last30);

  // Chart
  document.getElementById("c-today").textContent = d.sevenDay.todayPct + "%";
  buildChart(d.sevenDay.series);

  // Footer — data-source indicator.
  const src = d.source;
  const el = document.getElementById("updated");
  if (src === "live") el.innerHTML = '<span style="color:#2e9e6b">●</span> Live · updated just now';
  else if (src === "live-stale") el.innerHTML = '<span style="color:#c99a2e">●</span> Live (cached)';
  else el.innerHTML = '<span style="color:#93796a">○</span> Estimate (local logs)';

  // Show Reconnect unless we're fully live.
  const reco = document.getElementById("reconnect");
  if (reco) reco.style.display = src === "live" ? "none" : "inline-block";
}

document.getElementById("close").addEventListener("click", () =>
  window.battery.hidePopover()
);
document.getElementById("refresh").addEventListener("click", render);

// ---- Settings panel ----
const panel = document.getElementById("settings");
const optLive = document.getElementById("opt-live");
const optInterval = document.getElementById("opt-interval");
const optStartup = document.getElementById("opt-startup");
const rowInterval = document.getElementById("row-interval");
const optAlerts = document.getElementById("opt-alerts");
const optThreshold = document.getElementById("opt-threshold");
const rowThreshold = document.getElementById("row-threshold");

function reflectSettings(s) {
  optLive.checked = !!s.liveEnabled;
  optInterval.value = String(s.liveTtlSeconds);
  optStartup.checked = !!s.startAtLogin;
  optAlerts.checked = !!s.alertsEnabled;
  optThreshold.value = s.alertThreshold;
  rowInterval.classList.toggle("disabled", !s.liveEnabled);
  rowThreshold.classList.toggle("disabled", !s.alertsEnabled);
}

async function openSettings() {
  if (window.battery.getSettings) reflectSettings(await window.battery.getSettings());
  panel.classList.add("open");
}
function closeSettings() {
  panel.classList.remove("open");
  render(); // pick up any changes immediately
}

async function save(patch) {
  if (!window.battery.setSettings) return;
  const s = await window.battery.setSettings(patch);
  reflectSettings(s);
}

document.getElementById("settings-btn").addEventListener("click", openSettings);
document.getElementById("settings-back").addEventListener("click", closeSettings);
optLive.addEventListener("change", () => save({ liveEnabled: optLive.checked }));
optInterval.addEventListener("change", () =>
  save({ liveTtlSeconds: Number(optInterval.value) })
);
optStartup.addEventListener("change", () => save({ startAtLogin: optStartup.checked }));
optAlerts.addEventListener("change", () => save({ alertsEnabled: optAlerts.checked }));
optThreshold.addEventListener("change", () => {
  let v = Math.max(1, Math.min(100, Number(optThreshold.value) || 80));
  save({ alertThreshold: v });
});

// ---- Reconnect ----
document.getElementById("reconnect").addEventListener("click", async () => {
  const reco = document.getElementById("reconnect");
  reco.disabled = true;
  reco.textContent = "Connecting…";
  let r = { ok: false };
  try {
    if (window.battery.reconnect) r = await window.battery.reconnect();
  } catch {
    /* ignore */
  }
  await render();
  if (r.ok) {
    reco.disabled = false;
    reco.textContent = "Reconnect";
  } else {
    reco.textContent = r.needsClaudeCode ? "Run Claude Code to sign in" : "Retry";
    reco.title = "Your Claude login expired. Open Claude Code (run `claude`) to sign in, then reconnect.";
    setTimeout(() => {
      reco.disabled = false;
      reco.textContent = "Reconnect";
    }, 4000);
  }
});

render();
setInterval(render, 15000);
