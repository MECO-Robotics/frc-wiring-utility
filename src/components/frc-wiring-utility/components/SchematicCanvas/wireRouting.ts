import type { Project } from "../../core/types";
import type { PortType } from "../../core/palette";
import type { Pt as WirePt, RouteMode } from "../../../../helpers/wires";
import { generateRouteWithBends, orthogonalizeRoute, snapToGrid } from "../../../../helpers/wires";

export type Pt = WirePt;
type RoutedConnection = Project["connections"][number] & { routeMode?: RouteMode };

export type PortWorld = (deviceId: string, portId: string) => { x: number; y: number; portType: PortType } | null;

export function polylineToSvgPathScreen(pts: { sx: number; sy: number }[]) {
    if (pts.length === 0) return "";
    const [p0, ...rest] = pts;
    return `M ${p0.sx} ${p0.sy} ` + rest.map((p) => `L ${p.sx} ${p.sy}`).join(" ");
}

export function getConnMode(c: RoutedConnection): RouteMode {
    const m = c.routeMode;
    return m === "V" ? "V" : "H";
}

export function polyPointsForConn(
    c: RoutedConnection,
    portWorld: PortWorld,
    grid: number
): { aW: Pt; bW: Pt; mode: RouteMode; bends: Pt[]; pts: Pt[] } | null {
    const a = portWorld(c.from.deviceId, c.from.port);
    const b = portWorld(c.to.deviceId, c.to.port);
    if (!a || !b) return null;

    const aW: Pt = { x: a.x, y: a.y };
    const bW: Pt = { x: b.x, y: b.y };
    const mode = getConnMode(c);

    const bends: Pt[] = Array.isArray(c.route) && c.route.length > 0 ? c.route : generateRouteWithBends(aW, bW, grid, mode, 2);
    const lockedBends = orthogonalizeRoute(aW, bW, bends, mode);

    const pts = [aW, ...lockedBends, bW];
    return { aW, bW, mode, bends: lockedBends, pts };
}

export function ensureRoutePersisted(
    connId: string,
    project: Project,
    onUpdateWireRoute: ((id: string, route: { x: number; y: number }[]) => void) | undefined,
    portWorld: PortWorld,
    grid: number
) {
    if (!onUpdateWireRoute) return;
    const c = project.connections.find((x) => x.id === connId) as RoutedConnection | undefined;
    if (!c) return;
    if (Array.isArray(c.route) && c.route.length > 0) return;

    const info = polyPointsForConn(c, portWorld, grid);
    if (!info) return;

    onUpdateWireRoute(
        connId,
        info.bends.map((p) => ({ x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) }))
    );
}

export function pickSegment(
    connId: string,
    project: Project,
    clientX: number,
    clientY: number,
    portWorld: PortWorld,
    grid: number,
    canvasPointFromEvent: (clientX: number, clientY: number) => { x: number; y: number },
    worldToScreen: (x: number, y: number) => { sx: number; sy: number }
): { segIndex: number; axis: "H" | "V" } | null {
    const c = project.connections.find((x) => x.id === connId) as RoutedConnection | undefined;
    if (!c) return null;

    const info = polyPointsForConn(c, portWorld, grid);
    if (!info) return null;

    const pt = canvasPointFromEvent(clientX, clientY);
    const px = pt.x;
    const py = pt.y;

    let bestI = -1;
    let bestD2 = Number.POSITIVE_INFINITY;
    let bestAxis: "H" | "V" = "H";

    for (let i = 0; i < info.pts.length - 1; i++) {
        const p0 = worldToScreen(info.pts[i].x, info.pts[i].y);
        const p1 = worldToScreen(info.pts[i + 1].x, info.pts[i + 1].y);

        const dx = p1.sx - p0.sx;
        const dy = p1.sy - p0.sy;
        const axis: "H" | "V" = Math.abs(dx) >= Math.abs(dy) ? "H" : "V";

        const vx = p1.sx - p0.sx;
        const vy = p1.sy - p0.sy;
        const wx = px - p0.sx;
        const wy = py - p0.sy;

        const vv = vx * vx + vy * vy;
        const t = vv > 1e-6 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
        const cx = p0.sx + t * vx;
        const cy = p0.sy + t * vy;

        const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
        if (d2 < bestD2) {
            bestD2 = d2;
            bestI = i;
            bestAxis = axis;
        }
    }

    if (bestI < 0) return null;
    return { segIndex: bestI, axis: bestAxis };
}

export function moveSegment(
    connId: string,
    project: Project,
    segIndex: number,
    axis: "H" | "V",
    deltaWorld: number,
    baseRoute: Pt[],
    onUpdateWireRoute: ((id: string, route: { x: number; y: number }[]) => void) | undefined,
    portWorld: PortWorld,
    grid: number
) {
    if (!onUpdateWireRoute) return;

    const c = project.connections.find((x) => x.id === connId) as RoutedConnection | undefined;
    if (!c) return;

    const info = polyPointsForConn(c, portWorld, grid);
    if (!info) return;

    const bends = baseRoute.map((p) => ({ ...p }));
    const nB = bends.length;

    const ptIndexToBendIndex = (pi: number) => {
        if (pi <= 0) return null;
        if (pi >= nB + 1) return null;
        return pi - 1;
    };

    const aB = ptIndexToBendIndex(segIndex);
    const bB = ptIndexToBendIndex(segIndex + 1);

    const snapVal = (v: number) => snapToGrid(v, grid);

    if (axis === "H") {
        const ny = snapVal((aB !== null ? bends[aB].y : bB !== null ? bends[bB].y : info.aW.y) + deltaWorld);
        if (aB !== null) bends[aB].y = ny;
        if (bB !== null) bends[bB].y = ny;
        if (aB === null && bB !== null) bends[bB].y = ny;
        if (bB === null && aB !== null) bends[aB].y = ny;
    } else {
        const nx = snapVal((aB !== null ? bends[aB].x : bB !== null ? bends[bB].x : info.aW.x) + deltaWorld);
        if (aB !== null) bends[aB].x = nx;
        if (bB !== null) bends[bB].x = nx;
        if (aB === null && bB !== null) bends[bB].x = nx;
        if (bB === null && aB !== null) bends[aB].x = nx;
    }

    const locked = orthogonalizeRoute(info.aW, info.bW, bends, info.mode).map((p) => ({
        x: snapToGrid(p.x, grid),
        y: snapToGrid(p.y, grid),
    }));

    onUpdateWireRoute(connId, locked);
}

export function setBendCount(
    connId: string,
    project: Project,
    count: number,
    onUpdateWireRoute: ((id: string, route: { x: number; y: number }[]) => void) | undefined,
    portWorld: PortWorld,
    grid: number
) {
    if (!onUpdateWireRoute) return;
    const c = project.connections.find((x) => x.id === connId) as RoutedConnection | undefined;
    if (!c) return;

    const info = polyPointsForConn(c, portWorld, grid);
    if (!info) return;

    const next = generateRouteWithBends(info.aW, info.bW, grid, info.mode, count);
    onUpdateWireRoute(connId, next);
}


