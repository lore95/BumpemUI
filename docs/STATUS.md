# Status

Targets API: `../BumpemServer/docs/API.md` 1.0-draft (server 0.4.0).

## Done
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
2. When the server has PTO (API step 2): enable "Perturb at gait phase", show gait events from the stream.
3. Trials page (API step 3): blocks, shuffle, 50–75 steps, recovery, progress.

## Open
- Network use from another PC: needs the server's access token + `--host` (BumpemServer TODO).
