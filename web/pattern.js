// BumpemPattern (U21, server D50): generate a direction + step-gap sequence from rules, preview it, save it under a
// name (POST /patterns). Generation is seeded: the same rules and seed give the same pattern.
"use strict";
const API = "/api/v1";
const $ = (id) => document.getElementById(id);
const DIRS = [[0, "front"], [45, "front-left"], [90, "left"], [135, "back-left"], [180, "back"], [-135, "back-right"],
  [-90, "right"], [-45, "front-right"]];
const where = (a) => (DIRS.find(([d]) => d === a) || [a, ""])[1];
let current = null;       // the generated pattern, not saved yet
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function note(id, text, bad) { const e = $(id); e.textContent = text; e.style.color = bad ? "var(--stop)" : ""; }

function rng(seed) {   // mulberry32: small, seeded, the same in every browser
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const int = (id) => { const v = Number(String($(id).value).trim()); return Number.isInteger(v) ? v : NaN; };

function angles() {
  const a = DIRS.filter(([d]) => $(`d${d}`).checked).map(([d]) => d);
  for (const s of $("extra").value.trim().split(/\s+/).filter(Boolean)) {
    const x = Number(s.replace(",", "."));
    if (!isFinite(x)) throw new Error(`"${s}" is not an angle`);
    let v = ((x % 360) + 360) % 360;
    if (v > 180) v -= 360;                       // to (−180, 180], the API's convention
    if (!a.includes(v)) a.push(v);
  }
  return a;
}

function generate() {
  const n = int("n"), gmin = int("gmin"), gmax = int("gmax"), run = int("run");
  let seed = int("seed");
  if (!(n >= 1 && n <= 500)) throw new Error("Perturbations: 1–500");
  if (!(gmin >= 1 && gmax <= 1000 && gmin <= gmax)) throw new Error("Gaps: 1 ≤ min ≤ max ≤ 1000 steps");
  if (!(run >= 1)) throw new Error("Max same in a row: 1 or more");
  const a = angles();
  if (!a.length) throw new Error("Pick at least one direction");
  if (a.length === 1 && run < n) throw new Error(`One direction only: "max same in a row" must be ≥ ${n}`);
  if (!Number.isInteger(seed)) { seed = Math.floor(Math.random() * 1e9); $("seed").value = seed; }
  const r = rng(seed), balanced = $("balanced").checked;
  for (let attempt = 0; attempt < 2000; attempt++) {   // shuffle until no direction repeats more than `run` times
    let seq;
    if (balanced) {   // each direction n / k times; the remainder to randomly chosen directions
      seq = [];
      const pick = a.slice();
      for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
      for (let i = 0; i < n; i++) seq.push(i < Math.floor(n / a.length) * a.length ? a[i % a.length] : pick[i % a.length]);
      for (let i = seq.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [seq[i], seq[j]] = [seq[j], seq[i]]; }
    } else seq = Array.from({ length: n }, () => a[Math.floor(r() * a.length)]);
    let ok = true, same = 1;
    for (let i = 1; i < seq.length && ok; i++) { same = seq[i] === seq[i - 1] ? same + 1 : 1; ok = same <= run; }
    if (!ok) continue;
    const items = seq.map((d) => ({ angle_deg: d, gap_steps: gmin + Math.floor(r() * (gmax - gmin + 1)) }));
    return { items, rules: { angles: a, n, gap_min: gmin, gap_max: gmax, balanced, max_run: run, seed } };
  }
  throw new Error("No sequence found with these rules: allow more in a row or add directions");
}

function show(p, title) {
  $("prev-title").textContent = title;
  let step = 0;
  $("prev").innerHTML = p.items.map((it, i) => {
    step += it.gap_steps;
    return `<tr><td>${i + 1}</td><td><b>${it.angle_deg}°</b> <span class="muted small">${where(it.angle_deg)}</span></td><td>${it.gap_steps}</td><td class="muted">${step}</td></tr>`;
  }).join("");
  const counts = {};
  for (const it of p.items) counts[it.angle_deg] = (counts[it.angle_deg] || 0) + 1;
  const min = (cad) => (step / cad / 60).toFixed(1);
  $("prev-sum").innerHTML = `${p.items.length} perturbations · ` + Object.entries(counts).map(([d, c]) => `${d}° × ${c}`).join(", ") +
    `<br>${step} steps in all ≈ <b>${min(1.8)} min walking</b> (108 steps/min) or <b>${min(2.8)} min running</b> (168 steps/min), plus the warm-up`;
}

async function loadSaved() {
  try {
    const list = await (await fetch(API + "/patterns")).json();
    $("saved").innerHTML = list.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="muted small">${esc(p.note)}</div></td><td>${p.n}</td>` +
      `<td>${p.angles.join(" ")}</td><td>${p.gap_min}–${p.gap_max}</td><td class="small">${esc((p.created || "").slice(0, 16).replace("T", " "))}</td>` +
      `<td><button data-name="${esc(p.name)}">View</button></td></tr>`).join("") || '<tr><td colspan="6" class="muted">none yet</td></tr>';
  } catch (e) { $("saved").innerHTML = '<tr><td colspan="6" class="bad">server not answering</td></tr>'; }
}
async function view(name) {
  const p = await (await fetch(`${API}/patterns/${encodeURIComponent(name)}`)).json();
  show(p, `· ${name} (saved)`);
}

async function savePattern() {
  const name = $("name").value.trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) { note("save-note", "Name: letters, digits, _ and - only, max 40", true); return; }
  const r = await fetch(API + "/patterns", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, note: $("note").value.trim(), ...current }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { note("save-note", d.error ? d.error.message : `HTTP ${r.status}`, true); return; }
  note("save-note", `Saved as ${name}. Pick it in a block on BumpemSetUp.`);
  current = null; $("btn-save").disabled = true;
  show(d, `· ${name} (saved)`); loadSaved();
}

function init() {
  $("dirs").innerHTML = DIRS.map(([d, w]) => `<label><input type="checkbox" id="d${d}" ${d === 90 || d === -90 ? "checked" : ""}> ${d}° <span class="muted">${w}</span></label>`).join("");
  $("btn-gen").onclick = () => {
    try { current = generate(); show(current, "· not saved yet"); note("gen-note", `seed ${current.rules.seed}`); $("btn-save").disabled = false; note("save-note", ""); }
    catch (e) { note("gen-note", e.message, true); }
  };
  $("btn-save").onclick = savePattern;
  $("saved").addEventListener("click", (e) => { const b = e.target.closest("button[data-name]"); if (b) view(b.dataset.name); });
  const stop = () => fetch(API + "/estop", { method: "POST" }).catch(() => {});
  $("btn-stop").onclick = stop;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
  loadSaved();
}
init();
