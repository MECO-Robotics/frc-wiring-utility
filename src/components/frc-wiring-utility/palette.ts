import paletteIndex from "@/assets/wiring-components/palette.json";
import { resolveComponent, resolveSvgUrl, slugCheck } from "./paletteResolvers";
import type { PaletteIndexJson, PaletteItem } from "./paletteTypes";

export type { PaletteComponentJson, PaletteItem, PalettePort, PaletteIndexJson, PortType, SvgMeta } from "./paletteTypes";

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

export type DeviceType = PaletteItem["id"];

