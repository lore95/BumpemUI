// BumpemSetUp page, study protocol (U13, U16): one subject (global) + any number of blocks, fields from protocol_schema.js.
// CSV import / export, checks, Confirm per section. Reads GET /info and /params (max pulse force), sends only STOP;
// Start the study hands the typed protocol to BumpemActivation.html (localStorage "bumpemStudy", U14).
"use strict";
const API = "/api/v1";
const $ = (id) => document.getElementById(id);
const STORE = "bumpemProtocol";
const STATUS = { new: ["not filled in", "muted"], imported: ["⚠ imported: check, then Confirm", "warn-text"],
  edited: ["● edited: Confirm", "warn-text"], confirmed: ["✓ confirmed", "ok-text"] };
let P = empty();          // {subject: {values, status}, blocks: [{values, status, closed}], source}
let maxN = null;          // fmax_n − baseline_n from the board, when one is connected

function empty() { return { subject: { values: {}, status: "new" }, blocks: [], source: "" }; }
function save() { try { localStorage.setItem(STORE, JSON.stringify(P)); } catch (e) { /* private window */ } }
function load() { try { const p = JSON.parse(localStorage.getItem(STORE)); if (p && p.subject && Array.isArray(p.blocks)) P = p; } catch (e) { /* none */ } }
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ctx = () => ({ subject: P.subject.values, maxN });
const sections = () => [["subject", "s", P.subject], ...P.blocks.map((b, i) => ["block", i, b])];

// ---------------------------------------------------------------- checks
const items = (s) => String(s ?? "").trim().split(/[\s;|/]+/).filter(Boolean);
const shown = (f, v) => !f.show || Object.entries(f.show).every(([k, x]) => v[k] === x);
function fieldError(f, s) {
  s = String(s ?? "").trim();
  if (s === "") return f.required ? "required" : "";
  const range = (x) => isNaN(x) ? "not a number" : f.int && !Number.isInteger(x) ? "whole number"
    : (f.min !== undefined && x < f.min) || (f.max !== undefined && x > f.max) ? `allowed ${f.min} to ${f.max}` : "";
  if (f.type === "number") return range(num(s));
  if (f.type === "list") { for (const it of items(s)) { const e = range(num(it)); if (e) return `${it}: ${e}`; } return ""; }
  if (f.type === "choice") return f.options.includes(s) ? "" : `one of ${f.options.join(", ")}`;
  return "";
}
function errors(kind, v) {   // {key: message}, shown fields only
  const sec = SCHEMA[kind], out = {};
  for (const f of sec.fields) if (shown(f, v)) { const e = fieldError(f, v[f.key]); if (e) out[f.key] = e; }
  if (sec.checks) for (const [k, m] of sec.checks(v, ctx())) if (!out[k]) out[k] = m;
  return out;
}

// ---------------------------------------------------------------- render
function fieldHTML(i, f, v) {
  const val = v[f.key] ?? "", data = `data-sec="${i}" data-key="${f.key}"`;
  const input = f.type === "choice"
    ? `<select ${data}><option value=""></option>${(f.options.includes(val) || val === "" ? f.options : [...f.options, val])
      .map((o) => `<option${o === val ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
    : `<input ${data} type="text" ${f.type === "text" ? "" : 'inputmode="decimal"'} value="${esc(val)}" placeholder="${esc(f.example)}">`;
  return `<label id="l-${i}-${f.key}"><span>${esc(f.label)}${f.unit ? ` <span class="u">${esc(f.unit)}</span>` : ""}` +
    `${f.required ? "" : ' <span class="u">· optional</span>'}</span>${input}<span class="fnote" id="n-${i}-${f.key}"></span></label>`;
}
const fieldsHTML = (kind, i, v) => `<div class="fields">${SCHEMA[kind].fields.map((f) => fieldHTML(i, f, v)).join("")}</div>`;
function render() {
  $("schema-version").textContent = `· parameters ${SCHEMA.version}`;
  $("subject").innerHTML = `<h2 id="h-subject">${esc(SCHEMA.subject.title)} <span class="muted">· same for every block</span></h2>` +
    fieldsHTML("subject", "s", P.subject.values) +
    `<div class="row"><button data-act="confirm" data-sec="s">Confirm subject</button><span id="st-s" class="small"></span></div>`;
  $("blocks").innerHTML = P.blocks.map((b, i) =>
    `<details class="block" data-sec="${i}"${b.closed ? "" : " open"}><summary><b>${esc(SCHEMA.block.title)} ${i + 1}</b> ` +
    `<span id="sum-${i}" class="muted small"></span> <span id="st-${i}" class="small"></span></summary>` + fieldsHTML("block", i, b.values) +
    `<div class="row"><button data-act="confirm" data-sec="${i}" class="confirm">Confirm block ${i + 1}</button><button data-act="dup" data-sec="${i}">Duplicate</button>` +
    `<button data-act="up" data-sec="${i}" ${i ? "" : "disabled"} title="Move up">↑</button>` +
    `<button data-act="down" data-sec="${i}" ${i < P.blocks.length - 1 ? "" : "disabled"} title="Move down">↓</button>` +
    `<button data-act="del" data-sec="${i}" class="warn">Delete</button></div></details>`).join("") ||
    '<p class="muted small">No blocks yet: Import CSV or + Add block.</p>';
  $("block-count").textContent = `· ${P.blocks.length}`;
  update();
}
function update() {   // notes, statuses, buttons; no re-render (keeps the cursor in the field)
  let todo = 0, bad = 0;
  for (const [kind, i, sec] of sections()) {
    const v = sec.values, err = errors(kind, v), n = Object.keys(err).length;
    for (const f of SCHEMA[kind].fields) {
      $(`l-${i}-${f.key}`).hidden = !shown(f, v);
      const note = $(`n-${i}-${f.key}`);
      note.textContent = err[f.key] || (f.note && f.note(v, ctx())) || f.hint || "";
      note.className = "fnote " + (err[f.key] ? "bad" : "muted");
    }
    if (n && sec.status === "confirmed") sec.status = "edited";   // e.g. a new body mass puts a block above the max force
    const [txt, cls] = n && sec.status !== "new" ? [`✗ ${n} to fix`, "bad"] : STATUS[sec.status];
    $(`st-${i}`).textContent = txt; $(`st-${i}`).className = "small " + cls;
    document.querySelector(`button[data-act=confirm][data-sec="${i}"]`).disabled = !!n || sec.status === "confirmed";
    if (kind === "block") $(`sum-${i}`).textContent = SCHEMA.block.summary.map((k) => {
      const f = SCHEMA.block.fields.find((x) => x.key === k), s = v[k];
      return s ? `${s}${f.unit ? " " + f.unit : ""}` : "";
    }).filter(Boolean).join(" · ");
    if (n) bad++; else if (sec.status !== "confirmed") todo++;
  }
  const r = $("ready");
  r.textContent = !P.blocks.length ? "Add at least one block." : bad ? `${bad} section(s) with errors.` : todo ? `${todo} section(s) to confirm.`
    : `All ${P.blocks.length + 1} sections confirmed.`;
  r.className = "small " + (bad ? "bad" : todo || !P.blocks.length ? "warn-text" : "ok-text");
  $("btn-start").disabled = !P.blocks.length || !!bad || !!todo;
  save();
}

// ---------------------------------------------------------------- CSV: "section,parameter,value" subject rows, then a block table
function csvRows(text) {
  text = text.replace(/^﻿/, "");
  let sep = null;
  const m = text.match(/^sep=(.)\r?\n/i);                     // Excel's separator hint line
  if (m) { sep = m[1]; text = text.slice(m[0].length); }
  if (!sep) {                                                  // German Excel saves with ";"
    const first = text.split(/\r?\n/, 1)[0], count = (c) => first.split(c).length;
    sep = [",", ";", "\t"].reduce((a, c) => (count(c) > count(a) ? c : a));
  }
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((s) => s.trim()));
}
function parseProtocol(text) {
  const sk = new Set(SCHEMA.subject.fields.map((f) => f.key)), bk = new Set(SCHEMA.block.fields.map((f) => f.key));
  const subject = {}, blocks = [], warn = [];
  let cols = null;
  csvRows(text).forEach((r, n) => {
    const head = (r[0] || "").toLowerCase(), line = `line ${n + 1}`;
    if (!r.some(Boolean) || head.startsWith("#") || head === "section") return;
    if (head === "subject") {
      if (!sk.has(r[1])) warn.push(`${line}: unknown subject parameter "${r[1]}", ignored`);
      else subject[r[1]] = r[2] ?? "";
    } else if (head === "block") {
      cols = r.slice(1);
      cols.filter((c) => c && !bk.has(c)).forEach((c) => warn.push(`unknown block column "${c}", ignored`));
      SCHEMA.block.fields.filter((f) => f.required && !cols.includes(f.key)).forEach((f) => warn.push(`no column "${f.key}" (${f.label})`));
    } else if (cols && /^\d+$/.test(r[0])) {
      const v = {};
      cols.forEach((c, j) => { if (bk.has(c) && r[j + 1]) v[c] = r[j + 1]; });
      blocks.push(v);
      if (+r[0] !== blocks.length) warn.push(`${line}: block numbered ${r[0]}, imported as block ${blocks.length}`);
    } else warn.push(`${line}: not a subject row or block row, ignored`);
  });
  if (!Object.keys(subject).length && !blocks.length) throw new Error("no subject rows and no block table: start from Download template");
  return { subject, blocks, warn };
}
function csvText(p) {
  const q = (s) => (/[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const out = (f, s) => (f.type === "number" || f.type === "list" ? String(s ?? "").replace(/,/g, ".") : String(s ?? ""));
  const used = (f, v) => (shown(f, v) ? out(f, v[f.key]) : "");   // e.g. no interval for predefined timing
  const L = ["section,parameter,value"];
  for (const f of SCHEMA.subject.fields) L.push(["subject", f.key, out(f, p.subject.values[f.key])].map(q).join(","));
  L.push("", ["block", ...SCHEMA.block.fields.map((f) => f.key)].join(","));
  p.blocks.forEach((b, i) => L.push([String(i + 1), ...SCHEMA.block.fields.map((f) => used(f, b.values))].map(q).join(",")));
  return L.join("\r\n") + "\r\n";
}
function template() {
  const ex = (kind) => Object.fromEntries(SCHEMA[kind].fields.map((f) => [f.key, f.example ?? ""]));
  return { subject: { values: ex("subject") }, blocks: SCHEMA.block.templateBlocks.map((o) => ({ values: { ...ex("block"), ...o } })) };
}
const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`; };
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importFile(file) {
  const rep = $("import-report");
  try {
    const r = parseProtocol(await file.text());
    P = { subject: { values: r.subject, status: "imported" }, blocks: r.blocks.map((v) => ({ values: v, status: "imported" })), source: file.name };
    $("file-note").textContent = `${file.name}: ${Object.keys(r.subject).length} subject values, ${r.blocks.length} blocks (previous draft replaced)`;
    rep.innerHTML = r.warn.map((w) => `<li>${esc(w)}</li>`).join(""); rep.hidden = !r.warn.length;
    render();
  } catch (e) { $("file-note").textContent = `${file.name}: ${e.message}`; rep.hidden = true; }
}

// ---------------------------------------------------------------- actions
function twice(btn, label, again) {   // two clicks instead of a browser dialog
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; return true; }
  btn.dataset.armed = "1"; btn.textContent = again;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
  return false;
}
function onAction(e) {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const i = b.dataset.sec === "s" ? "s" : +b.dataset.sec, blk = P.blocks;
  switch (b.dataset.act) {
    case "confirm":
      if (i === "s") P.subject.status = "confirmed";
      else { blk[i].status = "confirmed"; blk[i].closed = true; const next = blk.find((x) => x.status !== "confirmed"); if (next) next.closed = false; }
      return render();
    case "dup": blk.splice(i + 1, 0, { values: { ...blk[i].values }, status: "edited" }); return render();
    case "up": [blk[i - 1], blk[i]] = [blk[i], blk[i - 1]]; return render();
    case "down": [blk[i + 1], blk[i]] = [blk[i], blk[i + 1]]; return render();
    case "del": if (twice(b, "Delete", "Click again to delete")) { blk.splice(i, 1); render(); } return;
  }
}
function onInput(e) {
  const t = e.target;
  if (!t.dataset.key) return;
  const sec = t.dataset.sec === "s" ? P.subject : P.blocks[+t.dataset.sec];
  sec.values[t.dataset.key] = t.value; sec.status = "edited";
  update();
}
function addBlock() {
  const last = P.blocks[P.blocks.length - 1];
  P.blocks.push({ values: last ? { ...last.values } : {}, status: "edited" });   // a new block starts as a copy of the last
  render();
  const box = $("blocks"); box.scrollTop = box.scrollHeight;
  box.lastElementChild.querySelector("input, select").focus();
}
function typed() {   // API.md "Study" protocol: numbers as numbers, lists as arrays, unused and empty fields left out
  const conv = (kind, v) => {
    const o = {};
    for (const f of SCHEMA[kind].fields) {
      const s = String(v[f.key] ?? "").trim();
      if (s === "" || !shown(f, v)) continue;
      o[f.key] = f.type === "number" ? num(s) : f.type === "list" ? items(s).map(num) : s;
    }
    return o;
  };
  return { subject: conv("subject", P.subject.values), blocks: P.blocks.map((b) => conv("block", b.values)) };
}
function startStudy() {
  try { localStorage.setItem("bumpemStudy", JSON.stringify({ protocol: typed(), source: P.source, schema: SCHEMA.version, fresh: true })); }
  catch (e) { $("ready").textContent = "This browser blocks storage: the study page cannot get the protocol."; return; }
  location.href = "BumpemActivation.html";
}
function stop() { fetch(API + "/estop", { method: "POST" }).catch(() => {}); }

async function init() {
  load();
  $("btn-stop").onclick = stop;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); stop(); } });
  $("btn-import").onclick = () => $("file").click();
  $("file").onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; };
  $("btn-export").onclick = () => {
    download(`protocol_${(P.subject.values.subject_id || "draft").replace(/[^\w-]/g, "")}_${stamp()}.csv`, csvText(P));
    $("file-note").textContent = "Exported" + ($("ready").classList.contains("ok-text") ? "" : ": not everything is confirmed yet");
  };
  $("btn-template").onclick = () => download("protocol_template.csv", csvText(template()));
  $("btn-new").onclick = (e) => { if (twice(e.target, "New", "Click again: clear all")) { P = empty(); $("file-note").textContent = ""; $("import-report").hidden = true; render(); } };
  $("btn-add").onclick = addBlock;
  $("btn-start").onclick = startStudy;
  for (const id of ["subject", "blocks"]) { $(id).addEventListener("input", onInput); $(id).addEventListener("click", onAction); }
  $("blocks").addEventListener("toggle", (e) => { const b = P.blocks[+e.target.dataset.sec]; if (b) { b.closed = !e.target.open; save(); } }, true);
  render();
  try {
    const i = await (await fetch(API + "/info")).json();
    $("conn-state").textContent = i.port ? `board ${i.port}` : "no board (STOP works once connected on the test page)";
    $("conn-state").classList.toggle("ok", !!i.port);
    if (i.port) { const p = await (await fetch(API + "/params")).json(); maxN = p.fmax_n - p.baseline_n; update(); }
  } catch (e) { $("conn-state").textContent = "server not running"; }
}
init();
