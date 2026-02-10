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
    registerCenterFn?: (fn: () => void) => void;
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
        registerCenterFn,
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

    type WireDrag = {
        fromDeviceId: string;
        fromPortId: string;
        fromPortType: PortType;
        pointerSx: number; // canvas-local screen coords
        pointerSy: number;
    };

    const [wireDrag, setWireDrag] = useState<WireDrag | null>(null);

    const canvasPointFromEvent = (clientX: number, clientY: number) => {
        const el = canvasRef.current;
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return { x: clientX - r.left, y: clientY - r.top };
    };

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

    type Pt = { x: number; y: number };

    function snapToGrid(v: number, grid: number) {
        if (!Number.isFinite(grid) || grid <= 0) return v;
        return Math.round(v / grid) * grid;
    }

    function orthoRouteWorld(a: Pt, b: Pt, grid: number): Pt[] {
        const dx = b.x - a.x;
        const dy = b.y - a.y;

        // If already aligned, straight shot.
        if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) return [a, b];

        // Choose whether to go H then V, or V then H.
        // Heuristic: do the longer axis first (reduces “weird” near-port kinks).
        const horizontalFirst = Math.abs(dx) >= Math.abs(dy);

        if (horizontalFirst) {
            const mx = snapToGrid((a.x + b.x) / 2, grid);
            return [
                a,
                { x: mx, y: a.y }, // turn 1
                { x: mx, y: b.y }, // turn 2
                b,
            ];
        } else {
            const my = snapToGrid((a.y + b.y) / 2, grid);
            return [
                a,
                { x: a.x, y: my }, // turn 1
                { x: b.x, y: my }, // turn 2
                b,
            ];
        }
    }

    function polylineToSvgPathScreen(pts: { sx: number; sy: number }[]) {
        if (pts.length === 0) return "";
        const [p0, ...rest] = pts;
        return `M ${p0.sx} ${p0.sy} ` + rest.map((p) => `L ${p.sx} ${p.sy}`).join(" ");
    }

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

        // If in wire mode, only allow panning when clicking truly empty canvas.
        // Also: never pan when starting on a node or port.
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

        if (wireDrag) {
            // Attempt to finalize a wire on pointer up
            const hit = hitPortFromClientPoint(e.clientX, e.clientY);
            if (
                hit &&
                onCreateWire &&
                hit.portType === wireDrag.fromPortType &&
                !(hit.deviceId === wireDrag.fromDeviceId && hit.portId === wireDrag.fromPortId)
            ) {
                onCreateWire(
                    wireDrag.fromDeviceId,
                    wireDrag.fromPortId,
                    hit.deviceId,
                    hit.portId,
                    wireDrag.fromPortType
                );
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

        // Capture on the CANVAS so canvas move/up handlers always fire during wire drag.
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

    // ---------- Zoom (wheel, anchored at cursor) ----------
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

    // Grid scales with zoom
    const gridPx = GRID * zoom;

    const centerOnItems = () => {
        const el = canvasRef.current;
        if (!el) return;

        const placements = project.devices
            .map((d) => {
                const pl = getPlacement(project, d.id);
                if (!pl) return null;
                const sz = nodeSizePx(d.type, (pl as any).scale, NODE_W, NODE_H);
                return { x: pl.x, y: pl.y, w: sz.w, h: sz.h };
            })
            .filter(Boolean) as { x: number; y: number; w: number; h: number }[];

        if (placements.length === 0) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            return;
        }

        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;

        for (const p of placements) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + p.w);
            maxY = Math.max(maxY, p.y + p.h);
        }

        const boundsW = maxX - minX;
        const boundsH = maxY - minY;

        const cw = el.clientWidth;
        const ch = el.clientHeight;

        const pad = 80;
        const availW = Math.max(1, cw - pad * 2);
        const availH = Math.max(1, ch - pad * 2);

        const fitZoom = Math.min(availW / boundsW, availH / boundsH);
        const nextZoom = clamp(fitZoom, ZOOM_MIN, ZOOM_MAX);

        const worldCx = minX + boundsW / 2;
        const worldCy = minY + boundsH / 2;

        const screenCx = cw / 2;
        const screenCy = ch / 2;

        const nextPanX = screenCx - worldCx * nextZoom;
        const nextPanY = screenCy - worldCy * nextZoom;

        setZoom(nextZoom);
        setPan({ x: nextPanX, y: nextPanY });
    };

    React.useEffect(() => {
        registerCenterFn?.(centerOnItems);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registerCenterFn, project, NODE_W, NODE_H]);

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code !== "Space") return;

            const t = e.target as HTMLElement | null;
            const tag = t?.tagName?.toLowerCase();
            const isTyping = tag === "input" || tag === "textarea" || (t as any)?.isContentEditable;
            if (isTyping) return;

            e.preventDefault();
            centerOnItems();
        };

        window.addEventListener("keydown", onKeyDown, { passive: false });
        return () => window.removeEventListener("keydown", onKeyDown as any);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project, NODE_W, NODE_H, zoom, pan]);

    return (
        <div>
            <div
                ref={canvasRef}
                onDragOver={onCanvasDragOver}
                onDrop={onCanvasDrop}
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={(e) => { onCanvasPointerUp(e); }}
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
                    cursor: wireMode ? "crosshair" : (panDragRef.current?.active ? "grabbing" : "grab"),
                    touchAction: "none",
                }}
            >
                <div className="absolute right-3 top-3 z-10 rounded-xl border bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
                    Zoom: {Math.round(zoom * 100)}%
                </div>

                {/* Wires overlay (screen-space). Endpoints computed from placements so wires move with components. */}
                <svg
                    className="absolute inset-0 z-40"
                    style={{ width: "100%", height: "100%", pointerEvents: "none" }}
                >
                    {project.connections.map((c) => {
                        const a = portWorld(c.from.deviceId, c.from.port);
                        const b = portWorld(c.to.deviceId, c.to.port);
                        if (!a || !b) return null;

                        // Build orthogonal path in WORLD space
                        const worldPts = orthoRouteWorld({ x: a.x, y: a.y }, { x: b.x, y: b.y }, GRID);

                        // Convert to SCREEN space for overlay SVG
                        const screenPts = worldPts.map((p) => {
                            const s = worldToScreen(p.x, p.y);
                            return { sx: s.sx, sy: s.sy };
                        });

                        const dpath = polylineToSvgPathScreen(screenPts);

                        return (
                            <path
                                key={c.id}
                                d={dpath}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={3}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                opacity={0.9}
                            />
                        );
                    })}

                    {wireDrag ? (() => {
                        const a = portWorld(wireDrag.fromDeviceId, wireDrag.fromPortId);
                        if (!a) return null;

                        // pointer is in SCREEN coords; convert to WORLD for routing
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
                    })() : null}
                </svg>

                {project.devices.length === 0 ? (
                    <div className="absolute inset-0 grid place-items-center">
                        <div className="rounded-2xl border bg-background/80 p-4 text-center text-sm text-muted-foreground">
                            Drag a device from the right panel onto the grid.
                        </div>
                    </div>
                ) : null}

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
                <div>Grid: {GRID}px • Pan: drag empty space • Zoom: mouse wheel • Snap is in world units</div>
                <div>
                    {wireMode ? "Wire mode: drag from a port to a matching port." : "Tip: enable Wire mode to route wires by dragging between ports."}
                </div>
            </div>
        </div>
    );
}
