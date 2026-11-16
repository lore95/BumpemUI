// Study protocol parameters (U13; final list U21, server D50): edit only this file to change the fields.
// Field: key (CSV column), label, type text | number | choice | list (numbers separated by spaces) | pattern (a saved
// pattern's name, options from the server), unit, min, max, int, options (choice), map (choice text → API value),
// required, example (template), hint, show {otherKey: value} (field used only then).
// note (values, ctx) → text shown under the field. checks (values, ctx) → [[key, message, alert?], ...]: rules across
// fields; alert = also shown in red in the block's header line.
// Values are the strings as typed or imported; ctx = {subject: subject values, maxN: board max pulse force or null,
// patterns: {name: pattern with items} saved on the server, patternsLoaded}.
// summary: keys shown in a block's header line. templateBlocks: example blocks of the template (overrides of `example`).
"use strict";
const num = (s) => { s = String(s ?? "").trim().replace(",", "."); return s !== "" && isFinite(s) ? Number(s) : NaN; };   // 72,5 from German Excel
const G = 9.81;
// steps per second (both feet) assumed by the duration check until a real gait pattern is measured (BumpemActivation
// checks again with it): typical treadmill cadence, walking ~108 steps/min, running ~168 steps/min
const CADENCE = { walking: 1.8, running: 2.8 };
const mode = (ctx) => (ctx.subject.mode === "running" ? "running" : "walking");
function pullN(v, ctx) {   // amplitude in N, from either unit
  const a = num(v.amplitude), m = num(ctx.subject.mass_kg);
  return v.amplitude_mode === "absolute N" ? a : a / 100 * m * G;
}
function phaseName(x, md) {   // % of the gait cycle (touch-down → touch-down of the same foot)
  if (md === "running") return x < 40 ? "stance" : x < 55 || x >= 85 ? "flight" : "swing";
  return x < 10 ? "loading (double support)" : x < 50 ? "single stance" : x < 60 ? "push-off (double support)" : "swing";
}

const SCHEMA = {
  version: "final-1",
  subject: {
    title: "Subject",
    fields: [
      { key: "subject_id", label: "Subject code", type: "text", required: true, example: "S014", hint: "Code only, never the name" },
      { key: "mass_kg", label: "Body mass", type: "number", unit: "kg", min: 20, max: 200, required: true, example: "72.5",
        note: (v) => num(v.mass_kg) > 0 ? `${(num(v.mass_kg) * G).toFixed(0)} N body weight` : "" },
      { key: "height_cm", label: "Height", type: "number", unit: "cm", min: 100, max: 230, required: true, example: "178" },
      { key: "mode", label: "Mode", type: "choice", options: ["walking", "running"], required: true, example: "walking",
        hint: "Sets the cadence for the duration check, the gait-phase names and the gait-pattern check" },
      { key: "baseline_n", label: "Baseline rope tension", type: "number", unit: "N", min: 0, max: 20, required: true, example: "4",
        hint: "Hold force between pulls; set on the board at Arm" },
    ],
  },
  block: {
    title: "Block",
    fields: [
      { key: "label", label: "Block name", type: "text", required: true, example: "Main 1" },
      { key: "speed_ms", label: "Treadmill speed", type: "number", unit: "m/s", min: 0.3, max: 6, required: true, example: "1.2" },
      { key: "duration_s", label: "Block duration", type: "number", unit: "s", min: 10, max: 7200, required: true, example: "300" },
      { key: "warmup_s", label: "Warm-up", type: "number", unit: "s", min: 0, max: 600, required: true, example: "30",
        hint: "No pulls and no steps counted at the start" },
      { key: "n_perturbations", label: "Number of perturbations", type: "number", int: true, min: 1, max: 500, required: true, example: "10" },
      { key: "pattern", label: "Pattern", type: "pattern", required: true, example: "",
        hint: "Directions + step gaps, the same for every participant (make one in BumpemPattern)",
        note: (v, ctx) => { const p = ctx.patterns[v.pattern]; if (!p) return ""; const g = p.items.map((i) => i.gap_steps);
          return `${p.items.length} perturbations, gaps ${Math.min(...g)}–${Math.max(...g)} steps`; } },
      { key: "trigger_side", label: "Leg for the phase", type: "choice", options: ["left", "right", "any"], required: true, example: "left",
        hint: "Its touch-down starts the gait cycle" },
      { key: "gait_phase_pct", label: "Gait-cycle phase of the pull", type: "number", unit: "% of the cycle", min: 0, max: 99.9, required: true, example: "30",
        note: (v, ctx) => { const x = num(v.gait_phase_pct); return isNaN(x) ? "" : `${phaseName(x, mode(ctx))} (${mode(ctx)})`; } },
      { key: "phase1_ms", label: "Ramp up", type: "number", unit: "ms", min: 0, max: 500, required: true, example: "50" },
      { key: "phase2_ms", label: "Ramp down", type: "number", unit: "ms", min: 0, max: 500, required: true, example: "50" },
      { key: "amplitude_mode", label: "Amplitude as", type: "choice", options: ["% body weight", "absolute N"],
        map: { "% body weight": "percent_bw", "absolute N": "newton" }, required: true, example: "% body weight" },
      { key: "amplitude", label: "Amplitude", type: "number", min: 0.1, max: 200, required: true, example: "10",
        note: (v, ctx) => {
          const n = pullN(v, ctx), m = num(ctx.subject.mass_kg);
          if (isNaN(n)) return v.amplitude_mode === "absolute N" ? "N" : "% body weight (N needs the body mass)";
          return v.amplitude_mode === "absolute N" ? `N${m > 0 ? ` = ${(n / (m * G) * 100).toFixed(1)} % body weight` : ""}`
            : `% body weight = ${n.toFixed(1)} N`;
        } },
      { key: "dur_ms", label: "Perturbation duration", type: "number", unit: "ms, ramps included", min: 100, max: 1000, required: true, example: "400" },
    ],
    summary: ["label", "speed_ms", "duration_s", "n_perturbations", "pattern"],
    templateBlocks: [{ label: "Familiarisation", n_perturbations: "5", duration_s: "180" }, {}],
    checks: (v, ctx) => {
      const n = (k) => num(v[k]), out = [];
      if (n("phase1_ms") + n("phase2_ms") > n("dur_ms")) out.push(["dur_ms", "shorter than ramp up + ramp down"]);
      if (v.amplitude_mode === "% body weight" && n("amplitude") > 100) out.push(["amplitude", "above 100 % body weight"]);
      const f = pullN(v, ctx);
      if (ctx.maxN !== null && f > ctx.maxN) out.push(["amplitude", `${f.toFixed(0)} N is above the board's max ${ctx.maxN} N`]);
      if (n("warmup_s") >= n("duration_s")) out.push(["warmup_s", "as long as the block"]);
      const p = ctx.patterns[v.pattern];
      if (v.pattern && ctx.patternsLoaded && !p) out.push(["pattern", "not saved on this PC: make it in BumpemPattern"]);
      if (p && n("n_perturbations") > p.items.length) out.push(["n_perturbations", `the pattern has only ${p.items.length}`]);
      else if (p && n("duration_s") > 0) {               // do the perturbations fit in the block's time?
        const md = mode(ctx), cad = CADENCE[md], extra = v.trigger_side === "any" ? 0 : 1;
        let t = n("warmup_s") || 0, k = 0;
        for (const it of p.items.slice(0, n("n_perturbations"))) {
          t += (it.gap_steps + extra) / cad;
          if (t > n("duration_s")) break;
          k++;
        }
        if (k < n("n_perturbations"))
          out.push(["n_perturbations", `too many for ${n("duration_s")} s: at most ${k} fit (${md} ≈ ${Math.round(cad * 60)} steps/min, gaps from the pattern)`, true]);
      }
      return out;
    },
  },
};
