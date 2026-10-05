# Status

Targets API: `../BumpemServer/docs/API.md` 1.0-draft (server 0.2.0).

## Done
- **First UI (2026-10-05), `web/`** (plain HTML/CSS/JS, black theme), served by `bumpem serve` at http://127.0.0.1:8000/ui/. Tested against the simulator in Chrome:
  - Connect (simulator or serial port), Arm (also recovers from ESTOP), Release (asks "treadmill stopped?"), **STOP** button + **Esc** key (no question asked), Clear fault.
  - **Direction dial**: top view, click the ring (5° steps, Shift = 1°) or type the angle. Reachable directions come from `GET /geometry` (enabled channels); the rest is grey and refused (B off → front refused, 135° → A + D 7.07 N each).
  - **Perturbation**: amplitude, phase 1, duration, phase 2, delay; profile preview; **Perturb now** → `POST /perturbation`.
  - **Gait phase (PTO)**: running cycle bar (stance 0–40, float 40–55, swing 55–85, float 85–100, thesis Fig. 1) + 8 clickable stick-figure runners; produces `pto {"mode": "cycle_pct", ...}`. "Perturb at gait phase" disabled until the server has PTO (API step 2).
  - **Board settings**: baseline, max force, channels A–D (`PATCH /params`).
  - **Live force**: last 10 s, measured (solid) / target (dashed) per enabled module, from the WebSocket stream.
- Folder created (BumpemServer D11).

## Next
1. Try it on the real Teensy: `bumpem serve --board /dev/cu.usbmodem169222501`, open http://127.0.0.1:8000/ui/ (open-loop settings, `ch_D` on, `ch_B` off).
2. When the server has PTO (API step 2): enable "Perturb at gait phase", show gait events from the stream.
3. Trials page (API step 3): blocks, shuffle, 50–75 steps, recovery, progress.

## Open
- Network use from another PC: needs the server's access token + `--host` (BumpemServer TODO).
