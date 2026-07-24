# Anthrostat

A Windows system-tray gauge for your Claude usage — session (5-hour) and
weekly limits, extra-usage spend, streaks, a 30-day heat-map, a 7-day usage
chart, and burn-rate projections. Reads your **real** Claude Code usage logs.

![icon](build/icon.png)

## Install (no build tools needed)

1. Grab the latest **`Anthrostat-win.zip`** from the [Releases page](../../releases).
2. Extract it anywhere.
3. Double-click **`Install.bat`**. No admin required. It:
   - copies the app to `%LOCALAPPDATA%\Anthrostat`
   - creates Desktop + Start-Menu shortcuts
   - launches it into the system tray

Right-click the tray icon for **Start at login**. Remove anytime with
`Uninstall.bat` (also in the zip).

Windows SmartScreen may warn about the app since it isn't code-signed — click
**More info → Run anyway**. The full source is right here in this repo if you'd
rather build it yourself (see below).

## Where the data comes from

The **session and weekly percentages are your real live account limits** — the
exact numbers Claude itself reports. They come from Anthropic's
`anthropic-ratelimit-unified-*` response headers, read by making one minimal
authenticated request using the OAuth token Claude Code already stored in
`~/.claude/.credentials.json` (see [`src/account.js`](src/account.js)).

| Metric | Source |
| --- | --- |
| **Session % + reset countdown** | **Live** — `unified-5h` headers |
| **Weekly % + reset date** | **Live** — `unified-7d` headers |
| **Extra usage / overage status** | **Live** — `unified-overage-*` headers (status only; the API exposes no $ amount) |
| Burn rate / projection | Real weekly-utilisation change over time |
| Streak / heat-map / 7-day chart | Your local logs (`~/.claude/projects`) |

### Reconnect
The OAuth token expires roughly hourly. When it does, the footer switches to
**○ Estimate** and a **Reconnect** button appears. Clicking it retries, and if
the token is dead it refreshes it via the stored refresh token (backing up
`.credentials.json` first) — no need to open Claude Code. If refresh fails, it
tells you to run `claude` once to sign in again.

The footer shows a **● Live** indicator when data is fresh from your account,
**● Live (cached)** when temporarily offline, or **○ Estimate** if it falls
back to local-log estimates.

### How the live token is used
- The token is read fresh each poll (so Claude Code's refreshes are picked up),
  is **never logged**, and is only ever sent to `api.anthropic.com` over HTTPS.
- Each poll is a `max_tokens:1` request (a few tokens of quota). Polling is
  throttled to `liveTtlSeconds` (default **180s**) to keep it negligible.
- If the token has expired and Claude Code isn't running to refresh it, the app
  shows the last-known values then falls back to the local estimate.

### Usage alerts
A background monitor checks your limits every 60s and fires a desktop
notification when **session** or **weekly** crosses the threshold (default
**80%**). Each metric alerts once per crossing and re-arms after it drops a few
points below the threshold (so it won't spam you). Clicking the notification
opens the popover. Toggle alerts and change the threshold from the gear panel.

### In-app settings (⚙ gear icon)
Click the gear in the footer to toggle **Live account data** on/off, choose the
**refresh interval** (1–10 min), enable **Start at login**, turn **Usage alerts**
on/off and set their **threshold**. Changes save instantly to
`~/.anthrostat/settings.json` and take effect without a restart.

### Tunables in [`src/config.js`](src/config.js)
- `liveEnabled` — set `false` to go fully offline (local estimate only).
- `liveTtlSeconds` — how often to hit the API (default 180).
- `sessionTokenLimit` / `weeklyTokenLimit` — used only for the offline estimate.
- `resetWeekday` / `resetHour` — reset schedule for the offline estimate.
- `monthlyBudgetUSD`, `pricing` — for the local $ spend estimate.

If no logs and no token are found, the app shows representative mock data.

## Develop / rebuild from source

```bash
git clone https://github.com/mohammedkharoda/anthrostat.git
cd anthrostat
npm install
npm start                        # run from source
powershell ./build-portable.ps1  # produces dist/Anthrostat + installer scripts
```

`build-portable.ps1` stages a self-contained app folder (Electron runtime +
app code) into `dist/Anthrostat`, plus `Install.bat` / `install.ps1` /
`Uninstall.bat` / `uninstall.ps1` copied from [`installer/`](installer/). Zip
the whole `dist` folder to reproduce a release asset.

Data refreshes every 15s in the popover and every 30s on the tray icon.
