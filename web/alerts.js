// Connection alerts on every page (U20, server D49): polls GET /sync every 2 s and shows a red line under the header
// while the Teensy or Vicon target is not connected (the server retries every 5 s) or the server does not answer.
// Pages can listen: document.addEventListener("bumpem-sync", (e) => e.detail = the /sync object, or null).
"use strict";
(function () {
  const box = document.createElement("div");
  box.id = "conn-alert";
  box.className = "conn-alert";
  box.hidden = true;
  const anchor = document.querySelector(".stop-note") || document.querySelector("header");
  anchor.after(box);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function show(lines) {
    box.innerHTML = lines.map((l) => `<div>⚠ ${l}</div>`).join("");
    box.hidden = !lines.length;
  }
  async function poll() {
    let s = null;
    try {
      const r = await fetch("/api/v1/sync");
      if (r.ok) s = await r.json();
    } catch (e) { /* server down */ }
    const lines = [];
    if (!s) lines.push("Server not answering: is start_server.bat running? Reload the page once it is.");
    else {
      const b = s.board, v = s.vicon;
      if (b.target && !b.connected) lines.push(`Teensy <b>${esc(b.target)}</b> not connected: ${esc(b.message || "connecting…")}. Retrying every 5 s.`);
      if (v.target && !v.connected) lines.push(`Vicon <b>${esc(v.target)}</b> not connected: ${esc(v.message || "connecting…")}. Retrying every 5 s.`);
    }
    show(lines);
    document.dispatchEvent(new CustomEvent("bumpem-sync", { detail: s }));
  }
  poll();
  setInterval(poll, 2000);
})();
