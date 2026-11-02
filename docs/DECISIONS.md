# Decisions

Append-only. Format: `## U<n> — <date> — <title>` / Decision / Reason / Alternatives.
Server-side decisions that shaped this project: BumpemServer D9 (web UI served by a local server), D10 (UI is a separate client), D11 (folder split).

## U1 — 2026-09-29 — Plain web page, no build step
Decision: HTML/CSS/JS files served as they are; third-party scripts saved in the repo.
Reason: clone-and-go on any OS without Node.js; lab PCs may be offline.
Alternatives: React/Vite (needs Node and a build), NiceGUI (UI in Python, but tied to the server process).

## U2 — 2026-10-05 — Served by bumpem serve at /ui/
Decision: the server serves `web/` at `/ui/` (`bumpem serve --ui PATH`, default `../BumpemUI/web`); the page calls the API on the same origin (relative `/api/v1/...`, WebSocket on `location.host`).
Reason: no cross-origin setup, one URL for the operator, works offline.
Alternatives: open the file directly (blocked by the browser without CORS); a separate static server.

## U3 — 2026-10-05 — Running gait-phase picker, own stick figures, cycle %
Decision: the PTO picker shows the running gait cycle of thesis Fig. 1 (stance 0–40 %, float 40–55 %, swing 55–85 %, float 85–100 %) with 8 stick-figure runners drawn from approximate joint-angle curves (not the thesis image, which comes from a cited source). The selection is a % of the gait cycle after the trigger foot strike (`pto.mode = "cycle_pct"`, added to API.md as planned).
Reason: the lab's trials are running (thesis); a cycle % covers float and swing, which "% of stance" cannot.
Alternatives: lab photos; walking cycle; stance % only.

## U4 — 2026-10-05 — No plot library
Decision: the live force plot is a plain canvas (10 s window, ~60 fps redraw, 30 Hz data).
Reason: 4 channels × 2 lines is simple; nothing to vendor or update.
Alternatives: uPlot / Chart.js saved in the repo.

## U5 — 2026-10-12 — Zeroing is done in the UI, storing on the server
Decision: "Zero sensors" averages the last 2 s of the stream per enabled module and sends `offset_*` with `PATCH /params`; "Save as default" only calls `POST /settings`. Recording is a start/stop button with an optional label.
Reason: zeroing needs nothing the API lacks; keeping the file on the server means every client (UI, MATLAB, scripts) gets the same values after a replug.
Alternatives: a server endpoint for zeroing (add when a second client needs it); storing defaults in the browser (lost on another PC or browser).
---

## 2026-10-27 — Testing page force up to 150 N
Follows BumpemServer D26 (`POST /test/pull` `force_n` ≤ 150).

## U6 — 2026-10-30 — Production page becomes the test UI
Decision: `/ui/` (production mode) keeps Direction (angle), Perturbation (force + timing), Board settings; the gait-phase card and `gait.js` are removed (in git history, commit e6da8f6 and earlier); the live plot spans the full width (55 % of the window height, time axis in s); Stop recording downloads the force CSV (`GET /log/file`, BumpemServer D27), with links to both CSVs in the note. The testing page (`--testing`, open-loop pull per motor) is unchanged.
Reason: lab meeting 2026-10-29: test pulls by force and angle, big live graph, record with CSV export; the next UI will be built from the parameters defined there.
Alternatives: keep the gait picker disabled on the page (clutter until PTO exists).

## U7 — 2026-11-02 — Two stacked live plots, settings at the bottom
Decision: two columns from 1000 px: controls (Direction, Perturbation) left, plots right (rope force above ground force, each `clamp(220px, 32vh, 440px)` high); Board settings full width at the bottom. The ground plot shows the server's `vicon` stream (BumpemServer D32); no Vicon record button: the server records while armed. The Vicon address is remembered in the browser (localStorage), the server's `--vicon` value fills it otherwise.
Reason: user (2026-11-02): directions and perturbation in half the screen, the two live plots on top of each other in the other half, board settings at the far bottom.
Alternatives: plots side by side (too narrow for 10 s); tabs (one plot hidden).
