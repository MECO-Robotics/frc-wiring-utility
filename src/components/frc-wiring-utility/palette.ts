import paletteIndex from "@/assets/wiring-components/palette.json";

export type PortType = "ethernet" | "4_gauge" | "12_gauge" | "18_gauge" | "usb";

export type PalettePort = {
    id: string;
    type: PortType;
    x: number; // 0..1
    y: number; // 0..1
};

export type SvgMeta = {
    viewBox: { minX: number; minY: number; width: number; height: number } | null;
    widthAttr: string | null;
    heightAttr: string | null;
    widthPx: number | null;
    heightPx: number | null;
    aspect: number | null;
};

export type PaletteItem = {
    id: string; // <- this becomes DeviceType
    name: string;
    svg: string;
    category: string;
    tags: string[];
    defaults: { rotation: number; scale: number };
    svg_meta: SvgMeta;
    ports: PalettePort[];
    svgUrl: string; // resolved at build time
};

type PaletteIndexJson = {
    version: number;
    units: "relative";
    coordinate_system: "component_bbox";
    port_types: PortType[];
    components: string[];
    physical_scale?: unknown;
};

type PaletteComponentJson = Omit<PaletteItem, "svgUrl">;

// palette.ts

// 1) Use an ABSOLUTE glob so keys are stable:
// Keys will look like: "/src/assets/wiring-components/svg/10A Automotive Fuse.svg"
const SVG_URLS = import.meta.glob("/src/assets/wiring-components/svg/*.svg", {
    eager: true,
    as: "url",
}) as Record<string, string>;

const SVG_BASE = "/src/assets/wiring-components/";

/** Normalize palette json "svg" field into the glob key */
function toGlobKey(svgRelPath: string) {
    const clean = svgRelPath
        .replaceAll("\\", "/")
        .replace(/^\.?\//, ""); // remove leading "./" or "/"
    return `${SVG_BASE}${clean}`;
}

export function resolveSvgUrl(svgRelPath: string): string {
    const key = toGlobKey(svgRelPath);
    const hit = SVG_URLS[key];
    if (hit) return hit;

    // Fallback: try to find by suffix (helps if base path differs)
    const clean = svgRelPath.replaceAll("\\", "/").replace(/^\.?\//, "");
    const suffix = `/${clean}`;
    const altKey = Object.keys(SVG_URLS).find((k) => k.endsWith(suffix));
    if (altKey) return SVG_URLS[altKey];

    // Helpful error message
    const sample = Object.keys(SVG_URLS).slice(0, 8).join("\n  ");
    throw new Error(
        `Missing SVG asset: ${svgRelPath}\n` +
        `Tried key: ${key}\n` +
        `Available keys (sample):\n  ${sample}\n`
    );
}

const COMPONENTS = import.meta.glob(
    "/src/assets/wiring-components/configs/*.json",
    { eager: true, import: "default" }
) as Record<string, PaletteComponentJson>;

function toComponentKey(componentRelPath: string) {
    const clean = componentRelPath
        .replaceAll("\\", "/")
        .replace(/^\.?\//, "");
    return `${SVG_BASE}${clean}`;
}

function resolveComponent(componentRelPath: string): PaletteComponentJson {
    const key = toComponentKey(componentRelPath);
    const hit = COMPONENTS[key];
    if (hit) return hit;

    const clean = componentRelPath.replaceAll("\\", "/").replace(/^\.?\//, "");
    const suffix = `/${clean}`;
    const altKey = Object.keys(COMPONENTS).find((k) => k.endsWith(suffix));
    if (altKey) return COMPONENTS[altKey];

    const sample = Object.keys(COMPONENTS).slice(0, 8).join("\n  ");
    throw new Error(
        `Missing component JSON: ${componentRelPath}\n` +
        `Tried key: ${key}\n` +
        `Available keys (sample):\n  ${sample}\n`
    );
}


function slugCheck(id: string) {
    // Keep this strict so IDs are safe keys
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        throw new Error(`Invalid component id "${id}" (expected kebab-case)`);
    }
}

const def = paletteIndex as unknown as PaletteIndexJson;

const seen = new Set<string>();
export const PALETTE: PaletteItem[] = def.components.map((componentPath) => {
    const c = resolveComponent(componentPath);
    slugCheck(c.id);
    if (seen.has(c.id)) throw new Error(`Duplicate palette id: ${c.id}`);
    seen.add(c.id);

    return {
        ...c,
        svgUrl: resolveSvgUrl(c.svg),
    };
});

// Your DeviceType should be the palette id union.
// If you want it as a literal union, keep PALETTE const in a separate file and infer,
// but this is the pragmatic strong-typing step:
export type DeviceType = PaletteItem["id"];
