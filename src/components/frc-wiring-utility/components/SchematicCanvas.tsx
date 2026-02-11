import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceType, Project } from "../types";
import { CanvasNode } from "./CanvasNode";
import { clamp, getPlacement, snapCenterToTopLeft, snapTopLeftByCenter } from "../helpers";
import { PALETTE_BY_ID } from "../paletteLookup";
import type { PortType } from "../palette";
import type { Pt as WirePt, RouteMode } from "../../../helpers/wires";
import { defaultRoute, generateRouteWithBends, orthogonalizeRoute, snapToGrid } from "../../../helpers/wires";

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

function polylineToSvgPathScreen(pts: { sx: number; sy: number }[]) {
    if (pts.length === 0) return "";
    const [p0, ...rest] = pts;
    return `M ${p0.sx} ${p0.sy} ` + rest.map((p) => `L ${p.sx} ${p.sy}`).join(" ");
}

export function SchematicCanvas(props: {
    project: Project;
    selectedDeviceId: string | null;
    setSelectedDeviceId: (id: string | null) => void;
    selectedConnId: string | null;
    setSelectedConnId: (id: string | null) => void;
    GRID: number;
    NODE_W: number;
    NODE_H: number;
    onDropCreate: (type: DeviceType, x: number, y: number) => void;
    onMovePlacement: (deviceId: string, x: number, y: number) => void;
    wireMode?: boolean;
    onCreateWire?: (fromDeviceId: string, fromPortId: string, toDeviceId: string, toPortId: string, portType: PortType) => void;
    onUpdateWireRoute?: (connId: string, route: { x: number; y: number }[]) => void;
    onUpdateWireMeta?: (connId: string, patch: Record<string, any>) => void;
    registerCenterFn?: (fn: () => void) => void;
    registerWireActions?: (actions: {
        addBend: (connId: string) => void;
        removeBend: (connId: string) => void;
        resetRoute: (connId: string) => void;
    }) => void;
}) {
    const {
        project,
        selectedDeviceId,
        setSelectedDeviceId,
        selectedConnId,
        setSelectedConnId,
        GRID,
        NODE_W,
        NODE_H,
        onDropCreate,
        onMovePlacement,
        wireMode = false,
        onCreateWire,
        onUpdateWireRoute,
        onUpdateWireMeta,
        registerCenterFn,
        registerWireActions,
    } = props;

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const suppressNextCanvasClickRef = useRef(false);
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

    // ----- wire creation drag (port-to-port) -----
    type WireDrag = {
        fromDeviceId: string;
        fromPortId: string;
        fromPortType: PortType;
        pointerSx: number;
        pointerSy: number;
    };
    const [wireDrag, setWireDrag] = useState<WireDrag | null>(null);

    // ----- wire segment drag (grab wire, drag perpendicular) -----
    type Pt = WirePt;

    type WireSegDrag = {
        connId: string;
        pointerId: number;
        segIndex: number; // segment in [a, ...bends, b]
        axis: "H" | "V"; // segment orientation
        startWorld: Pt;
        baseRoute: Pt[]; // bends only
    };
    const [wireSegDrag, setWireSegDrag] = useState<WireSegDrag | null>(null);

    // ----- coords -----
    const canvasPointFromEvent = (clientX: number, clientY: number) => {
        const el = canvasRef.current;
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return { x: clientX - r.left, y: clientY - r.top };
    };

    const screenToWorld = (sx: number, sy: number) => ({ x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom });
    const worldToScreen = (x: number, y: number) => ({ sx: x * zoom + pan.x, sy: y * zoom + pan.y });

    // ----- ports/world -----
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

    // ----- conn helpers -----
    function getConnById(connId: string) {
        return project.connections.find((x: any) => x.id === connId) as any;
    }

    function getConnMode(c: any): RouteMode {
        const m = c.routeMode;
        return m === "V" ? "V" : "H";
    }

    function setConnMode(connId: string, mode: RouteMode) {
        onUpdateWireMeta?.(connId, { routeMode: mode });
    }

    // Build polyline points including endpoints
    function polyPointsForConn(c: any): { aW: Pt; bW: Pt; mode: RouteMode; bends: Pt[]; pts: Pt[] } | null {
        const a = portWorld(c.from.deviceId, c.from.port);
        const b = portWorld(c.to.deviceId, c.to.port);
        if (!a || !b) return null;

        const aW: Pt = { x: a.x, y: a.y };
        const bW: Pt = { x: b.x, y: b.y };
        const mode = getConnMode(c);

        const bends: Pt[] = Array.isArray(c.route) && c.route.length > 0 ? c.route : generateRouteWithBends(aW, bW, GRID, mode, 2);
        const lockedBends = orthogonalizeRoute(aW, bW, bends, mode);

        const pts = [aW, ...lockedBends, bW];
        return { aW, bW, mode, bends: lockedBends, pts };
    }

    function ensureRoutePersisted(connId: string) {
        if (!onUpdateWireRoute) return;
        const c = getConnById(connId);
        if (!c) return;
        if (Array.isArray(c.route) && c.route.length > 0) return;

        const info = polyPointsForConn(c);
        if (!info) return;

        onUpdateWireRoute(
            connId,
            info.bends.map((p) => ({ x: snapToGrid(p.x, GRID), y: snapToGrid(p.y, GRID) }))
        );
    }

    // Find closest segment in SCREEN space
    function pickSegment(connId: string, clientX: number, clientY: number): { segIndex: number; axis: "H" | "V" } | null {
        const c = getConnById(connId);
        if (!c) return null;

        const info = polyPointsForConn(c);
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

            // point->segment distance in screen
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

    // Apply perpendicular shift by adjusting adjacent bend(s)
    function moveSegment(connId: string, segIndex: number, axis: "H" | "V", deltaWorld: number, baseRoute: Pt[]) {
        if (!onUpdateWireRoute) return;

        const c = getConnById(connId);
        if (!c) return;

        const info = polyPointsForConn(c);
        if (!info) return;

        const bends = baseRoute.map((p) => ({ ...p }));
        const nB = bends.length;

        const ptIndexToBendIndex = (pi: number) => {
            if (pi <= 0) return null; // endpoint a
            if (pi >= nB + 1) return null; // endpoint b
            return pi - 1;
        };

        const aB = ptIndexToBendIndex(segIndex);
        const bB = ptIndexToBendIndex(segIndex + 1);

        const snapVal = (v: number) => snapToGrid(v, GRID);

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
            x: snapToGrid(p.x, GRID),
            y: snapToGrid(p.y, GRID),
        }));

        onUpdateWireRoute(connId, locked);
    }

    // ----- add/remove/reset bends (still usable from inspector) -----
    function setBendCount(connId: string, count: number) {
        if (!onUpdateWireRoute) return;
        const c = getConnById(connId);
        if (!c) return;

        const info = polyPointsForConn(c);
        if (!info) return;

        const next = generateRouteWithBends(info.aW, info.bW, GRID, info.mode, count);
        onUpdateWireRoute(connId, next);
    }

    function addBend(connId: string) {
        const c = getConnById(connId);
        const n = Array.isArray(c?.route) ? c.route.length : 0;
        setBendCount(connId, n + 1);
    }

    function removeBend(connId: string) {
        const c = getConnById(connId);
        const n = Array.isArray(c?.route) ? c.route.length : 0;
        setBendCount(connId, Math.max(0, n - 1));
    }

    function resetRoute(connId: string) {
        setBendCount(connId, 2);
    }

    useEffect(() => {
        registerWireActions?.({ addBend, removeBend, resetRoute });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registerWireActions, project.connections, GRID]);

    // ----- center view -----
    useEffect(() => {
        if (!registerCenterFn) return;

        const fn = () => {
            const el = canvasRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();

            const placements = project.placements ?? [];
            if (project.devices.length === 0 || placements.length === 0) return;

            let minX = Number.POSITIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let maxY = Number.NEGATIVE_INFINITY;

            for (const d of project.devices) {
                const pl = getPlacement(project, d.id);
                if (!pl) continue;
                const { w, h } = nodeSizePx(d.type, (pl as any).scale, NODE_W, NODE_H);
                minX = Math.min(minX, pl.x);
                minY = Math.min(minY, pl.y);
                maxX = Math.max(maxX, pl.x + w);
                maxY = Math.max(maxY, pl.y + h);
            }

            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return;

            const pad = 60;
            const contentW = Math.max(1, maxX - minX + pad * 2);
            const contentH = Math.max(1, maxY - minY + pad * 2);

            const fit = Math.min(rect.width / contentW, rect.height / contentH);
            const nextZoom = clamp(fit, ZOOM_MIN, ZOOM_MAX);

            const targetCx = minX + (maxX - minX) / 2;
            const targetCy = minY + (maxY - minY) / 2;

            const nextPanX = rect.width / 2 - targetCx * nextZoom;
            const nextPanY = rect.height / 2 - targetCy * nextZoom;

            setZoom(nextZoom);
            setPan({ x: nextPanX, y: nextPanY });
        };

        registerCenterFn(fn);
    }, [registerCenterFn, project, NODE_W, NODE_H]);

    // ----- compatibility highlight -----
    const compatiblePortSet = useMemo(() => {
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

    // ----- hit test port under cursor -----
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

    // ----- palette drop -----
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

    // ----- panning -----
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
        if (wireSegDrag) {
            const pt = canvasPointFromEvent(e.clientX, e.clientY);
            const w = screenToWorld(pt.x, pt.y);
            const delta = wireSegDrag.axis === "H" ? w.y - wireSegDrag.startWorld.y : w.x - wireSegDrag.startWorld.x;
            moveSegment(wireSegDrag.connId, wireSegDrag.segIndex, wireSegDrag.axis, delta, wireSegDrag.baseRoute);
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

        if (wireSegDrag) {
            setWireSegDrag(null);
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
        if (suppressNextCanvasClickRef.current) {
            suppressNextCanvasClickRef.current = false;
            return;
        }

        const st = panDragRef.current;
        if (st?.moved) return;

        setSelectedDeviceId(null);
        setSelectedConnId(null);
    };

    const onPortPointerDown = (e: React.PointerEvent, deviceId: string, portId: string) => {
        if (!wireMode) return;
        e.preventDefault();
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
        setSelectedConnId(null);
    };

    // ----- zoom -----
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

    // ----- node dragging -----
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
        setSelectedConnId(null);
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

    // Preview route while dragging wire between ports
    function orthoRouteWorld(a: Pt, b: Pt, grid: number): Pt[] {
        const bends = defaultRoute(a, b, grid);
        return [a, ...bends, b];
    }

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
          relative h-[72vh] min-h-[520px] w-full overflow-hidden rounded-2xl border bg-background select-none
          [background-image:linear-gradient(to_right,rgba(0,0,0,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.10)_1px,transparent_1px)]
          dark:[background-image:linear-gradient(to_right,rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.10)_1px,transparent_1px)]
        "
                style={{
                    backgroundSize: `${gridPx}px ${gridPx}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px`,
                    cursor: wireMode ? "crosshair" : panDragRef.current?.active ? "grabbing" : "grab",
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    WebkitUserDrag: "none",
                }}
                onDragStart={(e) => e.preventDefault()}
            >
                <div className="absolute right-3 top-3 z-10 rounded-xl border bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur select-none pointer-events-none">
                    Zoom: {Math.round(zoom * 100)}%
                </div>

                {/* Wires visual layer (FRONT) — never blocks node dragging */}
                <svg className="absolute inset-0 z-40" style={{ width: "100%", height: "100%", pointerEvents: "none" }}>
                    {project.connections.map((c: any) => {
                        const info = polyPointsForConn(c);
                        if (!info) return null;

                        const screenPts = info.pts.map((p) => {
                            const s = worldToScreen(p.x, p.y);
                            return { sx: s.sx, sy: s.sy };
                        });

                        const dpath = polylineToSvgPathScreen(screenPts);
                        const isSel = selectedConnId === c.id;

                        return (
                            <g key={c.id}>
                                <path d={dpath} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
                                {isSel ? (
                                    <path d={dpath} fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0.2} />
                                ) : null}
                            </g>
                        );
                    })}

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

                {/* Wires interaction layer (FRONT) — only active in wireMode */}
                <svg className="absolute inset-0 z-50" style={{ width: "100%", height: "100%", pointerEvents: "none" }}>
                    {wireMode
                        ? project.connections.map((c: any) => {
                            const info = polyPointsForConn(c);
                            if (!info) return null;

                            const screenPts = info.pts.map((p) => {
                                const s = worldToScreen(p.x, p.y);
                                return { sx: s.sx, sy: s.sy };
                            });

                            const dpath = polylineToSvgPathScreen(screenPts);

                            return (
                                <g key={c.id}>
                                    <path
                                        d={dpath}
                                        fill="none"
                                        stroke="transparent"
                                        strokeWidth={16}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        style={{ pointerEvents: "stroke", cursor: "move" }}
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();

                                            suppressNextCanvasClickRef.current = true; // <-- ADD THIS

                                            setSelectedConnId(c.id);
                                            setSelectedDeviceId(null);

                                            ensureRoutePersisted(c.id);

                                            const pick = pickSegment(c.id, e.clientX, e.clientY);
                                            if (!pick) return;

                                            canvasRef.current?.setPointerCapture?.(e.pointerId);

                                            const baseRoute = info.bends.map((p) => ({
                                                x: snapToGrid(p.x, GRID),
                                                y: snapToGrid(p.y, GRID),
                                            }));

                                            const pt = canvasPointFromEvent(e.clientX, e.clientY);
                                            const startWorld = screenToWorld(pt.x, pt.y);

                                            setWireSegDrag({
                                                connId: c.id,
                                                pointerId: e.pointerId,
                                                segIndex: pick.segIndex,
                                                axis: pick.axis,
                                                startWorld,
                                                baseRoute,
                                            });
                                        }}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onPointerUp={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                    />
                                </g>
                            );
                        })
                        : null}
                </svg>

                {/* Nodes layer (behind wires, but still interactive) */}
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
                <div>Grid: {GRID}px • Pan: drag empty space • Zoom: mouse wheel</div>
                <div>{wireMode ? "Wire mode: drag from a port to a matching port. Drag wires to adjust routing." : "Tip: enable Wire mode to route wires."}</div>
            </div>
        </div>
    );
}