// Study page (U14): runs the protocol from protocol.html on the server (API.md "Study"). Arm (+ recording), gait
// pattern, blocks one after the other, live rope and ground force. The schedule runs on the server, not in this page.
"use strict";
const API = "/api/v1";
const MODS = ["A", "B", "C", "D"];
const $ = (id) => document.getElementById(id);
const S = { connected: false, state: null, params: null, hist: [], vhist: [], vicon: null, study: { state: "none" },
  protocol: null, recording: false, marks: [], done: 0 };

async function api(method, path, body) {
  const r = await fetch(API + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ? `${data.error.code}: ${data.error.message}` : `HTTP ${r.status}`);
  return data;
}
function note(id, text, bad) { const e = $(id); e.textContent = text; e.style.color = bad ? "var(--stop)" : ""; }
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- board
async function loadPorts() {
  try { $("port").innerHTML = '<option value="sim">simulator</option>' + (await api("GET", "/ports")).map((p) => `<option>${p}</option>`).join(""); }
  catch (e) { /* keep the simulator */ }
}
async function connectToggle() {
  const btn = $("btn-connect");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    if (S.connected) { await api("POST", "/disconnect"); await setConnected(null); }
    else { note("conn-state", "connecting…"); await setConnected(await api("POST", "/connect", { port: $("port").value })); }
  } catch (e) { note("conn-state", e.message, true); }
  finally { btn.disabled = false; }
}
async function setConnected(info) {
  S.connected = !!(info && info.port);
  $("conn-state").textContent = S.connected ? `${info.port} · fw ${info.board ? info.board.fw : "?"}` : "not connected";
  $("conn-state").classList.toggle("ok", S.connected);
  $("btn-connect").textContent = S.connected ? "Disconnect" : "Connect";
  if (S.connected) {
    if (info.port !== "sim") $("port").value = info.port;
    try { const st = await api("GET", "/status"); setState(st.state); S.params = await api("GET", "/params"); } catch (e) { /* stream fills it */ }
  } else { S.state = null; S.params = null; S.hist = []; setState(null); }
  renderLegend(); renderBlocks(); updateButtons();
}
function setState(st) {
  S.state = st;
  $("board-state").textContent = st || (S.connected ? "no data" : "—");
  $("board-state").className = `pill state ${st || ""}`;
  updateButtons();
}
async function arm() {   // Arm = start of the recording (user, 2026-11-05)
  try { await api("POST", "/arm"); } catch (e) { note("study-note", e.message, true); return; }
  if (S.recording) return;
  const id = (S.study.subject_id || (S.protocol && S.protocol.subject.subject_id) || "").replace(/[^A-Za-z0-9_-]/g, "");
  try { showLog(await api("POST", "/log/start", { label: `${id ? id + "_" : ""}study`.slice(0, 40) })); }
  catch (e) { note("log-note", "not recording: " + e.message, true); }
}
async function release() {
  if (!confirm("Is the treadmill stopped?\n\nRelease ramps every rope to 0 N and switches the drivers off. The recording stops.")) return;
  try { await api("POST", "/release", { ms: 1000 }); } catch (e) { note("study-note", e.message, true); return; }
  if (S.recording) setTimeout(stopRec, 1500);   // keep the ramp down in the file
}
async function stopRec() { try { showLog(await api("POST", "/log/stop")); } catch (e) { note("log-note", e.message, true); } }
function stop() {   // never asks: emergency. The recording keeps running (Stop rec ends it)
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type: "estop" }));
  fetch(API + "/estop", { method: "POST" }).catch(() => {});
  note("study-note", "STOP sent: drivers off, ropes slack. The block stopped; Arm, then Start resumes it.", true);
}
async function clearFault() { try { await api("POST", "/clear"); } catch (e) { note("study-note", e.message, true); } }
function showLog(l) {
  S.recording = !!l.recording;
  const e = $("log-note");
  e.textContent = l.recording ? `● Recording: ${l.rows} rows, ${l.duration_s.toFixed(0)} s${l.vicon_file ? `, Vicon ${l.vicon_rows} rows` : ", no Vicon"}` : "";
  e.style.color = "var(--rec)";
  if (!l.recording && l.file) {
    e.textContent = `Saved (${l.duration_s.toFixed(0)} s) on the server PC: ${l.file}. Download: `; e.style.color = "";
    [["force", "force"], ["events", "events"]].concat(l.vicon_file ? [["vicon", "Vicon"]] : []).forEach(([kind, text], i) => {
      const a = document.createElement("a"); a.href = `${API}/log/file?kind=${kind}`; a.download = ""; a.textContent = text;
      e.append(i ? " · " : "", a);
    });
  }
  $("btn-rec").hidden = !S.recording;
}
async function loadLog() { try { const l = await api("GET", "/log"); if (l.recording || S.recording) showLog(l); } catch (e) { /* older server */ } }

// ---------------------------------------------------------------- Vicon
function plateMap() {   // left belt from the select, right = the other plate
  const plates = S.vicon ? S.vicon.plates : [], left = $("left-plate").value;
  return plates.length === 2 && left ? { left, right: plates.find((p) => p !== left) } : null;
}
function showVicon(v) {
  const before = (S.vicon && S.vicon.plates || []).join();
  S.vicon = v;
  const host = $("vicon-host");
  if (!host.value && document.activeElement !== host) host.value = v.host || v.default_host || localGet("viconHost") || "";
  $("btn-vicon").textContent = v.connected ? "Disconnect" : "Connect";
  $("vicon-state").textContent = v.connected ? `${v.host} · ${Math.round(v.rate_hz)} Hz` : "not connected";
  $("vicon-state").classList.toggle("ok", v.connected);
  if (v.plates.join() !== before) {
    $("vlegend").innerHTML = v.plates.map((p, k) => `<span><b style="color:var(--plate-${k % 2})">■ ${esc(p)}</b> <span id="vv-${k}">—</span></span>`).join("") +
      (v.plates.length ? '<span>Fz · ticks: foot strikes · <b style="color:var(--accent)">P</b> perturbation</span>' : "");
    const keep = S.study.plates ? S.study.plates.left : localGet("leftPlate");
    $("left-plate").innerHTML = v.plates.map((p) => `<option${p === keep ? " selected" : ""}>${esc(p)}</option>`).join("");
  }
  note("vicon-note", v.message || (v.connected ? "" : "Enter the Nexus PC address:port (or sim), then Connect."), !!v.message);
  if (v.connected && S.study.state === "none" && S.protocol && !S.loading) loadStudy();
  updateButtons();
}
async function loadVicon() { try { showVicon(await api("GET", "/vicon")); } catch (e) { /* server down */ } }
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

// ---------------------------------------------------------------- study (API.md "Study")
async function loadStudy() {   // the protocol from protocol.html → server
  S.loading = true;
  try {
    showStudy(await api("POST", "/study", { ...S.protocol, plates: plateMap() }));
    localSet("leftPlate", $("left-plate").value);
    localSet("bumpemStudy", JSON.stringify({ protocol: S.protocol, fresh: false }));   // a page reload keeps the server's study
  }
  catch (e) { note("study-note", "Protocol not loaded: " + e.message, true); }
  finally { S.loading = false; }
}
async function refreshStudy() { try { showStudy(await api("GET", "/study")); } catch (e) { /* server down */ } }
function nextIndex(st) { return st.state === "block_done" ? st.block : Math.max(0, (st.block || 1) - 1); }   // 0-based block Start runs
function showStudy(st) {
  if (st.state !== "none" && st.done > S.done && S.vhist.length)   // a perturbation was sent: mark it on the ground plot
    S.marks.push({ t: S.vhist[S.vhist.length - 1].host_s, color: color("--accent"), text: "P" });
  S.done = st.done || 0;
  S.study = st;
  const n = st.state === "none" ? (S.protocol ? S.protocol.blocks.length : 0) : st.blocks;
  $("block-no").textContent = st.state === "none" ? "–" : st.block; $("block-of").textContent = `/ ${n || "–"}`;
  $("subject").textContent = st.subject_id ? `· ${st.subject_id}` : "";
  const p = S.protocol, i = st.state === "none" ? 0 : nextIndex(st), blk = st.state !== "none" && p ? p.blocks[i] : null;
  note("s-load", st.state === "none" ? (p ? "Protocol: connect Vicon (bottom right) to load it." : "No protocol: prepare one on the protocol page, then Start the study there.")
    : `Protocol loaded: ${st.blocks} blocks, left belt = ${st.plates.left}.`, st.state === "none");
  $("gait-speed").textContent = blk ? blk.speed_ms : "–";
  const g = st.gait, gOk = g && blk && Math.abs(g.speed_ms - blk.speed_ms) < 1e-6;
  note("gait-note", st.state === "gait" ? `Recording foot strikes… ${g.until_s} s left` : g && g.left
    ? `Gait pattern at ${g.speed_ms} m/s: stride left ${g.left.stride_ms} ms (sd ${g.left.sd_ms}, ${g.left.n}), right ${g.right.stride_ms} ms (sd ${g.right.sd_ms}, ${g.right.n})` +
      (gOk ? "" : ` · block ${i + 1} runs at ${blk.speed_ms} m/s: record again`) : "Needed before each new speed.", g && !gOk && st.state !== "gait");
  const msg = { loaded: "", ready: "Ready: Start runs block 1.", running: "", stopped: "Block stopped", block_done: `Block ${st.block} done. Set the next speed, record the gait pattern if it changed, then start block ${st.block + 1}.`,
    finished: "All blocks done. Release (treadmill stopped first), then download the recording.", gait: "" }[st.state] || "";
  note("study-note", [msg, st.message].filter(Boolean).join(": "), st.state === "stopped");
  $("progress").innerHTML = st.state === "running" || st.state === "stopped"
    ? `<b>${st.done}</b> / ${st.total} perturbations · ${st.amplitude_n} N · step ${st.steps}` +
      (st.next_in_steps != null ? ` · next due in <b>${st.next_in_steps}</b> steps` : "") : "";
  renderBlocks(); updateButtons();
}
function renderBlocks() {
  const p = S.protocol, st = S.study;
  if (!p) { $("blocks").innerHTML = '<tr><td colspan="8" class="muted">No protocol in this browser.</td></tr>'; return; }
  const cur = st.state === "none" ? -1 : st.block - 1, mass = p.subject.mass_kg;
  $("blocks").innerHTML = p.blocks.map((b, i) => {
    const status = i < cur || (i === cur && ["block_done", "finished"].includes(st.state)) ? "✓ done"
      : i === cur ? { running: `running ${st.done}/${st.total}`, stopped: `stopped ${st.done}/${st.total}`, gait: "gait pattern…" }[st.state] || "next" : "";
    const timing = b.timing_mode === "random" ? `${b.interval_min_steps}–${b.interval_max_steps} steps` : `steps ${b.schedule_steps.join(" ")}`;
    return `<tr${i === cur ? ' class="cur"' : ""}><td>${i + 1}</td><td>${esc(b.label)}</td><td>${b.speed_ms}</td>` +
      `<td title="${b.intensity_pct_bw} % body weight">${(b.intensity_pct_bw / 100 * mass * 9.81).toFixed(0)} × ${b.n_perturbations}</td>` +
      `<td>${b.directions_deg.join(" ")}</td><td>${b.gait_phase_pct} % · ${b.trigger_side}</td><td class="small">${timing}</td><td class="small">${status}</td></tr>`;
  }).join("");
}
function updateButtons() {
  const st = S.study.state, armed = S.state === "ARMED", vic = !!(S.vicon && S.vicon.connected);
  $("btn-arm").disabled = !(S.connected && (S.state === "DISARMED" || S.state === "ESTOP"));
  $("btn-release").disabled = !(S.connected && (armed || S.state === "FAULT"));
  $("btn-clear").hidden = !(S.connected && S.state === "FAULT");
  $("btn-gait").disabled = !(vic && ["loaded", "ready", "stopped", "block_done"].includes(st));
  const s = $("btn-start"), blk = S.protocol && st !== "none" ? S.protocol.blocks[nextIndex(S.study)] : null;
  const gaitOk = !blk || (S.study.gait && S.study.gait.speed_ms === blk.speed_ms);   // server checks it too
  s.disabled = !(S.connected && armed && vic && gaitOk && ["ready", "stopped", "block_done"].includes(st));
  s.textContent = st === "stopped" ? `Resume block ${S.study.block}` : st === "block_done" ? `Start block ${S.study.block + 1}`
    : st === "finished" ? "Study finished" : S.study.block > 1 ? `Start block ${S.study.block}` : "Start the study";
  s.title = !armed ? "Arm first" : !gaitOk ? `Record the gait pattern at ${blk.speed_ms} m/s first` : "";
  $("btn-pause").disabled = !["running", "gait"].includes(st);
  $("left-plate").disabled = ["running", "gait"].includes(st);
}
async function study(path, body) { try { showStudy(await api("POST", "/study/" + path, body)); } catch (e) { note("study-note", e.message, true); } }

// ---------------------------------------------------------------- stream and plots
function openStream() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}/stream?telemetry_hz=20`);
  S.ws = ws;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "telemetry") {
      if (m.state !== S.state) setState(m.state);
      S.hist.push(m);
      while (S.hist.length && (S.hist[0].t_ms < m.t_ms - 10000 || S.hist[0].t_ms > m.t_ms)) S.hist.shift();
    } else if (m.type === "vicon") {
      S.vhist.push(m);
      while (S.vhist.length && (S.vhist[0].host_s < m.host_s - 10 || S.vhist[0].host_s > m.host_s)) S.vhist.shift();
      while (S.marks.length && S.marks[0].t < m.host_s - 10) S.marks.shift();
    } else if (m.type === "gait") {
      const k = S.vicon ? S.vicon.plates.indexOf((S.study.plates || {})[m.side]) : -1;
      S.marks.push({ t: m.t_s, color: color(`--plate-${Math.max(0, k) % 2}`) });
    } else if (m.type === "study") {
      showStudy(m);
    } else if (m.type === "event" && m.kind === "STATE") {
      setState(m.args[0]);
      if (m.args[0] === "DISARMED" && S.connected) api("GET", "/params").then((p) => { S.params = p; renderLegend(); }).catch(() => {});
    } else if (m.type === "event" && m.kind === "RESTART") {
      note("study-note", `Board restarted: ${m.args[0]}. Check the parameters before arming.`, true);
    }
  };
  ws.onclose = () => { if (S.ws === ws) setTimeout(openStream, 1000); };
}
function renderLegend() {
  const on = MODS.filter((m) => !S.params || S.params[`ch_${m}`] >= 1);
  $("legend").innerHTML = on.map((m) => `<span><b style="color:var(--ch-${m})">■ ${m}</b> <span id="lv-${m}">—</span></span>`).join("") +
    "<span>solid measured · dashed target</span>";
}
function draw() {
  const on = MODS.filter((m) => !S.params || S.params[`ch_${m}`] >= 1), h = S.hist, v = S.vhist, plates = S.vicon ? S.vicon.plates : [];
  drawRopePlot($("plot"), h, on);
  drawGroundPlot($("vplot"), v, plates, S.marks);
  if (h.length) for (const m of on) { const e = $(`lv-${m}`); if (e) e.textContent = `${(h[h.length - 1].measured[m] || 0).toFixed(1)} / ${(h[h.length - 1].target[m] || 0).toFixed(1)} N`; }
  if (v.length) plates.forEach((p, k) => { const e = $(`vv-${k}`); if (e) e.textContent = `${(v[v.length - 1].fz[p] ?? 0).toFixed(0)} N`; });
  requestAnimationFrame(draw);
}
function localGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }

// ---------------------------------------------------------------- wiring
async function init() {
  let fresh = false;   // true: just sent from the protocol page, replaces the server's study (unless a block runs)
  try { const d = JSON.parse(localGet("bumpemStudy")); if (d && d.protocol && d.protocol.blocks) { S.protocol = d.protocol; fresh = d.fresh !== false; } } catch (e) { /* none */ }
  $("btn-connect").onclick = connectToggle; $("btn-arm").onclick = arm; $("btn-release").onclick = release;
  $("btn-stop").onclick = stop; $("btn-clear").onclick = clearFault; $("btn-vicon").onclick = viconToggle;
  $("btn-rec").onclick = stopRec;
  $("btn-gait").onclick = () => study("gait", { duration_s: parseFloat($("gait-s").value) || 20 });
  $("btn-start").onclick = () => study("start");
  $("btn-pause").onclick = () => study("stop");
  $("left-plate").onchange = () => { if (S.protocol && S.vicon && S.vicon.connected) loadStudy(); };   // new mapping: new gait pattern needed
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
  renderLegend(); renderBlocks(); updateButtons(); requestAnimationFrame(draw);
  loadPorts(); openStream();
  try {
    const info = await api("GET", "/info");
    if (info.mode && info.mode !== "production") {
      $("mode-warning").hidden = false;
      $("mode-warning").textContent = `The server is in ${info.mode} mode: arming and the study are refused. Restart it with  bumpem serve --production.`;
    }
    if (info.port) await setConnected(info);
  } catch (e) { note("conn-state", "server not reachable", true); }
  const st = await api("GET", "/study").catch(() => ({ state: "none" }));
  if (fresh && S.protocol && ["running", "gait"].includes(st.state)) note("study-note", "A block is running: the new protocol loads once it is stopped (reload this page then).", true);
  showStudy(fresh && S.protocol && !["running", "gait"].includes(st.state) ? { state: "none" } : st);   // none: loaded once Vicon is connected
  await loadVicon(); loadLog();
  setInterval(loadVicon, 2000); setInterval(refreshStudy, 1000); setInterval(loadLog, 1000);
}
init();
