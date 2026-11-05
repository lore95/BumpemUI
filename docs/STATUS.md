# Status

Targets API: `../BumpemServer/docs/API.md` 1.0-draft (server 0.5.0).

## Done
- **Study protocol page (2026-11-05, U13), placeholder parameters:** `web/protocol.html` (link under Board settings): subject (5 fields) + scrollable blocks (15 fields: speed, directions, intensity % BW → N, pulse timing, gait phase + trigger foot, random interval or predefined steps); Import / Export CSV, Download template, Confirm per section. Fields from `web/protocol_schema.js`. Checked in Chrome against the simulator (import with `72,5` and a bad value, hidden fields, over-max intensity, 8 blocks scrolling). Start disabled until server trials exist.
- **Sensor calibration page (2026-11-03, U11):** `web/calibrate.html` → CSV for `apply_calibration.bat` (server D42). Checked on the real Teensy from the Mac (tara, record, CSV through the script). Link under Board settings.
- **Defaults warning (2026-11-03, U10):** line under the header when the board's parameters differ from the saved defaults (or none are saved); "Board restarted: …" on the server's `RESTART` event. Checked in Chrome against the simulator.
- **Logo (2026-11-02):** user's icon (treadmill seen from above, N/E/S/W ropes) as tab icon (`web/favicon.png`, 64 px) and header logo (`web/logo.png`, 128 px) on both pages; corners transparent. Source PNG in `../bumpemInstallation/`.
- **Record next to Arm (2026-11-02, U8):** green Record once armed → blue Stop rec; records rope forces + pulses + Vicon (server D33); note shows rows and Vicon rows, links three CSVs after. Ground-force card no longer records by itself. Checked in Chrome against the simulator.
- **Two live plots, new layout (2026-11-02, U7):** left half Direction + Perturbation, right half **Rope force** (tower sensors, Record button) above **Ground force** (GRAIL plates via Vicon: address field + Connect, live Fz per plate, recording note "● Recording … until Release or STOP", Download CSV after); Board settings full width at the bottom; one column below 1000 px. The WebSocket stays open without a board (Vicon alone works). Checked in Chrome against `--board sim --vicon sim`. Not yet run against real Vicon.
- **Test UI (2026-10-30, U6):** `/ui/` = test page: angle dial, perturbation (force + timing), board settings, full-width live plot; Record → Stop downloads the force CSV, note links force + events CSV (`GET /log/file`, server D27). Gait-phase card and `gait.js` removed. Checked in Chrome against the simulator (record, arm, perturb, plot). Next: new UI from the 2026-10-29 meeting parameters.
- **Perturbation amplitude limit shown (2026-10-27):** next to Amplitude: `max = fmax_n − baseline_n` from `GET /params`; Perturb now refuses a larger amplitude with a message naming Max force (before: the board rejected it and nothing pulled). Lab setting now fmax_n 196 N (20 kg), fault_n 200 N.
- **Zero, defaults, recording (2026-10-12, BumpemServer D20/D21, U5):** production page: Feedforward gain (kff) field; **Zero sensors** (DISARMED/ESTOP: 2 s mean of each enabled module → `offset_*` via `PATCH /params`, refused beyond ±20 N); **Save as default** (`POST /settings`, note shows what is saved / pending / refused); **Record** with label (`POST /log/start|stop`, live row count, file path when stopped). Checked in Chrome against the simulator.
- **Two pages (2026-10-05, BumpemServer D19):** `web/testing.html` (server `--testing`): per motor force + duration → Pull (`POST /test/pull`), STOP/Esc, board state; `web/index.html` (server `--production`, default): the full UI below, Motor test card removed. Each page warns when the server runs in the other mode.
- **First UI (2026-10-05), `web/`** (plain HTML/CSS/JS, black theme), served by `bumpem serve` at http://127.0.0.1:8000/ui/. Tested against the simulator in Chrome:
  - Connect (simulator or serial port), Arm (also recovers from ESTOP), Release (asks "treadmill stopped?"), **STOP** button + **Esc** key (no question asked), Clear fault.
  - **Direction dial**: top view, click the ring (5° steps, Shift = 1°) or type the angle. Reachable directions come from `GET /geometry` (enabled channels); the rest is grey and refused (B off → front refused, 135° → A + D 7.07 N each).
  - **Perturbation**: amplitude, phase 1, duration, phase 2, delay; profile preview; **Perturb now** → `POST /perturbation`.
  - **Gait phase (PTO)**: running cycle bar (stance 0–40, float 40–55, swing 55–85, float 85–100, thesis Fig. 1) + 8 clickable stick-figure runners; produces `pto {"mode": "cycle_pct", ...}`. "Perturb at gait phase" disabled until the server has PTO (API step 2).
  - **Board settings**: baseline, max force, channels A–D (`PATCH /params`).
  - **Live force**: last 10 s, measured (solid) / target (dashed) per enabled module, from the WebSocket stream.
- Folder created (BumpemServer D11).

## Next
1. On the real Teensy: `bumpem serve --testing --board /dev/cu.usbmodem169222501` → http://127.0.0.1:8000/ → Pull each motor (5 N, 400 ms): does the right rope move?
2. When the server has PTO (API step 2): gait-phase picker back (git history, `web/gait.js`), show gait events from the stream.
3. Study protocol: replace the placeholder fields in `web/protocol_schema.js` with the lab's parameter list (user brings it). Then API.md trials schema from it (server), then Start on `protocol.html` (API step 3: run blocks, progress).

## Open
- Network use from another PC: needs the server's access token + `--host` (BumpemServer TODO).
