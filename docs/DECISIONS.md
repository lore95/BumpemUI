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

## U8 — 2026-11-02 — Record button next to Arm
Decision: the Record button sits in the top bar after Arm: green "Record", enabled only while ARMED; while recording it is blue "Stop rec" and stays enabled in any state (after Release / STOP too). It records rope forces, pulses and Vicon together (BumpemServer D33). The label field and the status note stay in the Rope force card; after Stop rec the force CSV downloads, the note links force, events and Vicon CSVs.
Reason: user (2026-11-02).
Alternatives: Record in the plot card (out of sight while setting up a pull); allow Record while disarmed (user wants it after arming).

## U9 — 2026-11-02 — Live plot at 20 Hz (median of 5 samples per point)
Decision: the page opens the stream with `telemetry_hz=20`; the server sends the median of the board samples between messages (BumpemServer D39), so each point is the median of 5 samples (50 ms). Legend says so; recordings stay raw at 100 Hz.
Reason: user (2026-11-02): rope force very noisy, spikes.
Alternatives: 30 Hz (median of ~3: removes spikes, little smoothing); browser-side smoothing.

## U10 — 2026-11-03 — Warning when the board does not run the saved defaults
Decision: a line under the header lists every parameter where `GET /params` differs from `GET /settings` params (`kff 7.5 (saved 2)`), or says no defaults are saved; checked after connect, Apply, Zero and Save. On the stream event `RESTART` (server D41) the page reloads parameters and says "Board restarted: …".
Reason: 2026-11-03 a perturbation test ran on firmware defaults without anyone seeing it (server D41).
Alternatives: disable Arm on a mismatch (blocks deliberate unsaved tuning).

## U11 — 2026-11-03 — Sensor calibration page
Decision: `web/calibrate.html` + `calibrate.js` (link under Board settings): connect, sensor A–D, live raw value after tara (0.5 s mean), **Tara** and **Record weight** (2 s mean of every board sample, stream at `telemetry_hz=1000`; only while DISARMED/ESTOP), results per sensor (gain, worst error, notes: one weight only, outside 0.5–3), points table, **Download CSV** (`calibration_<stamp>.csv`, columns in server D42), Delete last, Clear all (two clicks). Raw = (measured − offset) / gain with the board's current values. Rows kept in the browser (localStorage) across reloads. A point is refused when the sensor shows < 15 % of the weight (wrong sensor selected). STOP + Esc as on every page.
Reason: user (2026-11-03): weights hung on each sensor, tara for the hook, next weight / sensor, CSV for a config script on the lab PC (server D42).
Alternatives: fit and PATCH gains in the page (no record; lab PC is not where the weights are hung).

## U12 — 2026-11-03 — Calibration page: fit through the tara, refuse full-scale points (server D43)
Decision: the page's gain is the same least-squares slope through the tara as `apply_calibration.py`; Record weight refuses a reading at full scale (≥ 99.5 % of `f_full`) and says to use a lighter weight; the hint names the usable range (~19 kg on A/C/D, ~40 kg on B).
Reason: first calibration: 32 kg read 200.00 N (saturated) on A, C, D; the free fit was unreliable with 12/16 kg.
