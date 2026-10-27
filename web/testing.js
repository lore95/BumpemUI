// Testing page: one open-loop pull per motor via POST /api/v1/test/pull (server in --testing mode). No arming here.
"use strict";
const API = "/api/v1";
const $ = (id) => document.getElementById(id);
const MODS = [["A", "left"], ["B", "front"], ["C", "right"], ["D", "back"]];
let connected = false, state = null, busy = false, ws = null;

async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ? data.error.message : `HTTP ${r.status}`);
  return data;
}
function setText(id, text, bad) { const e = $(id); e.textContent = text; e.style.color = bad ? "var(--stop)" : ""; }

function buildRows() {
  $("rows").innerHTML = MODS.map(([m, side]) => `
    <tr>
      <td><b style="color:var(--ch-${m})">${m}</b> <span class="muted">${side}</span></td>
      <td><input id="f-${m}" type="number" min="0.5" max="150" step="0.5" value="5"></td>
      <td><input id="d-${m}" type="number" min="100" max="1000" step="50" value="400"></td>
      <td><button id="p-${m}" class="primary">Pull</button></td>
      <td id="r-${m}" class="muted small">—</td>
    </tr>`).join("");
  for (const [m] of MODS) $(`p-${m}`).onclick = () => pull(m);
}

async function pull(m) {
  if (busy) return;
  const force = parseFloat($(`f-${m}`).value), dur = parseFloat($(`d-${m}`).value);
  busy = true; updateButtons(); setText(`r-${m}`, "pulling…");
  try {
    const r = await api("POST", "/test/pull", { module: m, force_n: force, dur_ms: dur });
    setText(`r-${m}`, `pull ${r.pulse_id} sent: ${r.force_n} N for ${r.dur_ms} ms. Did the ${MODS.find((x) => x[0] === m)[1]} rope move?`);
  } catch (e) { setText(`r-${m}`, e.message, true); }
  busy = false; updateButtons();
}

function stop() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "estop" }));
  fetch(API + "/estop", { method: "POST" }).catch(() => {});
}

function setState(st) {
  state = st;
  const el = $("board-state");
  el.textContent = st || (connected ? "no data" : "—"); el.className = `pill state ${st || (connected ? "FAULT" : "")}`;
  updateButtons();
}
function updateButtons() {
  for (const [m] of MODS) $(`p-${m}`).disabled = !connected || busy;
}

function openStream() {
  if (ws) ws.close();
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/stream?telemetry_hz=10`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === "telemetry" && m.state !== state) setState(m.state); };
  ws.onclose = () => { if (connected) setTimeout(openStream, 1000); };
}
async function setConnected(info) {
  connected = !!(info && info.port);
  setText("conn-state", connected ? `${info.port}` : "not connected");
  $("conn-state").classList.toggle("ok", connected);
  $("btn-connect").textContent = connected ? "Disconnect" : "Connect";
  if (connected) {
    try { setState((await api("GET", "/status")).state); } catch (e) { setState(null); }
    openStream();
  } else { if (ws) { const w = ws; ws = null; w.close(); } setState(null); }
}
async function connectToggle() {
  const btn = $("btn-connect");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    if (connected) { await api("POST", "/disconnect"); await setConnected(null); }
    else { setText("conn-state", "connecting…"); await setConnected(await api("POST", "/connect", { port: $("port").value })); }
  } catch (e) { setText("conn-state", e.message, true); }
  finally { btn.disabled = false; }
}

async function init() {
  buildRows(); updateButtons();
  $("btn-connect").onclick = connectToggle; $("btn-stop").onclick = stop;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
  try {
    const ports = await api("GET", "/ports");
    $("port").innerHTML = '<option value="sim">simulator</option>' + ports.map((p) => `<option>${p}</option>`).join("");
  } catch (e) { /* keep the simulator */ }
  try {
    const info = await api("GET", "/info");
    if (info.mode !== "testing") {
      const w = $("mode-warning"); w.hidden = false;
      w.textContent = `The server is in ${info.mode} mode: pulls are refused here. Restart it with  bumpem serve --testing  (or use the production page at /ui/).`;
    }
    if (info.port) await setConnected(info);
  } catch (e) { setText("conn-state", "server not reachable", true); }
}
init();
