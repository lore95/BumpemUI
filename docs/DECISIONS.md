# Decisions

Append-only. Format: `## U<n> — <date> — <title>` / Decision / Reason / Alternatives.
Server-side decisions that shaped this project: BumpemServer D9 (web UI served by a local server), D10 (UI is a separate client), D11 (folder split).

## U1 — 2026-09-29 — Plain web page, no build step
Decision: HTML/CSS/JS files served as they are; third-party scripts saved in the repo.
Reason: clone-and-go on any OS without Node.js; lab PCs may be offline.
Alternatives: React/Vite (needs Node and a build), NiceGUI (UI in Python, but tied to the server process).
