// Bump'em browser UI. Talks only to the server API (BumpemServer/docs/API.md, 1.0-draft), same origin.
"use strict";
const API = "/api/v1";
const MODS = ["A", "B", "C", "D"];
const $ = (id) => document.getElementById(id);
const S = { connected: false, state: null, geometry: null, params: null, angle: 180, cycle: 20, ws: null, hist: [] };

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
  try {
    if (S.connected) { await api("POST", "/disconnect"); setConnected(null); return; }
    const info = await api("POST", "/connect", { port: $("port").value });
    setConnected(info);
  } catch (e) { note("conn-state", e.message, true); }
}
async function setConnected(info) {
  S.connected = !!(info && info.port);
  $("conn-state").textContent = S.connected ? `${info.port} · fw ${info.board ? info.board.fw : "?"}` : "not connected";
  $("conn-state").classList.toggle("ok", S.connected);
  $("btn-connect").textContent = S.connected ? "Disconnect" : "Connect";
  if (S.connected) { await refresh(); openStream(); } else { closeStream(); S.state = null; S.geometry = null; S.params = null; drawDial(); }
  updateButtons();
}
async function refresh() {
  try {
    const [st, geo, par] = await Promise.all([api("GET", "/status"), api("GET", "/geometry"), api("GET", "/params")]);
    setState(st.state); S.geometry = geo; S.params = par;
    fillParams(); drawDial(); checkAngle();
  } catch (e) { note("params-note", e.message, true); }
}

// ---------------------------------------------------------------- live stream
function openStream() {
  closeStream();
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/stream?telemetry_hz=30`);
  S.ws = ws;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "telemetry") {
      if (m.state !== S.state) setState(m.state);
      S.hist.push(m);
      const cut = m.t_ms - 10000;
      while (S.hist.length && (S.hist[0].t_ms < cut || S.hist[0].t_ms > m.t_ms)) S.hist.shift();
    } else if (m.type === "event" && m.kind === "STATE") {
      setState(m.args[0]);
    }
  };
  ws.onclose = () => { if (S.ws === ws && S.connected) setTimeout(openStream, 1000); };
}
function closeStream() { if (S.ws) { const w = S.ws; S.ws = null; w.close(); } }
function setState(st) {
  const changed = st !== S.state;
  S.state = st;
  const el = $("board-state");
  el.textContent = st || "—"; el.className = `pill state ${st || ""}`;
  updateButtons();
  if (changed && st === "DISARMED" && S.connected) refresh();
}
function updateButtons() {
  const armed = S.state === "ARMED";
  $("btn-arm").disabled = !(S.connected && (S.state === "DISARMED" || S.state === "ESTOP"));   // ARM also recovers from ESTOP (PROTOCOL.md)
  $("btn-release").disabled = !(S.connected && (armed || S.state === "FAULT"));
  $("btn-perturb").disabled = !(S.connected && armed && angleReachable(S.angle) !== false);
  $("btn-apply").disabled = !S.connected;
  $("btn-clear").hidden = !(S.connected && S.state === "FAULT");
}

// ---------------------------------------------------------------- actions
async function arm() { try { await api("POST", "/arm"); } catch (e) { note("pert-result", e.message, true); } }
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
async function perturb() {
  const body = { angle_deg: S.angle };
  for (const k of ["amplitude_n", "phase1_ms", "dur_ms", "phase2_ms", "delay_ms"]) body[k] = parseFloat($(k).value);
  try {
    const r = await api("POST", "/perturbation", body);
    note("pert-result", `pulse ${r.pulse_id}: ` + Object.entries(r.amps).map(([m, v]) => `${m} +${v} N`).join(", "));
  } catch (e) { note("pert-result", e.message, true); }
}

// ---------------------------------------------------------------- board settings
function fillParams() {
  const p = S.params || {};
  $("p-baseline_n").value = p.baseline_n ?? ""; $("p-fmax_n").value = p.fmax_n ?? "";
  $("chans").innerHTML = MODS.map((m) => {
    const name = { A: "left", B: "front", C: "right", D: "back" }[m];
    return `<label><input type="checkbox" id="ch-${m}" ${p[`ch_${m}`] >= 1 ? "checked" : ""}> ${m} <span class="muted">${name}</span></label>`;
  }).join("");
  renderLegend();
}
async function applyParams() {
  const p = S.params || {}, patch = {};
  for (const k of ["baseline_n", "fmax_n"]) { const v = parseFloat($(`p-${k}`).value); if (!isNaN(v) && v !== p[k]) patch[k] = v; }
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

// ---------------------------------------------------------------- gait phase (PTO)
function setCycle(pct) {
  S.cycle = Math.min(99.9, Math.max(0, pct)); $("cycle_pct").value = S.cycle; Gait.set(S.cycle);
  const phase = Gait.phaseOf(S.cycle);
  const where = S.cycle < 40 ? `${(S.cycle / 0.4).toFixed(1)} % into stance` : phase;
  $("pto-text").textContent = `${where} · pto {"mode": "cycle_pct", "value": ${S.cycle}}`;
}

// ---------------------------------------------------------------- live plot
function renderLegend() {
  const on = MODS.filter((m) => !S.params || S.params[`ch_${m}`] >= 1);
  $("legend").innerHTML = on.map((m) => `<span><b style="color:var(--ch-${m})">■ ${m}</b> <span id="lv-${m}">—</span></span>`).join("") +
    '<span>solid measured · dashed target</span>';
}
function drawPlot() {
  const c = $("plot"), g = c.getContext("2d"), W = c.width, H = c.height;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const h = S.hist, on = MODS.filter((m) => !S.params || S.params[`ch_${m}`] >= 1);
  let fmax = 20;
  for (const s of h) for (const m of on) fmax = Math.max(fmax, s.target[m] || 0, s.measured[m] || 0);
  fmax = Math.ceil(fmax * 1.15 / 10) * 10;
  g.strokeStyle = "#1a201d"; g.fillStyle = "#8b9690"; g.font = "11px monospace"; g.lineWidth = 1;
  for (let f = 0; f <= fmax; f += fmax / 4) {
    const y = H - 18 - (H - 30) * f / fmax; g.beginPath(); g.moveTo(36, y); g.lineTo(W, y); g.stroke(); g.fillText(f.toFixed(0), 4, y + 4);
  }
  g.fillText("N", 4, 12); g.fillText("last 10 s", W - 64, H - 4);
  if (h.length > 1) {
    const t1 = h[h.length - 1].t_ms, X = (t) => 36 + (W - 40) * (1 - (t1 - t) / 10000), Y = (f) => H - 18 - (H - 30) * f / fmax;
    for (const m of on) {
      const col = getComputedStyle(document.documentElement).getPropertyValue(`--ch-${m}`).trim();
      for (const [key, dash] of [["target", [5, 4]], ["measured", []]]) {
        g.strokeStyle = col; g.setLineDash(dash); g.lineWidth = key === "measured" ? 1.8 : 1.2; g.beginPath();
        h.forEach((s, i) => { const x = X(s.t_ms), y = Y(s[key][m] || 0); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
      }
      g.setLineDash([]);
      const last = h[h.length - 1], lv = $(`lv-${m}`);
      if (lv) lv.textContent = `${(last.measured[m] || 0).toFixed(1)} / ${(last.target[m] || 0).toFixed(1)} N`;
    }
  }
  requestAnimationFrame(drawPlot);
}

// ---------------------------------------------------------------- wiring
function init() {
  $("btn-connect").onclick = connectToggle;
  $("btn-arm").onclick = arm; $("btn-clear").onclick = clearFault; $("btn-release").onclick = release; $("btn-stop").onclick = stop;
  $("btn-perturb").onclick = perturb; $("btn-apply").onclick = applyParams;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
  $("angle").addEventListener("change", () => setAngle(parseFloat($("angle").value) || 0, false));
  for (const k of ["amplitude_n", "phase1_ms", "dur_ms", "phase2_ms", "delay_ms"]) $(k).addEventListener("input", drawProfile);
  $("cycle_pct").addEventListener("change", () => setCycle(parseFloat($("cycle_pct").value) || 0));
  Gait.init($("gait"), setCycle);
  setCycle(S.cycle); drawProfile(); drawDial(); renderLegend(); updateButtons(); requestAnimationFrame(drawPlot);
  loadPorts();
  api("GET", "/info").then((info) => { if (info.port) setConnected(info); }).catch(() => note("conn-state", "server not reachable", true));
}
init();
