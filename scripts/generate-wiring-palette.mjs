import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dir = path.join(root, "src", "assets", "wiring-components");
const out = path.join(dir, "palette.json");

const svgs = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".svg"));

function titleCaseFromFile(file) {
  return file
    .replace(/\.svg$/i, "")
    .split(/[-_ ]+/g)
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function slugFromFile(file) {
  return file
    .replace(/\.svg$/i, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseNumberWithUnit(s) {
  // Accepts: "32", "32px", "32.5pt", "1in", etc.
  // Converts to px with best-guess conversions for common units.
  if (!s) return null;
  const m = String(s).trim().match(/^([0-9]*\.?[0-9]+)\s*([a-z%]*)$/i);
  if (!m) return null;

  const value = Number(m[1]);
  const unit = (m[2] || "").toLowerCase();

  if (!Number.isFinite(value)) return null;

  // Best-guess conversions (SVG spec depends on CSS px; these are common defaults):
  // 1in = 96px, 1pt = 1.3333px, 1pc = 16px, 1cm = 37.795px, 1mm = 3.7795px
  switch (unit) {
    case "":
    case "px":
      return value;
    case "pt":
      return value * (96 / 72);
    case "pc":
      return value * 16;
    case "in":
      return value * 96;
    case "cm":
      return value * (96 / 2.54);
    case "mm":
      return value * (96 / 25.4);
    // "%" isn't meaningful without context; treat as unknown
    default:
      return null;
  }
}

function parseSvgMeta(svgText) {
  // NOTE: this is intentionally minimal parsing (not a full XML parser)
  // Extracts <svg ...> attrs: viewBox, width, height
  const svgOpen = svgText.match(/<svg\b[^>]*>/i);
  if (!svgOpen) return null;

  const tag = svgOpen[0];

  const viewBoxMatch = tag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  const widthMatch = tag.match(/\bwidth\s*=\s*["']([^"']+)["']/i);
  const heightMatch = tag.match(/\bheight\s*=\s*["']([^"']+)["']/i);

  const viewBoxRaw = viewBoxMatch ? viewBoxMatch[1].trim() : null;
  const widthRaw = widthMatch ? widthMatch[1].trim() : null;
  const heightRaw = heightMatch ? heightMatch[1].trim() : null;

  let vb = null;
  if (viewBoxRaw) {
    const parts = viewBoxRaw.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
      vb = { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
    }
  }

  const widthPx = parseNumberWithUnit(widthRaw);
  const heightPx = parseNumberWithUnit(heightRaw);

  // Fallback sizing logic:
  // - Prefer explicit width/height if both parse
  // - Else prefer viewBox dimensions
  // - Else nulls
  const finalWidth =
    widthPx != null ? widthPx :
    vb ? vb.width :
    null;

  const finalHeight =
    heightPx != null ? heightPx :
    vb ? vb.height :
    null;

  return {
    viewBox: vb,                 // null or {minX,minY,width,height}
    widthAttr: widthRaw,         // raw strings (may include units)
    heightAttr: heightRaw,
    widthPx: finalWidth,
    heightPx: finalHeight,
    aspect: (finalWidth && finalHeight) ? (finalWidth / finalHeight) : null
  };
}

const components = svgs
  .sort((a, b) => a.localeCompare(b))
  .map(file => {
    const full = path.join(dir, file);
    const text = fs.readFileSync(full, "utf8");
    const meta = parseSvgMeta(text);

    const id = slugFromFile(file);
    const name = titleCaseFromFile(file);

    return {
      id,
      name,
      svg: file,
      category: "uncategorized",
      tags: [],
      defaults: { rotation: 0, scale: 1 },
      svg_meta: meta,
      ports: []
    };
  });

const palette = {
  version: 2,
  units: "relative",
  coordinate_system: "component_bbox",
  port_types: ["ethernet", "4_gauge", "12_gauge", "18_gauge", "usb"],
  components
};

fs.writeFileSync(out, JSON.stringify(palette, null, 2) + "\n", "utf8");
console.log(`Wrote ${out} with ${components.length} components.`);
