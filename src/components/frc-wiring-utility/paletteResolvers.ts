import type { PaletteComponentJson } from "./paletteTypes";

const SVG_BASE = "/src/assets/wiring-components/";

const SVG_URLS = import.meta.glob("/src/assets/wiring-components/svg/*.svg", {
    eager: true,
    as: "url",
}) as Record<string, string>;

const COMPONENTS = import.meta.glob(
    "/src/assets/wiring-components/configs/*.json",
    { eager: true, import: "default" }
) as Record<string, PaletteComponentJson>;

function normalizePath(path: string) {
    return path.replaceAll("\\", "/").replace(/^\.?\//, "");
}

function toGlobKey(relPath: string) {
    return `${SVG_BASE}${normalizePath(relPath)}`;
}

function resolveBySuffix<T>(map: Record<string, T>, relPath: string) {
    const suffix = `/${normalizePath(relPath)}`;
    const key = Object.keys(map).find((k) => k.endsWith(suffix));
    return key ? map[key] : undefined;
}

export function resolveSvgUrl(svgRelPath: string): string {
    const key = toGlobKey(svgRelPath);
    const hit = SVG_URLS[key] ?? resolveBySuffix(SVG_URLS, svgRelPath);
    if (hit) return hit;

    const sample = Object.keys(SVG_URLS).slice(0, 8).join("\n  ");
    throw new Error(
        `Missing SVG asset: ${svgRelPath}\n` +
        `Tried key: ${key}\n` +
        `Available keys (sample):\n  ${sample}\n`
    );
}

export function resolveComponent(componentRelPath: string): PaletteComponentJson {
    const key = toGlobKey(componentRelPath);
    const hit = COMPONENTS[key] ?? resolveBySuffix(COMPONENTS, componentRelPath);
    if (hit) return hit;

    const sample = Object.keys(COMPONENTS).slice(0, 8).join("\n  ");
    throw new Error(
        `Missing component JSON: ${componentRelPath}\n` +
        `Tried key: ${key}\n` +
        `Available keys (sample):\n  ${sample}\n`
    );
}

export function slugCheck(id: string) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        throw new Error(`Invalid component id "${id}" (expected kebab-case)`);
    }
}

