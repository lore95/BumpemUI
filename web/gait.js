// Running gait-cycle picker: phase bar (thesis Fig. 1: stance 0-40 %, float 40-55 %, swing 55-85 %, float 85-100 %)
// and 8 stick-figure runners drawn from approximate joint-angle curves (own drawing, not the thesis image).
// Gait.init(svg, onSelect) ; Gait.set(cyclePct)
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const BANDS = [[0, 40, "STANCE", "#1f6f57"], [40, 55, "FLOAT", "#3a423e"], [55, 85, "SWING", "#e8ece9"], [85, 100, "FLOAT", "#3a423e"]];
  const X0 = 40, BAR_W = 800, BAR_Y = 18, BAR_H = 22, GROUND = 196;
  const RUNNERS = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5];

  // near-side (highlighted) leg, degrees; hip: thigh from vertical (+ forward); knee: flexion
  const HIP = [[0, 25], [10, 15], [20, 5], [30, -8], [40, -18], [50, -12], [60, 5], [70, 25], [80, 38], [90, 34], [100, 25]];
  const KNEE = [[0, 12], [10, 35], [20, 40], [30, 30], [40, 18], [50, 45], [60, 80], [70, 105], [80, 70], [90, 25], [100, 12]];
  const L = { thigh: 34, shank: 34, foot: 10, trunk: 40, upper: 24, fore: 21, head: 7 };

  function interp(keys, pct) {
    const p = ((pct % 100) + 100) % 100;
    for (let i = 0; i < keys.length - 1; i++) {
      const [a, va] = keys[i], [b, vb] = keys[i + 1];
      if (p >= a && p <= b) return va + (vb - va) * (p - a) / (b - a);
    }
    return keys[0][1];
  }
  const rad = (d) => d * Math.PI / 180;
  const add = (p, ang, len) => [p[0] + Math.sin(rad(ang)) * len, p[1] + Math.cos(rad(ang)) * len];   // ang from straight down, + forward

  function pose(pct) {
    const hip = [0, 0];
    const leg = (c) => {
      const a = interp(HIP, c), s = a - interp(KNEE, c);
      const knee = add(hip, a, L.thigh), ankle = add(knee, s, L.shank);
      const toe = [ankle[0] + Math.cos(rad(s)) * L.foot, ankle[1] - Math.sin(rad(s)) * L.foot];
      return { a, knee, ankle, toe };
    };
    const near = leg(pct), far = leg(pct + 50);
    const shoulder = add(hip, 180 - 8, L.trunk);                     // trunk leans 8 deg forward
    const head = add(shoulder, 180 - 12, L.head + 6);
    const arm = (legAngle) => {
      const u = -0.8 * legAngle, elbow = add(shoulder, u, L.upper);
      return { elbow, hand: add(elbow, u + 95, L.fore) };
    };
    const lowest = Math.max(near.ankle[1], near.toe[1], far.ankle[1], far.toe[1]);
    const p = ((pct % 100) + 100) % 100;
    const flying = (p > 40 && p < 50) || p > 90;                      // both feet off the ground
    return { near, far, shoulder, head, armNear: arm(near.a), armFar: arm(far.a), lift: flying ? 7 : 0, lowest };
  }

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawRunner(parent, pct, cx) {
    const P = pose(pct), dy = GROUND - P.lowest - P.lift;
    const T = (pt) => `${(cx + pt[0]).toFixed(1)},${(dy + pt[1]).toFixed(1)}`;
    const g = el("g", {}, parent);
    const line = (pts, cls) => el("polyline", { points: pts.map(T).join(" "), class: cls }, g);
    line([P.shoulder, P.armFar.elbow, P.armFar.hand], "far");
    line([[0, 0], P.far.knee, P.far.ankle, P.far.toe], "far");
    line([[0, 0], P.shoulder], "near");
    line([[0, 0], P.near.knee, P.near.ankle, P.near.toe], "near");
    line([P.shoulder, P.armNear.elbow, P.armNear.hand], "near");
    el("circle", { cx: (cx + P.head[0]).toFixed(1), cy: (dy + P.head[1]).toFixed(1), r: L.head, class: "head" }, g);
  }

  let svg, onSelect, marker, runnerEls = [];
  const barX = (pct) => X0 + BAR_W * pct / 100;

  function init(svgEl, cb) {
    svg = svgEl; onSelect = cb;
    for (const [a, b, label, color] of BANDS) {
      el("rect", { x: barX(a), y: BAR_Y, width: barX(b) - barX(a), height: BAR_H, fill: color, class: "gait-band" }, svg);
      const t = el("text", { x: (barX(a) + barX(b)) / 2, y: BAR_Y + 15, class: "gait-band-label" }, svg);
      t.textContent = `${label} (${b - a} %)`;
      if (label === "SWING") t.style.fill = "#050606";
    }
    for (let p = 0; p <= 100; p += 10) {
      el("line", { x1: barX(p), y1: BAR_Y + BAR_H, x2: barX(p), y2: BAR_Y + BAR_H + 4, stroke: "#8b9690" }, svg);
      el("text", { x: barX(p), y: BAR_Y + BAR_H + 15, class: "gait-axis" }, svg).textContent = p;
    }
    marker = el("line", { y1: BAR_Y - 4, y2: BAR_Y + BAR_H + 4, class: "gait-marker" }, svg);
    RUNNERS.forEach((pct, i) => {
      const cx = X0 + 50 + 100 * i;
      const g = el("g", { class: "runner", tabindex: 0, role: "button", "aria-label": `${pct} % of the gait cycle` }, svg);
      el("rect", { x: cx - 48, y: 66, width: 96, height: 160 }, g);
      el("line", { x1: barX(pct), y1: BAR_Y + BAR_H + 18, x2: cx, y2: 70, stroke: "#262d2a" }, g);
      drawRunner(g, pct, cx);
      el("text", { x: cx, y: GROUND + 20, class: "gait-axis" }, g).textContent = `${pct} %`;
      const pick = () => onSelect(pct);
      g.addEventListener("click", pick);
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      runnerEls.push([pct, g]);
    });
    el("line", { x1: X0, y1: GROUND + 1, x2: X0 + BAR_W, y2: GROUND + 1, stroke: "#262d2a" }, svg);
  }

  function set(pct) {
    marker.setAttribute("x1", barX(pct)); marker.setAttribute("x2", barX(pct));
    for (const [p, g] of runnerEls) g.classList.toggle("sel", Math.abs(p - pct) < 1e-6);
  }

  window.Gait = { init, set, phaseOf: (pct) => (BANDS.find(([a, b]) => pct >= a && pct < b) || BANDS[0])[2].toLowerCase() };
})();
