// src/helpers/wires.ts
export type Pt = { x: number; y: number };
export type RouteMode = "H" | "V";

export function snapToGrid(v: number, grid: number) {
    if (!Number.isFinite(grid) || grid <= 0) return v;
    return Math.round(v / grid) * grid;
}

export function defaultRoute(a: Pt, b: Pt, grid: number): Pt[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) return [];

    const horizontalFirst = Math.abs(dx) >= Math.abs(dy);
    if (horizontalFirst) {
        const mx = snapToGrid((a.x + b.x) / 2, grid);
        return [{ x: mx, y: a.y }, { x: mx, y: b.y }];
    } else {
        const my = snapToGrid((a.y + b.y) / 2, grid);
        return [{ x: a.x, y: my }, { x: b.x, y: my }];
    }
}

export function orthogonalizeRoute(a: Pt, b: Pt, bends: Pt[], mode: RouteMode): Pt[] {
    const pts = bends.map((p) => ({ ...p }));
    let prev: Pt = { ...a };

    for (let i = 0; i < pts.length; i++) {
        const wantH = mode === "H" ? i % 2 === 0 : i % 2 === 1;
        if (wantH) pts[i].y = prev.y;
        else pts[i].x = prev.x;
        prev = pts[i];
    }

    if (pts.length > 0) {
        const last = pts[pts.length - 1];
        const lastSegWantH = mode === "H" ? pts.length % 2 === 0 : pts.length % 2 === 1;
        if (lastSegWantH) last.y = b.y;
        else last.x = b.x;
    }

    return pts;
}

export function generateRouteWithBends(a: Pt, b: Pt, grid: number, mode: RouteMode, bendCount: number): Pt[] {
    const aligned = Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6;
    const n = Math.max(0, Math.floor(bendCount));

    if (n === 0) {
        if (aligned) return [];
        if (mode === "H") return [{ x: snapToGrid(b.x, grid), y: snapToGrid(a.y, grid) }];
        return [{ x: snapToGrid(a.x, grid), y: snapToGrid(b.y, grid) }];
    }

    const bends: Pt[] = [];
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        const wantH = mode === "H" ? (i - 1) % 2 === 0 : (i - 1) % 2 === 1;
        if (wantH) bends.push({ x: snapToGrid(a.x + dx * t, grid), y: snapToGrid(a.y, grid) });
        else bends.push({ x: snapToGrid(a.x, grid), y: snapToGrid(a.y + dy * t, grid) });
    }

    return orthogonalizeRoute(a, b, bends, mode).map((p) => ({
        x: snapToGrid(p.x, grid),
        y: snapToGrid(p.y, grid),
    }));
}