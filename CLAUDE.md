# CLAUDE.md — BumpemUI
## Goal
Browser UI for the Bump'em perturbation system. Anyone with the server running can set every
parameter, run pulses and trials, and watch live forces. Windows, Linux, macOS, offline lab PCs.

## Style
No slop, no fluff. Less is more. If a needed file is missing, ask for it. Don't guess.

## Session protocol
1. **Start:** read `docs/STATUS.md` and `docs/DECISIONS.md`.
2. **After any change:** update `docs/STATUS.md`; append to `docs/DECISIONS.md` if a choice was made.
3. **End:** STATUS.md says exactly what the next session starts with.

## Constraints
- Talks to the server only through its API: `../BumpemServer/docs/API.md` (targeted version in `docs/STATUS.md`). Never import or read `bumpem` internals.
- Need something the API lacks? Change API.md in BumpemServer first, then the server, then here.
- Plain HTML/CSS/JS. No Node build step. Third-party JS saved in the repo (works offline).
- Stop is always visible and reachable (button + keyboard shortcut), on every screen.
- Stop ≠ release: the UI never offers release/stop without the "stop the treadmill first" warning (`../BumpemServer/docs/knowledge/safety.md`).
- Terms and units from the API: N, ms, degrees; angle 0 = front, +90 = left. Pulse terms: `../BumpemServer/docs/knowledge/perturbation_definitions.md`.
- Must work against the simulator (`POST /api/v1/connect {"port":"sim"}`).
