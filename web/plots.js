// Live force plots, last 10 s (U7): rope force per module (tower sensors), ground force per plate (Vicon).
// Shared by index.html (app.js) and study.html (study.js).
"use strict";
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

// hist: telemetry messages (t_ms, target, measured); on: modules to draw
function drawRopePlot(canvas, hist, on) {
  const [g, W, H] = fitCanvas(canvas), L = 44;
  let fmax = 20;
  for (const s of hist) for (const m of on) fmax = Math.max(fmax, s.target[m] || 0, s.measured[m] || 0);
  fmax = Math.ceil(fmax * 1.15 / 10) * 10;
  const Y = axes(g, W, H, 0, fmax, L);
  if (hist.length < 2) return;
  const t1 = hist[hist.length - 1].t_ms, X = (t) => L + (W - L - 4) * (1 - (t1 - t) / 10000);
  for (const m of on) {
    g.strokeStyle = color(`--ch-${m}`);
    for (const [key, dash] of [["target", [5, 4]], ["measured", []]]) {
      g.setLineDash(dash); g.lineWidth = key === "measured" ? 2.2 : 1.4; g.beginPath();
      hist.forEach((s, i) => { const x = X(s.t_ms), y = Y(s[key][m] || 0); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
    }
    g.setLineDash([]);
  }
}

// vhist: vicon messages (host_s, fz); marks: [{t: host_s, color, text}] drawn as ticks at the top (foot strikes, pulses)
function drawGroundPlot(canvas, vhist, plates, marks) {
  const [g, W, H] = fitCanvas(canvas), L = 52;
  let dmin = 0, dmax = 100;
  for (const s of vhist) for (const p of plates) { dmin = Math.min(dmin, s.fz[p] ?? 0); dmax = Math.max(dmax, s.fz[p] ?? 0); }
  if (dmin > -0.05 * dmax) dmin = 0;   // noise around 0 N: keep 0 at the bottom
  let step = Math.ceil((dmax - dmin) * 1.1 / 5 / 100) * 100, lo = Math.floor(dmin / step) * step;   // gridlines on whole 100 N
  while (lo + 5 * step < dmax) step += 100;
  const Y = axes(g, W, H, lo, lo + 5 * step, L);
  if (vhist.length < 2) return;
  const t1 = vhist[vhist.length - 1].host_s, X = (t) => L + (W - L - 4) * (1 - (t1 - t) / 10);
  plates.forEach((p, k) => {
    g.strokeStyle = color(`--plate-${k % 2}`); g.lineWidth = 2; g.beginPath();
    vhist.forEach((s, i) => { const x = X(s.host_s), y = Y(s.fz[p] ?? 0); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  });
  for (const m of marks || []) {
    if (m.t < t1 - 10 || m.t > t1) continue;
    const x = X(m.t);
    g.strokeStyle = g.fillStyle = m.color; g.lineWidth = m.text ? 2 : 1.5; g.beginPath();
    g.moveTo(x, 4); g.lineTo(x, m.text ? H - 22 : 16); g.stroke();
    if (m.text) g.fillText(m.text, x + 4, 16);
  }
}
