export type PortType = "ethernet" | "4_gauge" | "12_gauge" | "18_gauge" | "usb";

export type PalettePort = {
    id: string;
    type: PortType;
    x: number;
    y: number;
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
    id: string;
    name: string;
    svg: string;
    category: string;
    tags: string[];
    defaults: { rotation: number; scale: number };
    svg_meta: SvgMeta;
    ports: PalettePort[];
    svgUrl: string;
};

export type PaletteIndexJson = {
    version: number;
    units: "relative";
    coordinate_system: "component_bbox";
    port_types: PortType[];
    components: string[];
    physical_scale?: unknown;
};

export type PaletteComponentJson = Omit<PaletteItem, "svgUrl">;

