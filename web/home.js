// Welcome page (U23): greeting by the time of day, tiles to every page, Teensy / Vicon / study status, STOP + Esc.
"use strict";
const API = "/api/v1";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function greet() {
  const h = new Date().getHours();
  $("greeting").textContent = h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
}

const pill = (ok, text) => `<span class="pill${ok ? " ok" : ""}">${esc(text)}</span>`;
document.addEventListener("bumpem-sync", (e) => {   // from alerts.js, every 2 s
  const s = e.detail;
  if (!s) { $("status").innerHTML = pill(false, "server not answering"); return; }
  const part = (x, name) => !x.target ? pill(false, `${name}: none`) : pill(x.connected, `${name} ${x.target}: ${x.connected ? "connected" : "not connected"}`);
  $("status").innerHTML = part(s.board, "Teensy") + part(s.vicon, "Vicon");
});

async function study() {   // a study in progress makes the Run tile say where it stands
  try {
    const s = await (await fetch(API + "/study")).json();
    const run = $("tile-run");
    if (!s || s.state === "none") { run.classList.remove("live"); return; }
    run.classList.add("live");
    $("run-note").textContent = s.state === "finished" ? `Study ${s.subject_id}: finished.`
      : `Study ${s.subject_id} loaded: block ${s.block} of ${s.blocks} (${s.state.replace("_", " ")}). Continue here.`;
  } catch (e) { /* server down: alerts.js says so */ }
}

async function mode() {
  try {
    const info = await (await fetch(API + "/info")).json();
    $("motor-note").textContent = info.mode === "testing"
      ? "One open-loop pull per motor. The server is in testing mode now: the other pages refuse to arm."
      : "One open-loop pull per motor. Needs the server in testing mode (it is in production mode now).";
  } catch (e) { /* server down */ }
}

const stop = () => fetch(API + "/estop", { method: "POST" }).catch(() => {});
$("btn-stop").onclick = stop;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
greet(); study(); mode();
setInterval(greet, 60000);
setInterval(study, 5000);
