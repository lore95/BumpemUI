// Sensor calibration page: known weights on each load cell → CSV → apply_calibration.bat on the lab PC (U11, server D42).
// Uses only GET /params, the stream and connect/estop. Nothing is written to the board.
"use strict";
const API = "/api/v1";
const $ = (id) => document.getElementById(id);
const MODS = [["A", "left"], ["B", "front"], ["C", "right"], ["D", "back"]];
const G = 9.81, AVG_MS = 2000, STORE = "bumpemCalibration";
let connected = false, state = null, ws = null, info = null, sensor = "A", busy = false;
let rows = [];            // {time, sensor, kind: "tare"|"point", mass_kg, raw_mean_n, raw_sd_n, samples, clipped_pct, tare_n, gain, offset}
let latest = {};          // last 0.5 s of raw readings per sensor (gain 1, offset 0), for the live value
let params = null, collect = null;

async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ? data.error.message : `HTTP ${r.status}`);
  return data;
}
function setText(id, text, bad) { const e = $(id); e.textContent = text; e.style.color = bad ? "var(--stop)" : ""; }
function save() { try { localStorage.setItem(STORE, JSON.stringify(rows)); } catch (e) { /* private window */ } }
function load() { try { rows = JSON.parse(localStorage.getItem(STORE) || "[]"); } catch (e) { rows = []; } }

// raw = what the sensor gives at gain 1, offset 0 (board: measured = raw · gain + offset)
function raw(m, c) { const g = params[`gain_${c}`] || 1, o = params[`offset_${c}`] || 0; return (m - o) / g; }
function tareOf(c) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].sensor === c && rows[i].kind === "tare") return rows[i].raw_mean_n; return null; }

// ---------------------------------------------------------------- fit (same as scripts/apply_calibration.py)
const saturated = (p) => p.raw_mean_n >= 0.995 * (p.f_full || 200);   // ADC full scale: the sensor reads no more
function fit(c) {   // least squares through the tara (close weights make a free fit unreliable, server D42)
  const pts = rows.filter((r) => r.sensor === c && r.kind === "point" && !saturated(r));
  if (!pts.length) return null;
  const net = pts.map((p) => p.raw_mean_n - p.tare_n), y = pts.map((p) => p.mass_kg * G);
  const gain = net.reduce((a, x, i) => a + x * y[i], 0) / net.reduce((a, x) => a + x * x, 0);
  const worst = Math.max(...net.map((x, i) => Math.abs(gain * x - y[i])));
  return { n: pts.length, gain, worst, one: new Set(pts.map((p) => p.mass_kg)).size < 2 };
}

// ---------------------------------------------------------------- render
function render() {
  $("sensors").innerHTML = MODS.map(([m, side]) =>
    `<label><input type="radio" name="sensor" value="${m}" ${m === sensor ? "checked" : ""}> <b style="color:var(--ch-${m})">${m}</b> <span class="muted">${side}</span></label>`).join("");
  document.querySelectorAll("input[name=sensor]").forEach((e) => { e.onchange = () => { sensor = e.value; render(); }; });
  const t = tareOf(sensor);
  setText("tare", t === null ? "no tara yet for " + sensor : `tara ${sensor}: ${t.toFixed(2)} N raw`);
  $("summary").innerHTML = MODS.map(([m]) => {
    const f = fit(m);
    if (!f) return `<tr><td><b style="color:var(--ch-${m})">${m}</b></td><td>0</td><td>—</td><td>—</td><td class="muted small">${tareOf(m) === null ? "" : "tara only"}</td></tr>`;
    const out = f.gain < 0.5 || f.gain > 3;
    const note = out ? "outside 0.5–3: firmware refuses it" : f.one ? "one weight only: add more" : f.n < 3 ? "add a third weight" : "";
    return `<tr><td><b style="color:var(--ch-${m})">${m}</b></td><td>${f.n}</td><td>${f.gain.toFixed(3)}</td><td>${f.worst.toFixed(2)}</td><td class="small" style="color:${out ? "var(--stop)" : "var(--muted)"}">${note}</td></tr>`;
  }).join("");
  $("points").innerHTML = rows.slice().reverse().map((r) => {
    const exp = r.kind === "point" ? r.mass_kg * G : 0, net = r.raw_mean_n - (r.kind === "point" ? r.tare_n : r.raw_mean_n);
    return `<tr><td class="small">${r.time.slice(11, 19)}</td><td>${r.sensor}</td><td>${r.kind === "tare" ? "tara" : r.mass_kg}</td>` +
      `<td>${r.kind === "point" ? exp.toFixed(2) : "—"}</td><td>${r.kind === "point" ? net.toFixed(2) : r.raw_mean_n.toFixed(2) + " raw"}</td>` +
      `<td>${r.kind === "point" && net > 0 ? (exp / net).toFixed(3) : "—"}</td><td>${r.raw_sd_n.toFixed(2)}</td>` +
      `<td class="small" style="color:var(--warn)">${r.clipped_pct > 5 ? `${r.clipped_pct.toFixed(0)} % at 0 N` : ""}</td></tr>`;
  }).join("");
  updateButtons();
}
function showLive() {
  const b = latest[sensor], v = b && b.length ? b.reduce((x, y) => x + y) / b.length : undefined;
  if (v === undefined || !params) { $("live").textContent = connected ? "waiting for readings…" : "not connected"; return; }
  const t = tareOf(sensor);
  $("live").textContent = t === null ? `${sensor}: ${v.toFixed(2)} N raw` : `${sensor}: ${(v - t).toFixed(2)} N after tara  ≈ ${((v - t) / G).toFixed(2)} kg (raw gain 1, 0.5 s mean)`;
}
function updateButtons() {
  const ok = connected && params && (state === "DISARMED" || state === "ESTOP") && !busy;
  $("btn-tare").disabled = !ok;
  $("btn-point").disabled = !ok || tareOf(sensor) === null;
  $("btn-csv").disabled = !rows.length;
  $("btn-undo").disabled = !rows.length || busy;
  $("btn-clear").disabled = !rows.length || busy;
  setText("point-note", connected && state && state !== "DISARMED" && state !== "ESTOP" ? `board is ${state}: Release first (motors must not drive)` : "",
    connected && state && state !== "DISARMED" && state !== "ESTOP");
}

// ---------------------------------------------------------------- averaging
async function average(kind) {
  busy = true; updateButtons();
  try {
    params = await api("GET", "/params");                    // gains/offsets as they are now
    const c = sensor, mass = parseFloat($("mass").value);
    if (kind === "point" && !(mass > 0)) throw new Error("enter the weight in kg");
    setText("point-note", "averaging 2 s: keep it still…");
    const v = await new Promise((resolve) => { collect = { c, v: [] }; setTimeout(() => { const r = collect.v; collect = null; resolve(r); }, AVG_MS); });
    if (v.length < 50) throw new Error(`only ${v.length} readings in 2 s: connection?`);
    if (state !== "DISARMED" && state !== "ESTOP") throw new Error(`board became ${state}: discarded`);
    const mean = v.reduce((a, b) => a + b) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    if (mean >= 0.995 * params.f_full)
      throw new Error(`${c} is at full scale (${params.f_full} N raw): the sensor cannot read this weight. Use a lighter one.`);
    if (kind === "point" && mean - tareOf(c) < 0.15 * mass * G)   // even a 200 kg cell at gain 1 shows ~1/3 of the force
      throw new Error(`${c} shows only ${(mean - tareOf(c)).toFixed(1)} N for ${mass} kg: weight on sensor ${c}? Point not recorded.`);
    rows.push({ time: new Date().toISOString(), sensor: c, kind, mass_kg: kind === "point" ? mass : 0, raw_mean_n: mean, raw_sd_n: sd,
      samples: v.length, clipped_pct: 100 * v.filter((x) => x <= 0.001).length / v.length, tare_n: kind === "point" ? tareOf(c) : mean,
      gain: params[`gain_${c}`], offset: params[`offset_${c}`], f_full: params.f_full });
    save();
    setText("point-note", kind === "tare" ? `tara ${c} set` : `${mass} kg on ${c} recorded`);
  } catch (e) { setText("point-note", e.message, true); }
  finally { busy = false; render(); }
}

// ---------------------------------------------------------------- CSV
function csvText() {
  const head = ["time", "sensor", "kind", "mass_kg", "expected_n", "raw_mean_n", "raw_sd_n", "samples", "clipped_pct", "tare_n",
    "net_n", "board_gain", "board_offset", "f_full", "g", "fw", "port"];
  const lines = [head.join(",")].concat(rows.map((r) => [r.time, r.sensor, r.kind, r.mass_kg, (r.mass_kg * G).toFixed(3), r.raw_mean_n.toFixed(4),
    r.raw_sd_n.toFixed(4), r.samples, r.clipped_pct.toFixed(1), r.tare_n.toFixed(4), (r.raw_mean_n - r.tare_n).toFixed(4), r.gain, r.offset,
    r.f_full, G, info && info.board ? info.board.fw : "", info ? info.port || "" : ""].join(",")));
  return lines.join("\r\n") + "\r\n";
}
function csv() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "_");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csvText()], { type: "text/csv" }));
  a.download = `calibration_${stamp}.csv`;
  a.click();
  setText("csv-note", `saved as ${a.download} (browser's download folder)`);
}

// ---------------------------------------------------------------- connection, stream, stop
function openStream() {
  if (ws) return;
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/stream?telemetry_hz=1000`);   // every board sample
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "telemetry") {
      if (m.state !== state) { state = m.state; setText("board-state", state || "—"); updateButtons(); }
      if (!params) return;
      for (const [c] of MODS) {
        if (m.measured[c] === undefined) continue;
        const v = raw(m.measured[c], c), b = latest[c] || (latest[c] = []);
        b.push(v); if (b.length > 50) b.shift();
        if (collect && collect.c === c) collect.v.push(v);
      }
    } else if (m.type === "event" && m.kind === "STATE") { state = m.args[0]; setText("board-state", state); updateButtons(); }
  };
  ws.onclose = () => { ws = null; if (connected) setTimeout(openStream, 1000); };
}
async function setConnected(i) {
  info = i; connected = !!(i && i.port);
  setText("conn-state", connected ? `${i.port} · fw ${i.board ? i.board.fw : "?"}` : "not connected");
  $("conn-state").classList.toggle("ok", connected);
  $("btn-connect").textContent = connected ? "Disconnect" : "Connect";
  if (connected) { $("port").value = i.port; params = await api("GET", "/params"); openStream(); } else { params = null; latest = {}; state = null; setText("board-state", "—"); }
  render();
}
async function connectToggle() {
  const btn = $("btn-connect");
  btn.disabled = true;
  try {
    if (connected) { await api("POST", "/disconnect"); await setConnected(null); }
    else { setText("conn-state", "connecting…"); await setConnected(await api("POST", "/connect", { port: $("port").value })); }
  } catch (e) { setText("conn-state", e.message, true); }
  finally { btn.disabled = false; }
}
function stop() { fetch(API + "/estop", { method: "POST" }).catch(() => {}); }

async function init() {
  load();
  $("btn-connect").onclick = connectToggle; $("btn-stop").onclick = stop;
  $("btn-tare").onclick = () => average("tare"); $("btn-point").onclick = () => average("point");
  $("btn-csv").onclick = csv;
  $("btn-undo").onclick = () => { rows.pop(); save(); render(); };
  $("btn-clear").onclick = () => { if (confirmClear()) { rows = []; save(); render(); } };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
  try {
    const ports = await api("GET", "/ports");
    $("port").innerHTML = '<option value="sim">simulator</option>' + ports.map((p) => `<option>${p}</option>`).join("");
  } catch (e) { /* keep the simulator */ }
  try { const i = await api("GET", "/info"); if (i.port) await setConnected(i); } catch (e) { /* server down */ }
  render();
  setInterval(showLive, 200);
}
function confirmClear() {   // two clicks instead of a browser dialog
  const b = $("btn-clear");
  if (b.dataset.armed) { delete b.dataset.armed; b.textContent = "Clear all"; return true; }
  b.dataset.armed = "1"; b.textContent = "Click again to clear"; setTimeout(() => { delete b.dataset.armed; b.textContent = "Clear all"; }, 3000);
  return false;
}
init();
