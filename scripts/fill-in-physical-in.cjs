#!/usr/bin/env node
/**
 * Fill `physical_in` for every component.
 *
 * Strategy:
 * - Prefer authoritative overrides for known FRC electronics (roboRIO 2.0, PDH, Pneumatic Hub, VRM).
 * - Otherwise, compute inches from viewBox using a single global scale derived from PDH reference.
 *
 * Usage:
 *   node fill-physical-in.js input.json output.json
 */

const fs = require("fs");

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function num(x) {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function getViewBoxWH(c) {
  const vb = c?.svg_meta?.viewBox;
  if (!vb) return null;

  const w = num(vb.width);
  const h = num(vb.height);
  if (!w || !h || w <= 0 || h <= 0) return null;

  return { w, h };
}

/**
 * Given reference viewBox (vw,vh) and real dims (rw,rh),
 * decide whether viewBox axes match (w->w,h->h) or swapped (w->h,h->w),
 * and compute best-fit inches-per-unit scale.
 */
function deriveScaleFromRef(vw, vh, rw, rh) {
  // option A: no swap
  const sA_w = rw / vw;
  const sA_h = rh / vh;
  const sA = (sA_w + sA_h) / 2;
  const errA =
    Math.abs(vw * sA - rw) / rw +
    Math.abs(vh * sA - rh) / rh;

  // option B: swapped
  const sB_w = rw / vh;
  const sB_h = rh / vw;
  const sB = (sB_w + sB_h) / 2;
  const errB =
    Math.abs(vh * sB - rw) / rw +
    Math.abs(vw * sB - rh) / rh;

  if (errB < errA) return { scale: sB, swapped: true, err: errB };
  return { scale: sA, swapped: false, err: errA };
}

/**
 * Authoritative overrides (inches).
 * Keys must match your component `id`.
 *
 * NOTE: If any of these ids differ in your data, update the keys.
 */
const OVERRIDES = {
  // roboRIO 2.0 physical characteristics: 5.75 in x 5.64 in x 1.37 in
  // We'll store footprint (w,h). Thickness can be stored as `t` if you want.
  "roborio-2-0": { w: 5.75, h: 5.64, t: 1.37, source: "ni_roborio_2.0_specs" },

  // REV PDH (using overall extents shown on drawing: ~8.88 in and 4.38 in)
  // Orientation in your SVG may be portrait; we handle swap when deriving scale too.
  "pdh-no-fuses": { w: 4.38, h: 8.88, t: 1.56, source: "rev_pdh_drawing" },

  // REV Pneumatic Hub drawing shows 4.38 in and 1.88 in (plus other dims)
  "rev-pneumatic-hub": { w: 4.38, h: 1.88, source: "rev_ph_drawing" },

  // CTRE VRM mechanical specs: 2.220 x 2.030 x 0.784
  "vrm": { w: 2.220, h: 2.030, t: 0.784, source: "ctre_vrm_users_guide" },
};

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) die("Usage: node fill-physical-in.js input.json output.json");

  const raw = fs.readFileSync(inPath, "utf8");
  const data = JSON.parse(stripJsonComments(raw));

  function stripJsonComments(s) {
    // remove /* ... */ block comments
    s = s.replace(/\/\*[\s\S]*?\*\//g, "");
    // remove // line comments (naive but works for typical JSONC)
    s = s.replace(/(^|\s)\/\/.*$/gm, "$1");
    return s;
  }


  if (!Array.isArray(data.components)) die("Input JSON missing `components` array.");

  // Find PDH reference to derive global scale
  const ref = data.components.find((c) => c.id === "pdh-no-fuses");
  if (!ref) die('Reference component id "pdh-no-fuses" not found.');

  const vb = getViewBoxWH(ref);
  if (!vb) die("Reference component missing svg_meta.viewBox width/height.");

  // Use authoritative PDH dims if provided, else die
  const pdhOverride = OVERRIDES["pdh-no-fuses"];
  if (!pdhOverride) die("Missing PDH override in script.");

  const { scale, swapped, err } = deriveScaleFromRef(
    vb.w,
    vb.h,
    // treat override as footprint dims, but allow matching with swap
    pdhOverride.w,
    pdhOverride.h
  );

  // Attach meta at top-level for traceability
  data.physical_scale = {
    method: "single_reference_scale",
    reference_id: "pdh-no-fuses",
    reference_real_in: { w: pdhOverride.w, h: pdhOverride.h },
    reference_viewbox: { w: vb.w, h: vb.h },
    inches_per_viewbox_unit: scale,
    reference_axis_swapped: swapped,
    relative_fit_error: err,
    note:
      "All non-overridden components are scaled from their SVG viewBox using one global inches-per-unit. If SVGs are from mixed sources/scales, results will be wrong; add per-component overrides instead.",
  };

  data.components = data.components.map((c) => {
    const v = getViewBoxWH(c);
    if (!v) return c;

    const ov = OVERRIDES[c.id];
    if (ov) {
      return {
        ...c,
        physical_in: { w: ov.w, h: ov.h, ...(ov.t ? { t: ov.t } : {}) },
        physical_in_source: ov.source,
      };
    }

    // Apply global scale, respecting possible axis swap determined from PDH
    const vbW = swapped ? v.h : v.w;
    const vbH = swapped ? v.w : v.h;

    return {
      ...c,
      physical_in: { w: round3(vbW * scale), h: round3(vbH * scale) },
      physical_in_source: "scaled_from_pdh_reference_viewbox",
    };
  });

  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Wrote: ${outPath}`);
  console.log(`Global inches/unit: ${scale} (axis_swapped=${swapped}, fit_err=${err})`);
}

main();
