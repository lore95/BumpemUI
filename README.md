# BumpemUI

Web interface for the IBMS Bump'em perturbation system. It is a client of the bumpem server
(`../BumpemServer`) and uses only the server API: `../BumpemServer/docs/API.md`.

## Run
```sh
cd ../BumpemServer
bumpem serve --testing --board sim      # motor check: one pull per motor, no arming
bumpem serve --board sim                # production: arm, perturbations (default)
```
Use `--board /dev/cu.usbmodem169222501` for the Teensy. Open http://127.0.0.1:8000/ (it opens the page for the mode). The server serves `web/` (this folder must sit next to BumpemServer, or pass `--ui PATH`).

**STOP**: red button or the **Esc** key, on every screen. STOP and Release drop rope tension: stop the treadmill first unless it is an emergency.

Status: `docs/STATUS.md`.
