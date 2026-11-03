// Bump'em browser UI. Talks only to the server API (BumpemServer/docs/API.md, 1.0-draft), same origin.
"use strict";
const API = "/api/v1";
const MODS = ["A", "B", "C", "D"];
const $ = (id) => document.getElementById(id);
const S = { connected: false, state: null, geometry: null, params: null, angle: 180, ws: null, hist: [], recording: false, logTimer: null, vhist: [], vicon: null };

// ---------------------------------------------------------------- API
async function api(method, path, body) {
  const r = await fetch(API + path, {
    method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ? `${data.error.code}: ${data.error.message}` : `HTTP ${r.status}`);
  return data;
}
function note(id, text, bad) { const e = $(id); e.textContent = text; e.style.color = bad ? "var(--stop)" : ""; }

// ---------------------------------------------------------------- connection
async function loadPorts() {
  try {
    const ports = await api("GET", "/ports");
    $("port").innerHTML = '<option value="sim">simulator</option>' + ports.map((p) => `<option>${p}</option>`).join("");
  } catch (e) { /* server without serial support: keep the simulator */ }
}
async function connectToggle() {
  const btn = $("btn-connect");
  if (btn.disabled) return;
  btn.disabled = true;                 // one request at a time: a double click must not connect twice
  try {
    if (S.connected) { await api("POST", "/disconnect"); await setConnected(null); return; }
    note("conn-state", "connecting…");
    const info = await api("POST", "/connect", { port: $("port").value });
    await setConnected(info);
  } catch (e) { note("conn-state", e.message, true); }
  finally { btn.disabled = false; }
}
async function setConnected(info) {
  S.connected = !!(info && info.port);
  $("conn-state").textContent = S.connected ? `${info.port} · fw ${info.board ? info.board.fw : "?"}` : "not connected";
  $("conn-state").classList.toggle("ok", S.connected);
  $("btn-connect").textContent = S.connected ? "Disconnect" : "Connect";
  if (S.connected) await refresh(); else { S.state = null; S.geometry = null; S.params = null; S.hist = []; drawDial(); renderLegend(); checkDefaults(); }
  updateButtons();
}
async function refresh() {
  try {
    const [st, geo, par] = await Promise.all([api("GET", "/status"), api("GET", "/geometry"), api("GET", "/params")]);
    setState(st.state); S.geometry = geo; S.params = par;
    fillParams(); drawDial(); checkAngle();
  } catch (e) { note("params-note", e.message, true); if (!S.state) setState(null); }
  loadSettings(); loadLog();
}

// ---------------------------------------------------------------- live stream (always open: Vicon works without a board)
function openStream() {
  closeStream();
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/stream?telemetry_hz=20`);   // 20 Hz: each point = median of 5 board samples (server)
  S.ws = ws;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "telemetry") {
      if (m.state !== S.state) setState(m.state);
      S.hist.push(m);
      const cut = m.t_ms - 10000;
      while (S.hist.length && (S.hist[0].t_ms < cut || S.hist[0].t_ms > m.t_ms)) S.hist.shift();
    } else if (m.type === "vicon") {
      S.vhist.push(m);
      const cut = m.host_s - 10;
      while (S.vhist.length && (S.vhist[0].host_s < cut || S.vhist[0].host_s > m.host_s)) S.vhist.shift();
    } else if (m.type === "event" && m.kind === "STATE") {
      setState(m.args[0]);
    } else if (m.type === "event" && m.kind === "RESTART") {   // server: board reset to firmware defaults, saved ones re-sent
      note("params-note", `Board restarted: ${m.args[0]}.`, m.args[0] !== "settings applied");
      refresh();
    }
  };
  ws.onclose = () => { if (S.ws === ws) setTimeout(openStream, 1000); };
}
function closeStream() { if (S.ws) { const w = S.ws; S.ws = null; w.close(); } }
function setState(st) {
  const changed = st !== S.state;
  S.state = st;
  const el = $("board-state");
  el.textContent = st || (S.connected ? "no data" : "—"); el.className = `pill state ${st || (S.connected ? "FAULT" : "")}`;
  updateButtons();
  if (changed && st === "DISARMED" && S.connected) refresh();
}
function updateButtons() {
  const armed = S.state === "ARMED";
  $("btn-arm").disabled = !(S.connected && (S.state === "DISARMED" || S.state === "ESTOP"));   // ARM also recovers from ESTOP (PROTOCOL.md)
  $("btn-release").disabled = !(S.connected && (armed || S.state === "FAULT"));
  $("btn-perturb").disabled = !(S.connected && armed && angleReachable(S.angle) !== false);
  $("btn-apply").disabled = !S.connected;
  const idle = S.connected && (S.state === "DISARMED" || S.state === "ESTOP");
  $("btn-zero").disabled = !idle; $("btn-save").disabled = !S.connected;
  const rec = $("btn-record");   // green Record once armed; blue Stop rec while recording (also after Release / STOP)
  rec.disabled = !(S.connected && (armed || S.recording)); rec.textContent = S.recording ? "Stop rec" : "Record";
  rec.classList.toggle("primary", !S.recording); rec.classList.toggle("recording", S.recording);
  $("btn-clear").hidden = !(S.connected && S.state === "FAULT");
}

// ---------------------------------------------------------------- actions
async function arm() {
  const last = S.hist[S.hist.length - 1];
  S.zero = last ? { ...last.measured } : null;        // sensor readings at Arm = zero for the live values
  try { await api("POST", "/arm"); } catch (e) { note("pert-result", e.message, true); return; }
  if (S.zero) note("pert-result", "Zero recorded at Arm: " + MODS.filter((m) => !S.params || S.params[`ch_${m}`] >= 1)
    .map((m) => `${m} ${S.zero[m].toFixed(1)} N`).join(", "));
}
async function clearFault() { try { await api("POST", "/clear"); note("pert-result", "cleared"); } catch (e) { note("pert-result", e.message, true); } }
async function release() {
  if (!confirm("Is the treadmill stopped?\n\nRelease ramps every rope to 0 N and switches the drivers off.")) return;
  try { await api("POST", "/release", { ms: 1000 }); } catch (e) { note("pert-result", e.message, true); }
}
function stop() {   // never asks: emergency
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type: "estop" }));
  fetch(API + "/estop", { method: "POST" }).catch(() => {});
  note("pert-result", "STOP sent: drivers off, ropes slack.", true);
}
function ampLimit() {   // largest amplitude the board accepts: baseline + amplitude <= fmax_n on the pulling rope
  const p = S.params || {};
  return p.fmax_n == null || p.baseline_n == null ? null : Math.max(0, p.fmax_n - p.baseline_n);
}
async function perturb() {
  const body = { angle_deg: S.angle };
  for (const k of ["amplitude_n", "phase1_ms", "dur_ms", "phase2_ms", "delay_ms"]) body[k] = parseFloat($(k).value);
  const ampMax = ampLimit();
  if (ampMax !== null && body.amplitude_n > ampMax) {
    note("pert-result", `Amplitude ${body.amplitude_n} N is above the limit ${ampMax} N (Max force ${S.params.fmax_n} − baseline ${S.params.baseline_n}). Raise Max force under Board settings.`, true);
    return;
  }
  try {
    const r = await api("POST", "/perturbation", body);
    note("pert-result", `pulse ${r.pulse_id}: ` + Object.entries(r.amps).map(([m, v]) => `${m} +${v} N`).join(", "));
  } catch (e) { note("pert-result", e.message, true); }
}

// ---------------------------------------------------------------- board settings
function fillParams() {
  const p = S.params || {};
  $("p-baseline_n").value = p.baseline_n ?? ""; $("p-fmax_n").value = p.fmax_n ?? ""; $("p-kff").value = p.kff ?? "";
  const ampMax = ampLimit();
  $("amp-max").textContent = ampMax === null ? "max ?" : `max ${ampMax} N (Max force − baseline)`;
  if (ampMax !== null) $("amplitude_n").max = ampMax;
  $("chans").innerHTML = MODS.map((m) => {
    const name = { A: "left", B: "front", C: "right", D: "back" }[m];
    return `<label><input type="checkbox" id="ch-${m}" ${p[`ch_${m}`] >= 1 ? "checked" : ""}> ${m} <span class="muted">${name}</span></label>`;
  }).join("");
  renderLegend();
}
async function applyParams() {
  const p = S.params || {}, patch = {};
  for (const k of ["baseline_n", "fmax_n", "kff"]) { const v = parseFloat($(`p-${k}`).value); if (!isNaN(v) && v !== p[k]) patch[k] = v; }
  for (const m of MODS) { const v = $(`ch-${m}`).checked ? 1 : 0; if (v !== (p[`ch_${m}`] >= 1 ? 1 : 0)) patch[`ch_${m}`] = v; }
  if (!Object.keys(patch).length) { note("params-note", "nothing changed"); return; }
  try { S.params = await api("PATCH", "/params", patch); note("params-note", "applied: " + Object.keys(patch).join(", ")); }
  catch (e) { note("params-note", e.message, true); }
  await refresh();
}

// ---------------------------------------------------------------- direction dial (Vicon axes, seen from above, front up)
const D = { cx: 170, cy: 170, r: 130 };
const NS = "http://www.w3.org/2000/svg";
const xy = (deg, r) => [D.cx - Math.sin(deg * Math.PI / 180) * r, D.cy - Math.cos(deg * Math.PI / 180) * r];
const norm = (a) => { let x = ((a % 360) + 360) % 360; return x > 180 ? x - 360 : x; };
function svgEl(name, attrs, parent) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; }
function arcPath(from, span, r) {
  if (span >= 359.9) return `M ${D.cx} ${D.cy - r} a ${r} ${r} 0 1 0 0.01 0`;
  const [x1, y1] = xy(from, r), [x2, y2] = xy(from + span, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 0 ${x2} ${y2}`;   // increasing angle = counter-clockwise on screen
}
function arcs() {
  const g = S.geometry;
  if (!g || !g.reachable) return null;
  return g.reachable.map(({ from_deg, to_deg }) => [from_deg, (((to_deg - from_deg) % 360) + 360) % 360 || (from_deg === -180 && to_deg === 180 ? 360 : 0)]);
}
function angleReachable(a) {   // true / false / null (unknown: not connected)
  const list = arcs();
  if (!list) return null;
  return list.some(([from, span]) => { const d = (((a - from) % 360) + 360) % 360; return span === 0 ? Math.min(d, 360 - d) < 0.5 : d <= span + 1e-6; });
}
function drawDial() {
  const svg = $("dial"); svg.innerHTML = "";
  svgEl("circle", { cx: D.cx, cy: D.cy, r: D.r, class: "dial-ring" }, svg);
  for (const [from, span] of arcs() || []) svgEl("path", { d: arcPath(span === 0 ? from - 3 : from, span === 0 ? 6 : span, D.r), class: "dial-reach" }, svg);
  for (let a = 0; a < 360; a += 15) {
    const [x1, y1] = xy(a, D.r + 13), [x2, y2] = xy(a, D.r + (a % 45 ? 17 : 21));
    svgEl("line", { x1, y1, x2, y2, class: "dial-tick" }, svg);
  }
  for (const [a, t] of [[0, "front 0°"], [90, "left +90°"], [180, "back 180°"], [-90, "right −90°"]]) {
    const [x, y] = xy(a, D.r + 33); svgEl("text", { x, y, class: "dial-label" }, svg).textContent = t;
  }
  const mods = (S.geometry && S.geometry.modules) || { A: { angle_deg: 90 }, B: { angle_deg: 0 }, C: { angle_deg: -90 }, D: { angle_deg: 180 } };
  for (const [m, info] of Object.entries(mods)) {
    const [x, y] = xy(info.angle_deg, D.r);
    const on = info.enabled;
    svgEl("text", { x, y, class: "dial-mod", fill: on === false ? "#4a524e" : `var(--ch-${m})` }, svg).textContent = m;
  }
  // subject, top view, facing up
  svgEl("ellipse", { cx: D.cx, cy: D.cy + 2, rx: 34, ry: 13, class: "dial-person" }, svg);
  svgEl("circle", { cx: D.cx, cy: D.cy - 2, r: 12, class: "dial-person" }, svg);
  svgEl("path", { d: `M ${D.cx - 5} ${D.cy - 12} L ${D.cx} ${D.cy - 20} L ${D.cx + 5} ${D.cy - 12}`, class: "dial-person" }, svg);
  // pull arrow
  const [ax1, ay1] = xy(S.angle, 40), [ax2, ay2] = xy(S.angle, D.r - 24);
  svgEl("line", { x1: ax1, y1: ay1, x2: ax2, y2: ay2, class: "dial-arrow" }, svg);
  const [hx, hy] = xy(S.angle, D.r - 8), [lx, ly] = xy(S.angle + 7, D.r - 28), [rx, ry] = xy(S.angle - 7, D.r - 28);
  svgEl("path", { d: `M ${hx} ${hy} L ${lx} ${ly} L ${rx} ${ry} Z`, class: "dial-head" }, svg);
  const hit = svgEl("circle", { cx: D.cx, cy: D.cy, r: D.r, class: "dial-hit" }, svg);
  const pick = (ev) => {
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const raw = Math.atan2(-(p.x - D.cx), -(p.y - D.cy)) * 180 / Math.PI;
    const step = ev.shiftKey ? 1 : 5;
    setAngle(norm(Math.round(raw / step) * step), true);
  };
  hit.addEventListener("pointerdown", (ev) => { hit.setPointerCapture(ev.pointerId); pick(ev); });
  hit.addEventListener("pointermove", (ev) => { if (ev.buttons) pick(ev); });
}
function setAngle(a, fromDial) {
  const ok = angleReachable(a);
  if (ok === false) { note("angle-note", `${a}° not reachable with the enabled modules`, true); if (fromDial) return; }
  S.angle = norm(a); $("angle").value = S.angle;
  if (ok !== false) checkAngle();
  drawDial(); updateButtons();
}
function checkAngle() {
  const ok = angleReachable(S.angle);
  note("angle-note", ok === null ? "connect to check reachability" : ok ? "" : `${S.angle}° not reachable with the enabled modules`, ok === false);
  updateButtons();
}

// ---------------------------------------------------------------- force profile preview
function drawProfile() {
  const svg = $("profile"); svg.innerHTML = "";
  const v = (k) => Math.max(0, parseFloat($(k).value) || 0);
  const amp = v("amplitude_n"), p1 = v("phase1_ms"), dur = Math.max(1, v("dur_ms")), p2 = v("phase2_ms"), del = v("delay_ms");
  const total = del + dur + 60, X = (t) => 10 + 340 * t / total, Y = (f) => 72 - 52 * (amp ? f / amp : 0);
  const bad = p1 + p2 > dur;
  const pts = [[0, 0], [del, 0], [del + p1, amp], [del + dur - p2, amp], [del + dur, 0], [total, 0]];
  svgEl("line", { x1: 10, y1: 72, x2: 350, y2: 72, stroke: "#262d2a" }, svg);
  svgEl("polyline", { points: pts.map(([t, f]) => `${X(t)},${Y(f)}`).join(" "), fill: "none", stroke: bad ? "var(--stop)" : "var(--accent)", "stroke-width": 2 }, svg);
  const t = svgEl("text", { x: 12, y: 86, fill: "#8b9690", "font-size": 10, "font-family": "monospace" }, svg);
  t.textContent = bad ? "phase 1 + phase 2 longer than the duration" : `baseline +${amp} N · ${dur} ms · start after ${del} ms`;
}

// ---------------------------------------------------------------- live plot
function renderLegend() {
  const on = MODS.filter((m) => !S.params || S.params[`ch_${m}`] >= 1);
  $("legend").innerHTML = on.map((m) => `<span><b style="color:var(--ch-${m})">■ ${m}</b> <span id="lv-${m}">—</span></span>`).join("") +
    '<span>solid measured (median of 5 samples, 50 ms) · dashed target · recording: raw 100 Hz</span>';
}
function fitCanvas(c) {   // draw in CSS pixels, sharp on any screen size
  const g = c.getContext("2d"), dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  return [g, W, H];
}
function axes(g, W, H, lo, hi, left) {   // 5 force gridlines (lo..hi N), time axis -10 s .. now; returns the y mapping
  const Y = (f) => H - 22 - (H - 44) * (f - lo) / (hi - lo);
  g.strokeStyle = "#1a201d"; g.fillStyle = "#8b9690"; g.font = "13px monospace"; g.lineWidth = 1; g.setLineDash([]);
  for (let i = 0; i <= 5; i++) {
    const f = lo + (hi - lo) * i / 5, y = Y(f);
    g.beginPath(); g.moveTo(left, y); g.lineTo(W, y); g.stroke(); g.fillText(f.toFixed(0), 4, y + 4);
  }
  for (let s = 0; s <= 10; s += 2) { const x = left + (W - left - 4) * (1 - s / 10); g.fillText(s ? `-${s} s` : "now", x - (s ? 14 : 28), H - 4); }
  g.fillText("N", 4, 14);
  return Y;
}
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function drawRope() {
  const [g, W, H] = fitCanvas($("plot")), L = 44;
  const h = S.hist, on = MODS.filter((m) => !S.params || S.params[`ch_${m}`] >= 1);
  let fmax = 20;
  for (const s of h) for (const m of on) fmax = Math.max(fmax, s.target[m] || 0, s.measured[m] || 0);
  fmax = Math.ceil(fmax * 1.15 / 10) * 10;
  const Y = axes(g, W, H, 0, fmax, L);
  if (h.length < 2) return;
  const t1 = h[h.length - 1].t_ms, X = (t) => L + (W - L - 4) * (1 - (t1 - t) / 10000);
  for (const m of on) {
    const col = color(`--ch-${m}`);
    for (const [key, dash] of [["target", [5, 4]], ["measured", []]]) {
      g.strokeStyle = col; g.setLineDash(dash); g.lineWidth = key === "measured" ? 2.2 : 1.4; g.beginPath();
      h.forEach((s, i) => { const x = X(s.t_ms), y = Y(s[key][m] || 0); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
    g.setLineDash([]);
    const last = h[h.length - 1], lv = $(`lv-${m}`);
    if (lv) {
      const meas = last.measured[m] || 0, dz = S.zero && S.state !== "DISARMED" ? ` (Δ ${(meas - (S.zero[m] || 0)).toFixed(1)})` : "";
      lv.textContent = `${meas.toFixed(1)}${dz} / ${(last.target[m] || 0).toFixed(1)} N`;
    }
  }
}
function drawGround() {
  const [g, W, H] = fitCanvas($("vplot")), L = 52;
  const h = S.vhist, plates = S.vicon ? S.vicon.plates : [];
  let dmin = 0, dmax = 100;   // Fz as Vicon sends it: the sign depends on the plate axes
  for (const s of h) for (const p of plates) { dmin = Math.min(dmin, s.fz[p] ?? 0); dmax = Math.max(dmax, s.fz[p] ?? 0); }
  if (dmin > -0.05 * dmax) dmin = 0;   // noise around 0 N: keep 0 at the bottom
  let step = Math.ceil((dmax - dmin) * 1.1 / 5 / 100) * 100, lo = Math.floor(dmin / step) * step;   // gridlines on whole 100 N
  while (lo + 5 * step < dmax) step += 100;
  const Y = axes(g, W, H, lo, lo + 5 * step, L);
  if (h.length < 2) return;
  const t1 = h[h.length - 1].host_s, X = (t) => L + (W - L - 4) * (1 - (t1 - t) / 10);
  plates.forEach((p, k) => {
    g.strokeStyle = color(`--plate-${k % 2}`); g.lineWidth = 2; g.beginPath();
    h.forEach((s, i) => { const x = X(s.host_s), y = Y(s.fz[p] ?? 0); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    const lv = $(`vv-${k}`);
    if (lv) lv.textContent = `${(h[h.length - 1].fz[p] ?? 0).toFixed(0)} N`;
  });
}
function drawPlot() {
  drawRope(); drawGround();
  requestAnimationFrame(drawPlot);
}

// ---------------------------------------------------------------- zero, saved defaults, recording (API.md "Saved settings", "Recording")
async function zeroSensors() {   // DISARMED / ESTOP only: mean of the last 2 s per enabled module → offset so it reads 0
  const p = S.params || {}, last = S.hist[S.hist.length - 1], recent = last ? S.hist.filter((h) => last.t_ms - h.t_ms <= 2000) : [];
  if (recent.length < 20) { note("params-note", "not enough live data yet (wait 2 s)", true); return; }
  const patch = {}, shown = [];
  for (const m of MODS) {
    if (!(p[`ch_${m}`] >= 1)) continue;
    const mean = recent.reduce((a, h) => a + (h.measured[m] || 0), 0) / recent.length;
    const off = Math.round(((p[`offset_${m}`] || 0) - mean) * 100) / 100;
    if (Math.abs(off) > 20) { note("params-note", `${m} rests at ${mean.toFixed(1)} N: beyond the ±20 N offset range. Check its sensor wiring.`, true); return; }
    patch[`offset_${m}`] = off; shown.push(`${m} ${mean.toFixed(1)} N → 0`);
  }
  if (!shown.length) { note("params-note", "no enabled module"); return; }
  try { S.params = await api("PATCH", "/params", patch); note("params-note", "zeroed: " + shown.join(", ") + ". Save as default to keep it."); checkDefaults(); }
  catch (e) { note("params-note", e.message, true); }
}
function showSettings(s) {
  S.saved = s; checkDefaults();
  if (!s.file) { note("settings-note", "Saved defaults are switched off on this server."); return; }
  if (!s.params) { note("settings-note", "No saved defaults yet: the board runs on its current values."); return; }
  const when = (s.saved || "").replace("T", " ");
  note("settings-note", s.pending ? `Defaults from ${when} wait until the board is DISARMED.`
    : s.message ? `Defaults from ${when} applied, except ${s.message}` : `Defaults saved ${when}: kff ${s.params.kff}, baseline ${s.params.baseline_n} N, max ${s.params.fmax_n} N.`,
    !!s.message);
}
function checkDefaults() {   // board running other values than the saved defaults (2026-11-03: a test ran on kff 7.5)
  const e = $("defaults-warning"), p = S.params, s = S.saved;
  let text = "";
  if (S.connected && p && s && s.file) {
    if (!s.params) text = `No saved defaults on this PC: the board runs on firmware values (kff ${p.kff}, baseline ${p.baseline_n} N). Set them under Board settings, Apply, then Save as default.`;
    else {
      const diff = Object.entries(s.params).filter(([k, v]) => k in p && Math.abs(p[k] - v) > 1e-4 * Math.max(1, Math.abs(v)))
        .map(([k, v]) => `${k} ${p[k]} (saved ${v})`);
      if (diff.length) text = `Board differs from the saved defaults: ${diff.join(", ")}. Keep these: Save as default. Back to the saved ones: Disconnect, Connect.`;
    }
  }
  e.textContent = text; e.hidden = !text;
}
async function loadSettings() { try { showSettings(await api("GET", "/settings")); } catch (e) { /* older server */ } }
async function saveDefaults() {
  try { showSettings(await api("POST", "/settings")); } catch (e) { note("settings-note", e.message, true); }
}
function showLog(l) {
  S.recording = !!l.recording;
  const name = (l.file || "").split(/[\\/]/).pop();
  const vic = l.vicon_file ? `, Vicon ${l.vicon_rows} rows` : ", no Vicon";
  note("log-note", l.recording ? `\u25cf Recording ${name}: ${l.rows} rows, ${l.duration_s.toFixed(1)} s${vic}`
    : l.file ? `Saved ${l.rows} rows (${l.duration_s.toFixed(1)} s)${vic}, also on the server PC at ${l.file}. Download: ` : "");
  $("log-note").style.color = l.recording ? "var(--rec)" : "";
  if (!l.recording && l.file) {
    const kinds = [["force", "force CSV"], ["events", "events CSV (settings, pulses sent)"]].concat(l.vicon_file ? [["vicon", "Vicon CSV"]] : []);
    kinds.forEach(([kind, text], i) => {
      const link = document.createElement("a"); link.href = `${API}/log/file?kind=${kind}`; link.download = ""; link.textContent = text;
      $("log-note").append(i ? " · " : "", link);
    });
  }
  clearInterval(S.logTimer); S.logTimer = l.recording ? setInterval(loadLog, 1000) : null;
  updateButtons();
}
async function loadLog() { try { const l = await api("GET", "/log"); if (l.recording || S.recording) showLog(l); } catch (e) { /* older server */ } }
function download(kind) {   // last finished recording, from the server (API.md "Recording")
  const a = document.createElement("a");
  a.href = `${API}/log/file?kind=${kind}`; a.download = ""; document.body.appendChild(a); a.click(); a.remove();
}
async function recordToggle() {
  try {
    if (S.recording) { showLog(await api("POST", "/log/stop")); download("force"); }
    else {
      const label = $("log-label").value.trim();
      if (!/^[A-Za-z0-9_-]{0,40}$/.test(label)) { note("log-note", "Label: letters, digits, _ and - only", true); return; }
      showLog(await api("POST", "/log/start", { label }));
    }
  } catch (e) { note("log-note", e.message, true); }
}

// ---------------------------------------------------------------- Vicon force plates (API.md "Vicon force plates")
function showVicon(v) {
  const plates = (S.vicon && S.vicon.plates || []).join();
  S.vicon = v;
  const host = $("vicon-host");
  if (!host.value && document.activeElement !== host) host.value = v.host || v.default_host || localGet("viconHost") || "";
  $("btn-vicon").textContent = v.connected ? "Disconnect" : "Connect";
  $("vicon-state").textContent = v.connected ? `${v.host} · ${Math.round(v.rate_hz)} Hz` : "not connected";
  $("vicon-state").classList.toggle("ok", v.connected);
  if (v.plates.join() !== plates)
    $("vlegend").innerHTML = v.plates.map((p, k) => `<span><b style="color:var(--plate-${k % 2})">■ ${p}</b> <span id="vv-${k}">—</span></span>`).join("") +
      (v.plates.length ? "<span>vertical force Fz</span>" : "");
  if (v.message) note("vicon-note", v.message, true);
  else note("vicon-note", v.connected ? "Recorded together with the rope forces (Record, top right)." : "Enter the Nexus PC address:port (or sim), then Connect.");
}
async function loadVicon() { try { showVicon(await api("GET", "/vicon")); } catch (e) { /* older server */ } }
async function viconToggle() {
  const btn = $("btn-vicon");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    if (S.vicon && S.vicon.connected) { showVicon(await api("POST", "/vicon/disconnect")); S.vhist = []; return; }
    const host = $("vicon-host").value.trim();
    note("vicon-note", `connecting to ${host}… (up to 5 s)`);
    showVicon(await api("POST", "/vicon/connect", { host }));
    localSet("viconHost", host);
  } catch (e) { note("vicon-note", e.message, true); }
  finally { btn.disabled = false; }
}
function localGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }

// ---------------------------------------------------------------- wiring
function init() {
  $("btn-connect").onclick = connectToggle;
  $("btn-arm").onclick = arm; $("btn-clear").onclick = clearFault; $("btn-release").onclick = release; $("btn-stop").onclick = stop;
  $("btn-perturb").onclick = perturb; $("btn-apply").onclick = applyParams;
  $("btn-zero").onclick = zeroSensors; $("btn-save").onclick = saveDefaults; $("btn-record").onclick = recordToggle;
  $("btn-vicon").onclick = viconToggle;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
  $("angle").addEventListener("change", () => setAngle(parseFloat($("angle").value) || 0, false));
  for (const k of ["amplitude_n", "phase1_ms", "dur_ms", "phase2_ms", "delay_ms"]) $(k).addEventListener("input", drawProfile);
  drawProfile(); drawDial(); renderLegend(); updateButtons(); requestAnimationFrame(drawPlot);
  loadPorts(); openStream(); loadVicon(); setInterval(loadVicon, 1000);
  api("GET", "/info").then((info) => {
    if (info.mode && info.mode !== "production") {
      const w = $("mode-warning"); w.hidden = false;
      w.textContent = `The server is in ${info.mode} mode: arming and perturbations are refused. Use the testing page (/ui/testing.html) or restart with  bumpem serve --production.`;
    }
    if (info.port) setConnected(info);
  }).catch(() => note("conn-state", "server not reachable", true));
}
init();
