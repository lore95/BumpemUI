// Delay test (U24): pulls A → B → C → D in rounds at each force (POST /pulse), records them, then GET /log/delay → report + feedback.
"use strict";
const API = "/api/v1";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MODS = [["A", "left"], ["B", "front"], ["C", "right"], ["D", "back"]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Rules of thumb for the feedback (U24), not limits: change them here when the lab knows better values.
const RULE = { ratioLow: 0.8, ratioHigh: 1.2, slowerFactor: 1.5, slowerMs: 10, spreadMs: 30, commandMs: 20, commandMaxMs: 50, noiseN: 1.5 };

let info = null, params = null, state = null, ws = null, running = false, cancel = false, lastRun = null;

async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ? data.error.message : `HTTP ${r.status}`);
  return data;
}
function say(text, bad) { const e = $("progress"); e.textContent = text; e.style.color = bad ? "var(--stop)" : ""; }

function settings() {
  const forces = $("forces").value.split(/[ ,;]+/).map(parseFloat).filter((x) => x > 0);
  return { towers: MODS.map(([m]) => m).filter((m) => $(`t-${m}`).checked), forces,
    rounds: parseInt($("rounds").value, 10) || 1, dur: parseFloat($("dur").value), ramp: parseFloat($("ramp").value), gap: parseFloat($("gap").value) };
}
function plan(s) {   // round by round: every force, every tower in turn
  const out = [];
  for (const f of s.forces) for (let r = 1; r <= s.rounds; r++) for (const m of s.towers) out.push({ tower: m, force: f, round: r });
  return out;
}
function showPlan() {
  const s = settings(), n = plan(s).length;
  $("plan").textContent = n ? `${n} pulls (${s.towers.join(" → ")} × ${s.forces.join(" / ")} N × ${s.rounds} rounds), about ${Math.ceil(n * (s.gap + s.dur) / 60000)} min.` : "Nothing to run: pick a tower and a force.";
}

function setState(st) {
  state = st;
  const el = $("board-state");
  el.textContent = st || "—"; el.className = `pill state ${st || ""}`;
  $("btn-arm").disabled = running || !info?.port || st === "ARMED";
}
function openStream() {
  if (ws) return;
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/stream?telemetry_hz=10`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.type === "telemetry" && m.state !== state) setState(m.state); };
  ws.onclose = () => { ws = null; setTimeout(openStream, 1000); };
}

async function loadBoard() {
  try {
    info = await api("GET", "/info");
    $("conn-state").textContent = info.port ? `${info.port} · fw ${info.board?.fw ?? "?"}` : "not connected: connect on the test page";
    $("conn-state").classList.toggle("ok", !!info.port);
    if (!info.port) { setState(null); return; }
    [params, state] = [await api("GET", "/params"), (await api("GET", "/status")).state];
    setState(state);
    const p = params;
    $("params").textContent = `Board parameters (check before Arm): baseline ${p.baseline_n} N · max force ${p.fmax_n} N · fault ${p.fault_n} N · kp ${p.kp_track} · kd ${p.kd_track} · kff ${p.kff}`
      + ` · channels on: ${MODS.map(([m]) => m).filter((m) => p[`ch_${m}`] >= 1).join(" ") || "none"}`;
    for (const [m] of MODS) { const c = $(`t-${m}`); c.disabled = !(p[`ch_${m}`] >= 1); if (c.disabled) c.checked = false; }
    showPlan();
  } catch (e) { $("conn-state").textContent = "server not reachable"; }
}

function stop() {
  cancel = true;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "estop" }));
  fetch(API + "/estop", { method: "POST" }).catch(() => {});
}
async function arm() {
  await loadBoard();   // re-read the parameters right before arming: a Teensy reset puts the firmware defaults back
  if (!confirm(`Arm with baseline ${params.baseline_n} N, max force ${params.fmax_n} N, kff ${params.kff}?\n\nRopes tensioned, nobody attached.`)) return;
  try { await api("POST", "/arm"); say("Armed."); } catch (e) { say(e.message, true); }
}

async function run() {
  const s = settings(), list = plan(s);
  if (!$("safe").checked) return say("Tick the safety line first.", true);
  if (!list.length) return say("Pick at least one tower and one force.", true);
  await loadBoard();
  if (!info.port) return say("No board connected.", true);
  if (state !== "ARMED") return say(`The board is ${state}: Arm first.`, true);
  const room = params.fmax_n - params.baseline_n;
  if (Math.max(...s.forces) > room) return say(`${Math.max(...s.forces)} N is above max force − baseline = ${room} N.`, true);
  if ((await api("GET", "/log")).recording) return say("A recording is running (another page?): stop it first.", true);

  running = true; cancel = false; $("btn-run").disabled = true; $("btn-cancel").disabled = false; $("btn-arm").disabled = true;
  const started = new Date(), sent = [], problems = [];
  try {
    await api("POST", "/log/start", { label: `delaytest_${s.towers.join("")}` });
    await sleep(1000);                                       // baseline before the first pull
    for (const [i, p] of list.entries()) {
      if (cancel) { problems.push(`Cancelled after ${i} of ${list.length} pulls.`); break; }
      if (state !== "ARMED") { problems.push(`Board left ARMED (${state}) after ${i} pulls: test stopped there.`); break; }
      say(`Pull ${i + 1} of ${list.length}: ${p.tower} ${p.force} N (round ${p.round})`);
      try {
        const r = await api("POST", "/pulse", { amps: { [p.tower]: p.force }, delay_ms: 0, rise_ms: s.ramp, dur_ms: s.dur, fall_ms: s.ramp });
        sent.push({ ...p, pulse_id: r.pulse_id });
      } catch (e) { problems.push(`${p.tower} ${p.force} N refused: ${e.message}`); }
      await sleep(s.dur + s.gap);
    }
  } catch (e) { problems.push(e.message); }
  try { await api("POST", "/log/stop"); } catch (e) { problems.push(`Stop rec: ${e.message}`); }
  running = false; $("btn-run").disabled = false; $("btn-cancel").disabled = true; setState(state);
  if (!sent.length) return say(problems.join(" ") || "No pull sent.", true);
  say("Analysing…");
  try {
    const rep = await api("GET", "/log/delay");
    lastRun = { s, sent, problems, started, rep, info, params };
    render(lastRun);
    say(`Done: ${sent.length} pulls. Report below; the text version is saved next to the recording (${rep.file}).`);
  } catch (e) { say(`Delay report: ${e.message}`, true); }
}

// ---------------------------------------------------------------- report
const med = (v) => { const a = v.filter((x) => x != null).sort((x, y) => x - y); if (!a.length) return null; const k = a.length >> 1; return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2; };
const vals = (rows, k) => rows.map((r) => r[k]).filter((x) => x != null);
const fmt = (x, d = 0) => x == null ? "–" : x.toFixed(d);
const range = (v, d = 0) => v.length ? `${fmt(Math.min(...v), d)}–${fmt(Math.max(...v), d)}` : "–";

function groups(run) {
  const byId = Object.fromEntries(run.rep.pulses.map((r) => [r.pulse_id, r]));
  const out = [];
  for (const m of run.s.towers) for (const f of run.s.forces) {
    const rows = run.sent.filter((p) => p.tower === m && p.force === f).map((p) => ({ ...p, ...(byId[p.pulse_id] || { note: "not in the report" }) }));
    if (!rows.length) continue;
    out.push({ m, f, rows, n: rows.length, command: med(vals(rows, "command_ms")), rise: med(vals(rows, "rise_ms")), riseV: vals(rows, "rise_ms"),
      lag: med(vals(rows, "lag_ms")), ratio: med(vals(rows, "ratio")), noise: med(vals(rows, "noise_sd_n")), seen: vals(rows, "rise_ms").length });
  }
  return out;
}

function feedback(run, G) {
  const fb = [], all = run.rep.pulses, cmd = vals(all, "command_ms");
  const cm = med(cmd), cmax = cmd.length ? Math.max(...cmd) : null;
  if (cm == null) fb.push(["bad", "No command time measured: the recording has no board start for the pulls."]);
  else if (cm > RULE.commandMs || cmax > RULE.commandMaxMs) fb.push(["bad", `USB + firmware is slow: median ${fmt(cm, 1)} ms, max ${fmt(cmax, 1)} ms. Try another USB port or cable, no hub; keep the USB cable away from the motor wires (timeouts seen 2026-10-06).`]);
  else fb.push(["ok", `USB + firmware: median ${fmt(cm, 1)} ms (max ${fmt(cmax, 1)} ms): fine.`]);
  const towerRise = {};
  for (const m of run.s.towers) towerRise[m] = med(G.filter((g) => g.m === m).flatMap((g) => g.riseV));
  const allRise = med(Object.values(towerRise));
  for (const g of G) {
    const name = `${g.m} at ${g.f} N`;
    if (!g.seen) { fb.push(["bad", `${name}: no rope force seen in any pull. Sensor, amplifier (power, 24 V), force wire (brown, plug pin 5) or the motor does not pull. Check with a hand pull on the test page.`]); continue; }
    if (g.seen < g.n) fb.push(["warn", `${name}: force seen in ${g.seen} of ${g.n} pulls only.`]);
    if (g.ratio != null && g.ratio < RULE.ratioLow) fb.push(["warn", `${name}: reaches ${Math.round(g.ratio * 100)} % of the target. Extra drag in the rope path, drum slipping on its shaft, or kff too low.`]);
    if (g.ratio != null && g.ratio > RULE.ratioHigh) fb.push(["warn", `${name}: overshoots to ${Math.round(g.ratio * 100)} % of the target: kff or kp too high.`]);
    if (g.riseV.length > 1 && Math.max(...g.riseV) - Math.min(...g.riseV) > RULE.spreadMs) fb.push(["warn", `${name}: start time varies ${range(g.riseV)} ms between pulls: rope slack or a loose drum.`]);
    if (g.noise != null && g.noise > RULE.noiseN) fb.push(["warn", `${name}: sensor noise ${fmt(g.noise, 1)} N at rest: check the force cable and the amplifier's ground.`]);
  }
  for (const m of run.s.towers) {
    const r = towerRise[m];
    if (r != null && allRise != null && r > allRise * RULE.slowerFactor && r - allRise > RULE.slowerMs)
      fb.push(["warn", `Tower ${m} starts slower than the others (${fmt(r)} ms vs ${fmt(allRise)} ms): rope slack at baseline, drum, or ESCON settings.`]);
  }
  const total = cm != null && allRise != null ? cm + allRise : null;
  if (total != null) fb.push(["ok", `From "send" to the rope pulling: about ${fmt(total)} ms (command ${fmt(cm, 1)} + rise ${fmt(allRise)} ms).`]);
  for (const p of run.problems) fb.push(["bad", p]);
  for (const r of all.filter((r) => r.note)) fb.push(["warn", `Pull ${r.pulse_id}: ${r.note}.`]);
  if (!fb.some(([k]) => k !== "ok")) fb.push(["ok", "No problems found by the rules below."]);
  return fb;
}

function render(run) {
  const G = groups(run), fb = feedback(run, G), p = run.params, s = run.s;
  const when = run.started.toLocaleString();
  const rowsG = G.map((g) => `<tr><td><b style="color:var(--ch-${g.m})">${g.m}</b></td><td>${g.f}</td><td>${g.seen}/${g.n}</td><td>${fmt(g.command, 1)}</td>`
    + `<td>${fmt(g.rise)} <span class="muted">(${range(g.riseV)})</span></td><td>${fmt(g.lag)}</td><td>${g.ratio == null ? "–" : g.ratio.toFixed(2)}</td><td>${fmt(g.noise, 2)}</td></tr>`).join("");
  const rowsP = run.sent.map((q) => { const r = run.rep.pulses.find((x) => x.pulse_id === q.pulse_id) || {};
    return `<tr><td>${q.pulse_id}</td><td>${q.tower}</td><td>${q.force}</td><td>${q.round}</td><td>${fmt(r.command_ms, 1)}</td><td>${fmt(r.rise_ms)}</td><td>${fmt(r.lag_ms)}</td><td>${r.ratio == null ? "–" : r.ratio.toFixed(2)}</td><td>${esc(r.note || "")}</td></tr>`; }).join("");
  $("report-body").innerHTML = `
    <h2>Bump'em delay test</h2>
    <p class="small">${esc(when)} · board ${esc(run.info.port)} · firmware ${esc(run.info.board?.fw ?? "?")} · server ${esc(run.info.server)}<br>
      Towers ${s.towers.join(" → ")} · forces ${s.forces.join(" / ")} N above baseline · ${s.rounds} rounds · pull ${s.dur} ms, ramps ${s.ramp} ms, gap ${s.gap} ms<br>
      Board: baseline ${p.baseline_n} N · max force ${p.fmax_n} N · kp ${p.kp_track} · kd ${p.kd_track} · kff ${p.kff} · recording ${esc(run.rep.file)}</p>
    <h3>Feedback</h3>
    <ul class="dt-fb">${fb.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join("")}</ul>
    <h3>Per tower and force (medians)</h3>
    <table class="pulls dt-table"><thead><tr><th>Tower</th><th>N</th><th>Force seen</th><th>Command ms</th><th>Rise ms (range)</th><th>Lag ms</th><th>Ratio</th><th>Noise N</th></tr></thead><tbody>${rowsG}</tbody></table>
    <p class="small muted"><b>Command</b>: server sends → board starts the pulse (USB + firmware). <b>Rise</b>: board start → the tower's own sensor sees the rope force leave its baseline (more than max(2 SD, 2 N), 3 samples in a row). <b>Lag</b>: measured force reaches half the amplitude after the target does. <b>Ratio</b>: plateau measured / target. Times on the board clock: 10 ms per sample. Reference (thesis, different definition: rise to 80 % at 100 N): 36 ± 4.9 ms.</p>
    <p class="small muted">Feedback rules (rules of thumb, U24): ratio below ${RULE.ratioLow} or above ${RULE.ratioHigh}; a tower's rise more than ${RULE.slowerFactor}× the others' and ${RULE.slowerMs} ms; rise spread over ${RULE.spreadMs} ms; command median over ${RULE.commandMs} ms or max over ${RULE.commandMaxMs} ms; rest noise over ${RULE.noiseN} N.</p>
    <details><summary class="small">Every pull</summary>
      <table class="pulls dt-table"><thead><tr><th>Pull</th><th>Tower</th><th>N</th><th>Round</th><th>Command ms</th><th>Rise ms</th><th>Lag ms</th><th>Ratio</th><th>Note</th></tr></thead><tbody>${rowsP}</tbody></table>
    </details>`;
  $("report").hidden = false;
  $("report").scrollIntoView({ behavior: "smooth" });
}

function saveHtml() {
  if (!lastRun) return;
  const css = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules].map((r) => r.cssText); } catch (e) { return []; } }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bump'em delay test</title><style>${css}</style></head><body><main class="grid"><section class="card wide">${$("report-body").innerHTML}</section></main></body></html>`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const d = lastRun.started, pad = (x) => String(x).padStart(2, "0");
  a.download = `delaytest_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.html`;
  a.click(); URL.revokeObjectURL(a.href);
}

function init() {
  $("towers").innerHTML = MODS.map(([m, side]) => `<label class="dt-tower"><input id="t-${m}" type="checkbox" checked> <b style="color:var(--ch-${m})">${m}</b> <span class="muted">${side}</span></label>`).join("");
  for (const id of ["forces", "rounds", "dur", "ramp", "gap"]) $(id).oninput = showPlan;
  for (const [m] of MODS) $(`t-${m}`).onchange = showPlan;
  $("btn-run").onclick = run; $("btn-cancel").onclick = () => { cancel = true; say("Cancelling after this pull…"); };
  $("btn-arm").onclick = arm; $("btn-stop").onclick = stop;
  $("btn-print").onclick = () => window.print(); $("btn-save").onclick = saveHtml;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
  showPlan(); loadBoard(); openStream();
}
init();
