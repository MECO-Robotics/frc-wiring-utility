import React, { useRef, useState } from "react";
import type { DeviceType, Project } from "../types";
import { CanvasNode } from "./CanvasNode";
import { clamp, getPlacement, snapCenterToTopLeft, snapTopLeftByCenter } from "../helpers";
import { PALETTE_BY_ID } from "../paletteLookup";
import type { PortType } from "../palette";

const PX_PER_IN = 60; // MUST match CanvasNode.tsx or your dragging/fit math won't match visuals.

function nodeSizePx(type: unknown, placementScale: number | undefined, fallbackW: number, fallbackH: number) {
    const item = PALETTE_BY_ID.get(type as any);

    const s = typeof placementScale === "number" && Number.isFinite(placementScale) && placementScale > 0 ? placementScale : 1;

    const phys = (item as any)?.physical_in;
    const w_in = phys?.w;
    const h_in = phys?.h;

    if (Number.isFinite(w_in) && Number.isFinite(h_in) && w_in > 0 && h_in > 0) {
        return { w: w_in * PX_PER_IN * s, h: h_in * PX_PER_IN * s };
    }

    return { w: fallbackW * s, h: fallbackH * s };
}

type Pt = { x: number; y: number };

function snapToGrid(v: number, grid: number) {
    if (!Number.isFinite(grid) || grid <= 0) return v;
    return Math.round(v / grid) * grid;
}

function defaultRoute(a: Pt, b: Pt, grid: number): Pt[] {
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

function orthoRouteWorld(a: Pt, b: Pt, grid: number): Pt[] {
    const bends = defaultRoute(a, b, grid);
    return [a, ...bends, b];
}

function polylineToSvgPathScreen(pts: { sx: number; sy: number }[]) {
    if (pts.length === 0) return "";
    const [p0, ...rest] = pts;
    return `M ${p0.sx} ${p0.sy} ` + rest.map((p) => `L ${p.sx} ${p.sy}`).join(" ");
}

export function SchematicCanvas(props: {
    project: Project;
    selectedDeviceId: string | null;
    setSelectedDeviceId: (id: string | null) => void;
    GRID: number;
    NODE_W: number;
    NODE_H: number;
    onDropCreate: (type: DeviceType, x: number, y: number) => void;
    onMovePlacement: (deviceId: string, x: number, y: number) => void;
    wireMode?: boolean;
    onCreateWire?: (fromDeviceId: string, fromPortId: string, toDeviceId: string, toPortId: string, portType: PortType) => void;
    onUpdateWireRoute?: (connId: string, route: { x: number; y: number }[]) => void;
    onUpdateWireMeta?: (connId: string, patch: Record<string, any>) => void; // routeMode, etc    registerCenterFn?: (fn: () => void) => void;
}) {
    const {
        project,
        selectedDeviceId,
        setSelectedDeviceId,
        GRID,
        NODE_W,
        NODE_H,
        onDropCreate,
        onMovePlacement,
        wireMode = false,
        onCreateWire,
        onUpdateWireRoute,
        onUpdateWireMeta,
    } = props;

    const canvasRef = useRef<HTMLDivElement | null>(null);

    // screen = world * zoom + pan
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);

    const ZOOM_MIN = 0.3;
    const ZOOM_MAX = 2.5;

    const panDragRef = useRef<{
        active: boolean;
        startClientX: number;
        startClientY: number;
        originPanX: number;
        originPanY: number;
        moved: boolean;
    } | null>(null);

    const nodeDragRef = useRef<{
        deviceId: string;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        nodeW: number;
        nodeH: number;
    } | null>(null);

    type BendDrag = {
        connId: string;
        bendIndex: number; // index in c.route[]
        pointerId: number;
    };

    const [bendDrag, setBendDrag] = useState<BendDrag | null>(null);

    type WireDrag = {
        fromDeviceId: string;
        fromPortId: string;
        fromPortType: PortType;
        pointerSx: number; // canvas-local screen coords
        pointerSy: number;
    };

    type Pt = { x: number; y: number };
    type RouteMode = "H" | "V";

    function snapToGrid(v: number, grid: number) {
        if (!Number.isFinite(grid) || grid <= 0) return v;
        return Math.round(v / grid) * grid;
    }

    // Enforce orthogonality by projecting each bend onto the required axis vs previous point.
    // Alternates H/V segments starting from mode. Guarantees last segment axis-aligned by adjusting last bend if needed.
    function orthogonalizeRoute(a: Pt, b: Pt, bends: Pt[], mode: RouteMode): Pt[] {
        const pts = bends.map((p) => ({ ...p }));
        let prev: Pt = { ...a };

        for (let i = 0; i < pts.length; i++) {
            const wantH = mode === "H" ? i % 2 === 0 : i % 2 === 1; // segment prev->pts[i]
            if (wantH) {
                pts[i].y = prev.y;
            } else {
                pts[i].x = prev.x;
            }
            prev = pts[i];
        }

        // Ensure last segment (lastBend->b) is axis aligned by nudging last bend if needed
        if (pts.length > 0) {
            const last = pts[pts.length - 1];
            const lastSegWantH = mode === "H" ? pts.length % 2 === 0 : pts.length % 2 === 1; // segment last->b
            if (lastSegWantH) {
                // horizontal into b => y must match
                last.y = b.y;
            } else {
                // vertical into b => x must match
                last.x = b.x;
            }
        } else {
            // no bends: if not aligned, caller should ensure at least 1 bend when locking orthogonal
        }

        return pts;
    }

    // Generate an orthogonal route with N bends. Works for N=0 too (but if not aligned, returns 1 bend).
    function generateRouteWithBends(a: Pt, b: Pt, grid: number, mode: RouteMode, bendCount: number): Pt[] {
        const aligned = Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6;

        // If bendCount=0 but not aligned, we still need 1 bend to stay orthogonal.
        const n = Math.max(0, Math.floor(bendCount));
        if (n === 0) {
            if (aligned) return [];
            if (mode === "H") return [{ x: snapToGrid(b.x, grid), y: snapToGrid(a.y, grid) }];
            return [{ x: snapToGrid(a.x, grid), y: snapToGrid(b.y, grid) }];
        }

        // Evenly distribute “primary axis” crossing points to give more/less “nodes”
        const bends: Pt[] = [];
        const dx = b.x - a.x;
        const dy = b.y - a.y;

        for (let i = 1; i <= n; i++) {
            const t = i / (n + 1);
            const wantH = mode === "H" ? (i - 1) % 2 === 0 : (i - 1) % 2 === 1;

            if (wantH) {
                // horizontal segment: vary X, lock Y to previous later
                bends.push({ x: snapToGrid(a.x + dx * t, grid), y: snapToGrid(a.y, grid) });
            } else {
                // vertical segment: vary Y
                bends.push({ x: snapToGrid(a.x, grid), y: snapToGrid(a.y + dy * t, grid) });
            }
        }

        // Final orthogonalization pass makes it consistent and last segment aligned.
        return orthogonalizeRoute(a, b, bends, mode).map((p) => ({ x: snapToGrid(p.x, grid), y: snapToGrid(p.y, grid) }));
    }

    function polylineToSvgPathScreen(pts: { sx: number; sy: number }[]) {
        if (pts.length === 0) return "";
        const [p0, ...rest] = pts;
        return `M ${p0.sx} ${p0.sy} ` + rest.map((p) => `L ${p.sx} ${p.sy}`).join(" ");
    }

    const [wireDrag, setWireDrag] = useState<WireDrag | null>(null);

    const canvasPointFromEvent = (clientX: number, clientY: number) => {
        const el = canvasRef.current;
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return { x: clientX - r.left, y: clientY - r.top };
    };

    const [selectedConnId, setSelectedConnId] = useState<string | null>(null);

    function getConnMode(c: any): RouteMode {
        const m = c.routeMode;
        return m === "V" ? "V" : "H";
    }

    function setConnMode(connId: string, mode: RouteMode) {
        onUpdateWireMeta?.(connId, { routeMode: mode });
    }

    const screenToWorld = (sx: number, sy: number) => ({ x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom });
    const worldToScreen = (x: number, y: number) => ({ sx: x * zoom + pan.x, sy: y * zoom + pan.y });

    const portWorld = (deviceId: string, portId: string) => {
        const d = project.devices.find((x) => x.id === deviceId);
        if (!d) return null;
        const pl = getPlacement(project, deviceId);
        if (!pl) return null;

        const item = PALETTE_BY_ID.get(d.type as any);
        if (!item) return null;

        const port = item.ports.find((p) => p.id === portId);
        if (!port) return null;

        const { w: nodeW, h: nodeH } = nodeSizePx(d.type, (pl as any).scale, NODE_W, NODE_H);
        return { x: pl.x + port.x * nodeW, y: pl.y + port.y * nodeH, portType: port.type as PortType };
    };

    // ---- Bend edit helpers ----
    function ensureRoute(c: any, aW: Pt, bW: Pt): Pt[] {
        const existing: Pt[] = Array.isArray(c.route) ? c.route : [];
        if (existing.length > 0) return existing;
        return defaultRoute(aW, bW, GRID);
    }

    function setBend(connId: string, bendIndex: number, worldX: number, worldY: number) {
        if (!onUpdateWireRoute) return;

        const c = project.connections.find((x: any) => x.id === connId) as any;
        if (!c) return;

        const a = portWorld(c.from.deviceId, c.from.port);
        const b = portWorld(c.to.deviceId, c.to.port);
        if (!a || !b) return;

        const mode = getConnMode(c);

        // Ensure we have a bend list; if missing, create 2 bends by default
        const existing: Pt[] = Array.isArray(c.route) ? c.route : [];
        const base = existing.length > 0 ? existing : generateRouteWithBends({ x: a.x, y: a.y }, { x: b.x, y: b.y }, GRID, mode, 2);

        const route = base.map((p) => ({ ...p }));
        if (bendIndex < 0 || bendIndex >= route.length) return;

        route[bendIndex] = { x: snapToGrid(worldX, GRID), y: snapToGrid(worldY, GRID) };

        // Hard lock: force orthogonality after any edit
        const locked = orthogonalizeRoute({ x: a.x, y: a.y }, { x: b.x, y: b.y }, route, mode)
            .map((p) => ({ x: snapToGrid(p.x, GRID), y: snapToGrid(p.y, GRID) }));

        onUpdateWireRoute(connId, locked);
    }

    function setBendCount(connId: string, count: number) {
        if (!onUpdateWireRoute) return;
        const c = project.connections.find((x: any) => x.id === connId) as any;
        if (!c) return;

        const a = portWorld(c.from.deviceId, c.from.port);
        const b = portWorld(c.to.deviceId, c.to.port);
        if (!a || !b) return;

        const mode = getConnMode(c);
        const next = generateRouteWithBends({ x: a.x, y: a.y }, { x: b.x, y: b.y }, GRID, mode, count);
        onUpdateWireRoute(connId, next);
    }

    function addBend(connId: string) {
        const c = project.connections.find((x: any) => x.id === connId) as any;
        const n = Array.isArray(c?.route) ? c.route.length : 0;
        setBendCount(connId, n + 1);
    }

    function removeBend(connId: string) {
        const c = project.connections.find((x: any) => x.id === connId) as any;
        const n = Array.isArray(c?.route) ? c.route.length : 0;
        setBendCount(connId, Math.max(0, n - 1));
    }

    function resetRoute(connId: string) {
        setBendCount(connId, 2);
    }

    // ---------- Compatibility highlight ----------
    const compatiblePortSet = React.useMemo(() => {
        if (!wireDrag) return new Set<string>();
        const set = new Set<string>();
        for (const d of project.devices) {
            const item = PALETTE_BY_ID.get(d.type as any);
            if (!item) continue;
            for (const p of item.ports) {
                if (d.id === wireDrag.fromDeviceId && p.id === wireDrag.fromPortId) continue;
                if ((p.type as PortType) === wireDrag.fromPortType) set.add(`${d.id}::${p.id}`);
            }
        }
        return set;
    }, [wireDrag, project.devices]);

    // ---------- Port hit test ----------
    const hitPortFromClientPoint = (clientX: number, clientY: number) => {
        let el = document.elementFromPoint(clientX, clientY) as any;
        while (el) {
            if (el.getAttribute) {
                const raw = el.getAttribute("data-node-port");
                const pt = el.getAttribute("data-port-type");
                if (raw && pt) {
                    const [deviceId, portId] = String(raw).split(":");
                    const portType = String(pt) as PortType;
                    if (deviceId && portId && portType) return { deviceId, portId, portType };
                }
            }
            el = el.parentNode;
        }
        return null;
    };

    // ---------- Palette drop ----------
    const onCanvasDragOver = (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes("application/x-frc-device-type")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        }
    };

    const onCanvasDrop = (e: React.DragEvent) => {
        const type = e.dataTransfer.getData("application/x-frc-device-type") as DeviceType;
        if (!type) return;

        e.preventDefault();
        const pt = canvasPointFromEvent(e.clientX, e.clientY);
        const world = screenToWorld(pt.x, pt.y);

        const { w: nodeW, h: nodeH } = nodeSizePx(type, 1, NODE_W, NODE_H);

        const x = snapCenterToTopLeft(world.x, nodeW, GRID);
        const y = snapCenterToTopLeft(world.y, nodeH, GRID);
        onDropCreate(type, x, y);
    };

    // ---------- Panning ----------
    const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;

        const target = e.target as HTMLElement | null;
        const onPort = !!target?.closest?.("[data-node-port]");
        const onNode = !!target?.closest?.("[data-node-root]");
        if (onPort || onNode) return;
        if (wireMode) return;

        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

        panDragRef.current = {
            active: true,
            startClientX: e.clientX,
            startClientY: e.clientY,
            originPanX: pan.x,
            originPanY: pan.y,
            moved: false,
        };
    };

    const onCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (bendDrag) {
            const pt = canvasPointFromEvent(e.clientX, e.clientY);
            const w = screenToWorld(pt.x, pt.y);
            setBend(bendDrag.connId, bendDrag.bendIndex, w.x, w.y);
            return;
        }

        if (wireDrag) {
            const pt = canvasPointFromEvent(e.clientX, e.clientY);
            setWireDrag((prev) => (prev ? { ...prev, pointerSx: pt.x, pointerSy: pt.y } : prev));
            return;
        }

        const st = panDragRef.current;
        if (!st?.active) return;

        const dx = e.clientX - st.startClientX;
        const dy = e.clientY - st.startClientY;

        if (!st.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) st.moved = true;

        setPan({ x: st.originPanX + dx, y: st.originPanY + dy });
    };

    const onCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        panDragRef.current = null;

        if (bendDrag) {
            setBendDrag(null);
            return;
        }

        if (wireDrag) {
            const hit = hitPortFromClientPoint(e.clientX, e.clientY);
            if (
                hit &&
                onCreateWire &&
                hit.portType === wireDrag.fromPortType &&
                !(hit.deviceId === wireDrag.fromDeviceId && hit.portId === wireDrag.fromPortId)
            ) {
                onCreateWire(wireDrag.fromDeviceId, wireDrag.fromPortId, hit.deviceId, hit.portId, wireDrag.fromPortType);
            }

            setWireDrag(null);
        }
    };

    const onCanvasClick = () => {
        const st = panDragRef.current;
        if (st?.moved) return;
        setSelectedDeviceId(null);
    };

    const onPortPointerDown = (e: React.PointerEvent, deviceId: string, portId: string) => {
        if (!wireMode) return;
        e.stopPropagation();
        const w = portWorld(deviceId, portId);
        if (!w) return;

        canvasRef.current?.setPointerCapture?.(e.pointerId);
        const pt = canvasPointFromEvent(e.clientX, e.clientY);
        setWireDrag({
            fromDeviceId: deviceId,
            fromPortId: portId,
            fromPortType: w.portType,
            pointerSx: pt.x,
            pointerSy: pt.y,
        });
        setSelectedDeviceId(deviceId);
    };

    // ---------- Zoom ----------
    const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();

        const pt = canvasPointFromEvent(e.clientX, e.clientY);
        const before = screenToWorld(pt.x, pt.y);

        const base = 0.0015;
        const factor = Math.exp(-e.deltaY * base);
        const nextZoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
        const appliedFactor = nextZoom / zoom;

        const nextPanX = pt.x - before.x * (zoom * appliedFactor);
        const nextPanY = pt.y - before.y * (zoom * appliedFactor);

        setZoom(nextZoom);
        setPan({ x: nextPanX, y: nextPanY });
    };

    // ---------- Node dragging ----------
    const onNodePointerDown = (e: React.PointerEvent, deviceId: string) => {
        if (wireMode) return;
        const pl = getPlacement(project, deviceId);
        if (!pl) return;

        const d = project.devices.find((x) => x.id === deviceId);
        const { w: nodeW, h: nodeH } = nodeSizePx(d?.type, (pl as any).scale, NODE_W, NODE_H);

        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

        nodeDragRef.current = {
            deviceId,
            startX: e.clientX,
            startY: e.clientY,
            originX: pl.x,
            originY: pl.y,
            nodeW,
            nodeH,
        };

        setSelectedDeviceId(deviceId);
    };

    const onNodePointerMove = (e: React.PointerEvent) => {
        const st = nodeDragRef.current;
        if (!st) return;

        const dx = (e.clientX - st.startX) / zoom;
        const dy = (e.clientY - st.startY) / zoom;

        const rawX = st.originX + dx;
        const rawY = st.originY + dy;

        const x = snapTopLeftByCenter(rawX, st.nodeW, GRID);
        const y = snapTopLeftByCenter(rawY, st.nodeH, GRID);

        onMovePlacement(st.deviceId, x, y);
    };

    const onNodePointerUp = () => {
        nodeDragRef.current = null;
    };

    const gridPx = GRID * zoom;

    return (
        <div>
            <div
                ref={canvasRef}
                onDragOver={onCanvasDragOver}
                onDrop={onCanvasDrop}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onClick={onCanvasClick}
                onContextMenu={(e) => e.preventDefault()}
                onWheel={onWheel}
                className="
          relative h-[72vh] min-h-[520px] w-full overflow-hidden rounded-2xl border bg-background
          [background-image:linear-gradient(to_right,rgba(0,0,0,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.10)_1px,transparent_1px)]
          dark:[background-image:linear-gradient(to_right,rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.10)_1px,transparent_1px)]
        "
                style={{
                    backgroundSize: `${gridPx}px ${gridPx}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px`,
                    cursor: wireMode ? "crosshair" : panDragRef.current?.active ? "grabbing" : "grab",
                    touchAction: "none",
                }}
                onDragStart={(e) => e.preventDefault()}   // stops ghost-image drag
                onMouseDown={(e) => {
                    // prevent text selection + image drag initiation
                    e.preventDefault();
                }}
            >
                <div className="absolute right-3 top-3 z-10 rounded-xl border bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
                    Zoom: {Math.round(zoom * 100)}%
                </div>

                {/* Wires visual layer (FRONT) — never blocks node dragging */}
                <svg
                    className="absolute inset-0 z-40"
                    style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                >
                    {project.connections.map((c: any) => {
                        const a = portWorld(c.from.deviceId, c.from.port);
                        const b = portWorld(c.to.deviceId, c.to.port);
                        if (!a || !b) return null;

                        const aW = { x: a.x, y: a.y };
                        const bW = { x: b.x, y: b.y };
                        const mode = getConnMode(c);

                        const bends: Pt[] =
                            Array.isArray(c.route) && c.route.length > 0 ? c.route : generateRouteWithBends(aW, bW, GRID, mode, 2);

                        const lockedBends = orthogonalizeRoute(aW, bW, bends, mode);

                        const worldPts = [aW, ...lockedBends, bW];
                        const screenPts = worldPts.map((p) => {
                            const s = worldToScreen(p.x, p.y);
                            return { sx: s.sx, sy: s.sy };
                        });
                        const dpath = polylineToSvgPathScreen(screenPts);

                        const isSel = selectedConnId === c.id;

                        return (
                            <g key={c.id}>
                                <path
                                    d={dpath}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={3}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    opacity={0.9}
                                />
                                {/* Optional: selection emphasis without hit-testing */}
                                {isSel ? (
                                    <path
                                        d={dpath}
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth={6}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        opacity={0.2}
                                    />
                                ) : null}
                            </g>
                        );
                    })}

                    {/* Preview wire while dragging (visual only) */}
                    {wireDrag
                        ? (() => {
                            const a = portWorld(wireDrag.fromDeviceId, wireDrag.fromPortId);
                            if (!a) return null;

                            const bWorld = screenToWorld(wireDrag.pointerSx, wireDrag.pointerSy);

                            const worldPts = orthoRouteWorld({ x: a.x, y: a.y }, { x: bWorld.x, y: bWorld.y }, GRID);
                            const screenPts = worldPts.map((p) => {
                                const s = worldToScreen(p.x, p.y);
                                return { sx: s.sx, sy: s.sy };
                            });

                            const dpath = polylineToSvgPathScreen(screenPts);

                            return (
                                <path
                                    d={dpath}
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeDasharray="6 6"
                                    opacity={0.7}
                                />
                            );
                        })()
                        : null}
                </svg>

                {/* Wires interaction layer (FRONT) — only handles (and wire hit-path in wire mode) capture events */}
                <svg
                    className="absolute inset-0 z-50"
                    style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                >
                    {project.connections.map((c: any) => {
                        const a = portWorld(c.from.deviceId, c.from.port);
                        const b = portWorld(c.to.deviceId, c.to.port);
                        if (!a || !b) return null;

                        const aW = { x: a.x, y: a.y };
                        const bW = { x: b.x, y: b.y };
                        const mode = getConnMode(c);

                        const bends: Pt[] =
                            Array.isArray(c.route) && c.route.length > 0 ? c.route : generateRouteWithBends(aW, bW, GRID, mode, 2);

                        const lockedBends = orthogonalizeRoute(aW, bW, bends, mode);

                        const worldPts = [aW, ...lockedBends, bW];
                        const screenPts = worldPts.map((p) => {
                            const s = worldToScreen(p.x, p.y);
                            return { sx: s.sx, sy: s.sy };
                        });
                        const dpath = polylineToSvgPathScreen(screenPts);

                        const isSel = selectedConnId === c.id;
                        const handleR = 6;

                        return (
                            <g key={c.id}>
                                {/* Only allow clicking/selecting the wire body in wireMode (otherwise it blocks nodes) */}
                                {wireMode ? (
                                    <path
                                        d={dpath}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth={16}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        style={{ pointerEvents: "stroke", cursor: "pointer" }}
                                        onPointerDown={(e) => {
                                            e.stopPropagation();
                                            setSelectedConnId(c.id);
                                        }}
                                    />
                                ) : null}

                                {/* Bend handles: always interactive */}
                                {lockedBends.map((bp, i) => {
                                    const s = worldToScreen(bp.x, bp.y);
                                    return (
                                        <circle
                                            key={i}
                                            cx={s.sx}
                                            cy={s.sy}
                                            r={handleR}
                                            fill="white"
                                            stroke="black"
                                            strokeWidth={2}
                                            style={{ pointerEvents: "all", cursor: "move", opacity: isSel ? 1 : 0.85 }}
                                            onPointerDown={(e) => {
                                                e.stopPropagation();
                                                canvasRef.current?.setPointerCapture?.(e.pointerId);
                                                setBendDrag({ connId: c.id, bendIndex: i, pointerId: e.pointerId });
                                                setSelectedConnId(c.id);

                                                if (onUpdateWireRoute && (!Array.isArray(c.route) || c.route.length === 0)) {
                                                    onUpdateWireRoute(
                                                        c.id,
                                                        lockedBends.map((p) => ({ x: snapToGrid(p.x, GRID), y: snapToGrid(p.y, GRID) }))
                                                    );
                                                }
                                            }}
                                        />
                                    );
                                })}
                            </g>
                        );
                    })}
                </svg>

                <div
                    className="absolute inset-0 z-10"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: "0 0",
                    }}
                >
                    {project.devices.map((d) => (
                        <CanvasNode
                            key={d.id}
                            project={project}
                            deviceId={d.id}
                            NODE_W={NODE_W}
                            NODE_H={NODE_H}
                            selectedDeviceId={selectedDeviceId}
                            setSelectedDeviceId={setSelectedDeviceId}
                            onNodePointerDown={onNodePointerDown}
                            onNodePointerMove={onNodePointerMove}
                            onNodePointerUp={onNodePointerUp}
                            wireMode={wireMode}
                            compatiblePortSet={compatiblePortSet}
                            onPortPointerDown={onPortPointerDown}
                        />
                    ))}
                </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div>Grid: {GRID}px • Pan: drag empty space • Zoom: mouse wheel • Snap is in world units</div>
                <div>{wireMode ? "Wire mode: drag from a port to a matching port." : "Tip: enable Wire mode to route wires by dragging between ports."}</div>
            </div>
        </div>
    );
}