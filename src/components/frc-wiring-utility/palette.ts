import paletteDef from "@/assets/wiring-components/palette.json";

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

type PaletteJson = {
    version: number;
    units: "relative";
    coordinate_system: "component_bbox";
    port_types: PortType[];
    components: Array<Omit<PaletteItem, "svgUrl">>;
};

// Vite: eager import so we have URLs at runtime
const svgUrlModules = import.meta.glob(
    "/src/assets/wiring-components/*.svg",
    { eager: true, import: "default" }
) as Record<string, string>;


function resolveSvgUrl(svgFile: string): string {
    const suffix = `/wiring-components/${svgFile}`;
    const hitKey = Object.keys(svgUrlModules).find((k) => k.endsWith(suffix));
    if (!hitKey) throw new Error(`Missing SVG asset: ${svgFile}`);
    return svgUrlModules[hitKey];
}

function slugCheck(id: string) {
    // Keep this strict so IDs are safe keys
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        throw new Error(`Invalid component id "${id}" (expected kebab-case)`);
    }
}

const def = paletteDef as unknown as PaletteJson;

const seen = new Set<string>();
export const PALETTE: PaletteItem[] = def.components.map((c) => {
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
