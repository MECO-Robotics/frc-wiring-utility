import { PALETTE_BY_ID } from "../../core/paletteLookup";

export const PX_PER_IN = 60; // MUST match CanvasNode.tsx or your dragging/fit math won't match visuals.

export function nodeSizePx(type: unknown, placementScale: number | undefined, fallbackW: number, fallbackH: number) {
    const item = PALETTE_BY_ID.get(String(type));
    const s = typeof placementScale === "number" && Number.isFinite(placementScale) && placementScale > 0 ? placementScale : 1;

    const phys = (item as unknown as { physical_in?: { w?: number; h?: number } } | undefined)?.physical_in;
    const w_in = phys?.w;
    const h_in = phys?.h;

    if (Number.isFinite(w_in) && Number.isFinite(h_in) && w_in > 0 && h_in > 0) {
        return { w: w_in * PX_PER_IN * s, h: h_in * PX_PER_IN * s };
    }
    return { w: fallbackW * s, h: fallbackH * s };
}

export function canvasPointFromEvent(el: HTMLDivElement | null, clientX: number, clientY: number) {
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
}

export function screenToWorld(sx: number, sy: number, pan: { x: number; y: number }, zoom: number) {
    return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom };
}

export function worldToScreen(x: number, y: number, pan: { x: number; y: number }, zoom: number) {
    return { sx: x * zoom + pan.x, sy: y * zoom + pan.y };
}

