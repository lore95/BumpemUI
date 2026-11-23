// Gait check (U29, server D58): live touch-down / foot-off / phase moments from the plates (POST /gaitcheck), a server
// clock for reading in a high-speed video of the participant and the screen, events list + CSV. No board, no pulls.
"use strict";
const API = "/api/v1";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SIDES = ["left", "right"];
const SHOWN = 40, KEPT = 20000;   // rows in the table / in the CSV

let ws = null, running = false, recording = false, rows = [], lagWin = [], offset = null;
const contactTimer = {};

async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ? data.error.message : `HTTP ${r.status}`);
  return data;
}
function say(text, bad) { const e = $("msg"); e.textContent = text; e.style.color = bad ? "var(--stop)" : ""; }

// --- server clock: browser time − the smallest (browser − server) gap seen in the stream's host_s / sent_pc (≈ 1 ms) ---
function clockSample(serverS) {
  lagWin.push(performance.now() / 1000 - serverS);
  if (lagWin.length > 300) lagWin.shift();
  offset = Math.min(...lagWin);
}
const serverNow = () => (offset == null ? null : performance.now() / 1000 - offset);
function tick() {
  const t = serverNow();
  $("clock").textContent = t == null ? "–" : t.toFixed(3);
  requestAnimationFrame(tick);
}

// --- form ---
function body() {
  return { mode: $("mode").value, mass_kg: parseFloat($("mass").value), trigger_side: $("side").value,
    gait_phase_pct: parseFloat($("pct").value), gait_phase_of: $("of").value };
}
function fill(s) {
  $("mode").value = s.mode; $("mass").value = s.mass_kg; $("side").value = s.trigger_side;
  $("pct").value = s.gait_phase_pct; $("of").value = s.gait_phase_of;
}
async function fromStudy() {
  try {
    const st = await api("GET", "/study");
    if (st.state === "none") return;
    const p = await api("GET", "/study/protocol"), k = st.next_block, b = p.blocks[k - 1];   // the block Start would run
    fill({ mode: p.subject.mode, mass_kg: p.subject.mass_kg, trigger_side: b.trigger_side, gait_phase_pct: b.gait_phase_pct, gait_phase_of: b.gait_phase_of });
    $("from-study").textContent = `filled from study ${p.subject.subject_id || "(no ID)"}, block ${k}${b.label ? ` (${b.label})` : ""}`;
  } catch (e) { /* no study */ }
}

function setRunning(on, s) {
  running = on;
  $("btn-start").textContent = on ? "Restart check" : "Start check";
  $("btn-end").disabled = !on;
  const pill = $("check-state");
  pill.textContent = on ? `checking · ${s.mode} · ${s.detector === "sum" ? "both belts summed" : "per plate"}` : "not running";
  pill.classList.toggle("ok", on);
  if (!on) SIDES.forEach((k) => $(`foot-${k}`).classList.remove("on"));
}
function summary(s) {
  if (!s || s.left === undefined) return;
  const th = s.thresholds, side = (k) => s[k].stride_ms == null ? `${k}: –`
    : `${k}: stride ${s[k].stride_ms} ms (sd ${s[k].stride_sd_ms}, n ${s[k].n}), contact ${s[k].contact_ms ?? "–"} ms`;
  const thr = s.detector === "sum" ? `both belts summed, ${th.left.td_n} / ${th.left.fo_n} N (25 / 10 % body weight)`
    : s.fitted ? `per plate, left ${th.left.td_n} / ${th.left.fo_n} N, right ${th.right.td_n} / ${th.right.fo_n} N (from the first 10 s)`
      : "per plate, 100 / 25 N until 10 s of walking set the plates' own";
  $("summary").textContent = `${s.steps} steps · ${side("left")} · ${side("right")} · thresholds: ${thr}.` + (s.message ? ` ${s.message}` : "");
}

// --- live items ---
function show(m) {
  const now = serverNow(), lag = now == null ? null : Math.round((now - m.t_pc) * 1000);
  rows.push({ ...m, shown_after_ms: lag });
  if (rows.length > KEPT) rows.shift();
  $("btn-csv").disabled = false;
  if (m.event === "TD") {
    const f = $(`foot-${m.side}`);
    f.classList.add("on");
    clearTimeout(contactTimer[m.side]);
    contactTimer[m.side] = setTimeout(() => f.classList.remove("on"), 2000);   // a lost foot-off
    $(`info-${m.side}`).textContent = `step ${m.step}` + (m.stride_ms != null ? ` · stride ${m.stride_ms} ms` : "");
  } else if (m.event === "FO") {
    $(`foot-${m.side}`).classList.remove("on");
    clearTimeout(contactTimer[m.side]);
    $(`info-${m.side}`).textContent += ` · contact ${m.contact_ms} ms`;
  } else if (m.event === "PHASE") {
    const p = $("phase");
    p.textContent = `PHASE ${m.side.toUpperCase()} · ${m.phase_ms} ms${m.next_contact ? " (next contact)" : ""}`;
    p.className = `gc-phase on ${m.side}`;
    setTimeout(() => { p.className = "gc-phase"; }, 150);
  }
  const tr = document.createElement("tr");
  tr.className = `ev-${m.event.toLowerCase()} ${m.side}`;
  tr.innerHTML = [m.t_pc.toFixed(3), m.event, m.side, m.step ?? "", m.contact_ms ?? "", m.stride_ms ?? "", m.phase_ms ?? "", lag ?? ""]
    .map((x) => `<td>${esc(x)}</td>`).join("");
  const tb = $("events");
  tb.prepend(tr);
  while (tb.rows.length > SHOWN) tb.deleteRow(-1);
}
function openStream() {
  if (ws) return;
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/stream?telemetry_hz=60`);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "vicon") clockSample(m.host_s);
    if (m.type !== "gaitcheck") return;
    if (m.sent_pc != null) clockSample(m.sent_pc);
    if (m.event === "STATUS") { setRunning(m.running, m); summary(m); if (!m.running && m.message) say(`Check stopped: ${m.message}`, true); return; }
    show(m);
  };
  ws.onclose = () => { ws = null; setTimeout(openStream, 1000); };
}

// --- buttons ---
$("btn-start").onclick = async () => {
  const b = body();
  if (!(b.mass_kg > 0)) { say("Enter the body mass.", true); return; }
  try {
    if ($("rec").checked && !recording) {
      try { await api("POST", "/log/start", { label: "gaitcheck" }); recording = true; }
      catch (e) { say(`Not recording: ${e.message}. The check runs anyway; use Download events.`, true); }
    }
    const s = await api("POST", "/gaitcheck", b);
    rows = []; $("events").innerHTML = "";
    setRunning(true, s); summary(s);
    if (!recording || !$("rec").checked) say(b.mode === "walking" ? "Walk for 10 s first: the plates' thresholds are set from it." : "Running: steps on both belts summed.");
    else say("Recording. Stop check also stops the recording.");
  } catch (e) { say(e.message, true); }
};
$("btn-end").onclick = async () => {
  try {
    const s = await api("DELETE", "/gaitcheck");
    setRunning(false, s); summary(s);
    let note = "Check stopped.";
    if (recording) { const r = await api("POST", "/log/stop"); recording = false; note += ` Recording saved: ${r.events_file || r.file}`; }
    say(note);
  } catch (e) { say(e.message, true); }
};
$("btn-csv").onclick = () => {
  const cols = ["t_pc", "event", "side", "step", "contact_ms", "stride_ms", "phase_ms", "next_contact", "sent_pc", "shown_after_ms"];
  const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => r[c] ?? "").join(","))).join("\n") + "\n";
  const a = document.createElement("a");
  const d = new Date(), p2 = (x) => String(x).padStart(2, "0");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `gaitcheck_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};
const stop = () => fetch(API + "/estop", { method: "POST" }).catch(() => {});
$("btn-stop").onclick = stop;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });

(async () => {
  openStream();
  requestAnimationFrame(tick);
  try {
    const s = await api("GET", "/gaitcheck");
    if (s.running) { fill(s); setRunning(true, s); summary(s); return; }
  } catch (e) { /* server down: alerts.js says so */ }
  fromStudy();
})();
setInterval(async () => { if (running) { try { summary(await api("GET", "/gaitcheck")); } catch (e) { /* retry */ } } }, 2000);
