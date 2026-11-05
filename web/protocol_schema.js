// Study protocol parameters (U13). PLACEHOLDER list until the lab's parameter list arrives: edit only this file.
// Field: key (CSV column), label, type text | number | choice | list (numbers separated by spaces), unit, min, max,
// int, options (choice), required, example (template), hint, show {otherKey: value} (field used only then).
// note (values, ctx) → text shown under the field. checks (values, ctx) → [[key, message], ...]: rules across fields.
// Values are the strings as typed or imported; ctx = {subject: subject values, maxN: board max pulse force or null}.
// summary: keys shown in a block's header line. templateBlocks: example blocks of the template (overrides of `example`).
"use strict";
const num = (s) => { s = String(s ?? "").trim().replace(",", "."); return s !== "" && isFinite(s) ? Number(s) : NaN; };   // 72,5 from German Excel
const pullN = (v, ctx) => num(v.intensity_pct_bw) / 100 * num(ctx.subject.mass_kg) * 9.81;
const SCHEMA = {
  version: "placeholder-1",
  subject: {
    title: "Subject",
    fields: [
      { key: "subject_id", label: "Subject code", type: "text", required: true, example: "S014", hint: "Code only, never the name" },
      { key: "mass_kg", label: "Body mass", type: "number", unit: "kg", min: 20, max: 200, required: true, example: "72.5",
        note: (v) => num(v.mass_kg) > 0 ? `${(num(v.mass_kg) * 9.81).toFixed(0)} N body weight` : "" },
      { key: "height_cm", label: "Height", type: "number", unit: "cm", min: 100, max: 230, required: true, example: "178" },
      { key: "sex", label: "Sex", type: "choice", options: ["f", "m", "d"], required: true, example: "f" },
      { key: "dominant_leg", label: "Dominant leg", type: "choice", options: ["left", "right"], example: "right" },
    ],
  },
  block: {
    title: "Block",
    fields: [
      { key: "label", label: "Block name", type: "text", example: "Familiarisation" },
      { key: "speed_ms", label: "Treadmill speed", type: "number", unit: "m/s", min: 0.5, max: 6, required: true, example: "2.5" },
      { key: "warmup_s", label: "Run-in before first pull", type: "number", unit: "s", min: 0, max: 600, example: "60" },
      { key: "n_perturbations", label: "Perturbations", type: "number", int: true, min: 1, max: 200, required: true, example: "10" },
      { key: "directions_deg", label: "Directions", type: "list", unit: "°", min: -180, max: 180, required: true, example: "90 -90",
        hint: "0 front, +90 left, −90 right, 180 back; several = mixed in the block" },
      { key: "intensity_pct_bw", label: "Intensity", type: "number", unit: "% body weight", min: 0, max: 30, required: true, example: "10",
        note: (v, ctx) => isNaN(pullN(v, ctx)) ? "N needs body mass" : `= ${pullN(v, ctx).toFixed(1)} N` },
      { key: "phase1_ms", label: "Phase 1 (ramp up)", type: "number", unit: "ms", min: 0, max: 500, required: true, example: "50" },
      { key: "dur_ms", label: "Duration (incl. ramps)", type: "number", unit: "ms", min: 100, max: 1000, required: true, example: "400" },
      { key: "phase2_ms", label: "Phase 2 (ramp down)", type: "number", unit: "ms", min: 0, max: 500, required: true, example: "50" },
      { key: "trigger_side", label: "Trigger foot strike", type: "choice", options: ["left", "right", "any"], required: true, example: "any" },
      { key: "gait_phase_pct", label: "Gait phase", type: "number", unit: "% of gait cycle", min: 0, max: 100, required: true, example: "20",
        hint: "After the trigger foot strike",
        note: (v) => { const x = num(v.gait_phase_pct); return isNaN(x) ? "" : `${x < 40 ? "stance" : x < 55 || x >= 85 ? "float" : "swing"} (running cycle)`; } },
      { key: "timing_mode", label: "Timing", type: "choice", options: ["random", "predefined"], required: true, example: "random" },
      { key: "interval_min_steps", label: "Interval min", type: "number", unit: "steps", int: true, min: 5, max: 500, required: true,
        example: "50", show: { timing_mode: "random" } },
      { key: "interval_max_steps", label: "Interval max", type: "number", unit: "steps", int: true, min: 5, max: 500, required: true,
        example: "75", show: { timing_mode: "random" } },
      { key: "schedule_steps", label: "Pull at steps", type: "list", unit: "steps", int: true, min: 1, max: 100000, required: true,
        example: "40 95 160", show: { timing_mode: "predefined" }, hint: "Step numbers from block start, one per perturbation" },
    ],
    summary: ["label", "speed_ms", "intensity_pct_bw", "directions_deg", "timing_mode"],
    templateBlocks: [{}, { label: "Main", n_perturbations: "3", timing_mode: "predefined" }],
    checks: (v, ctx) => {
      const n = (k) => num(v[k]), out = [];
      if (ctx.maxN !== null && pullN(v, ctx) > ctx.maxN) out.push(["intensity_pct_bw", `${pullN(v, ctx).toFixed(0)} N is above the board's max ${ctx.maxN} N`]);
      if (n("phase1_ms") + n("phase2_ms") > n("dur_ms")) out.push(["dur_ms", "shorter than phase 1 + phase 2"]);
      if (v.timing_mode === "random" && n("interval_max_steps") < n("interval_min_steps")) out.push(["interval_max_steps", "below Interval min"]);
      if (v.timing_mode === "predefined" && v.schedule_steps) {
        const s = String(v.schedule_steps).trim().split(/[\s;|/]+/).map(Number);
        if (s.some((x, i) => i && x <= s[i - 1])) out.push(["schedule_steps", "steps must increase"]);
        else if (n("n_perturbations") && s.length !== n("n_perturbations")) out.push(["schedule_steps", `${s.length} steps for ${n("n_perturbations")} perturbations`]);
      }
      return out;
    },
  },
};
