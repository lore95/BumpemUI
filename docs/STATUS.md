# Status

Targets API: `../BumpemServer/docs/API.md` 1.0-draft.

## Done
- Folder created (BumpemServer D11). Nothing built.

## Next
1. Wait for `bumpem serve` with the `board` endpoints (BumpemServer STATUS, Next 3).
2. Minimal page against the simulator: connect, arm, pulse (channel form), stop, live force plot from the WebSocket.
3. Gait-phase picker for PTO: image buttons or a clickable strip.

## Open
- How the server finds these files: proposal `bumpem serve --ui PATH`, default `../BumpemUI/web` when the folders sit side by side. Decide with the server work; record in both DECISIONS.md.
- Gait-phase picker: walking or running (thesis trials: running, 3.3 m/s)? Lab images, or generated stick figures?
- Plot library to vendor (decide when building step 2).
