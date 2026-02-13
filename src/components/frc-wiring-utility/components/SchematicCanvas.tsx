import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DeviceType, Project } from "../core/types";
import { clamp, getPlacement, snapCenterToTopLeft, snapTopLeftByCenter } from "../core/helpers";
import { PALETTE_BY_ID } from "../core/paletteLookup";
import type { PortType } from "../core/palette";
import { canvasPointFromEvent, nodeSizePx, screenToWorld, worldToScreen } from "./SchematicCanvas/coords";
import { NodesLayer } from "./SchematicCanvas/NodesLayer";
import { WiresLayer } from "./SchematicCanvas/WiresLayer";
import { WireInteractionLayer } from "./SchematicCanvas/WireInteractionLayer";
import type { WireDrag, WireSegDrag } from "./SchematicCanvas/types";
import { ensureRoutePersisted, moveSegment, pickSegment, polyPointsForConn, setBendCount } from "./SchematicCanvas/wireRouting";

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
        registerCenterFn,
        registerWireActions,
    } = props;

    const canvasRef = useRef<HTMLDivElement | null>(null);

    // Prevent the canvas onClick from clearing selection after wire pointer down/up.
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

    const [wireDrag, setWireDrag] = useState<WireDrag | null>(null);
    const [wireSegDrag, setWireSegDrag] = useState<WireSegDrag | null>(null);

    // ----- coords -----
    const canvasPoint = (clientX: number, clientY: number) => canvasPointFromEvent(canvasRef.current, clientX, clientY);
    const toWorld = (sx: number, sy: number) => screenToWorld(sx, sy, pan, zoom);
    const toScreen = (x: number, y: number) => worldToScreen(x, y, pan, zoom);

    // ----- ports/world -----
    const portWorld = (deviceId: string, portId: string) => {
        const d = project.devices.find((x) => x.id === deviceId);
        if (!d) return null;
        const pl = getPlacement(project, deviceId);
        if (!pl) return null;

        const item = PALETTE_BY_ID.get(String(d.type));
        if (!item) return null;

        const port = item.ports.find((p) => p.id === portId);
        if (!port) return null;

        const { w: nodeW, h: nodeH } = nodeSizePx(d.type, (pl as { scale?: number }).scale, NODE_W, NODE_H);
        return { x: pl.x + port.x * nodeW, y: pl.y + port.y * nodeH, portType: port.type as PortType };
    };

    const polyPointsForConnLocal = (c: Project["connections"][number] & { routeMode?: "H" | "V" }) => polyPointsForConn(c, portWorld, GRID);

    // ----- add/remove/reset bends (usable from inspector) -----
    function addBend(connId: string) {
        const c = project.connections.find((x) => x.id === connId);
        const n = Array.isArray(c?.route) ? c.route.length : 0;
        setBendCount(connId, project, n + 1, onUpdateWireRoute, portWorld, GRID);
    }

    function removeBend(connId: string) {
        const c = project.connections.find((x) => x.id === connId);
        const n = Array.isArray(c?.route) ? c.route.length : 0;
        setBendCount(connId, project, Math.max(0, n - 1), onUpdateWireRoute, portWorld, GRID);
    }

    function resetRoute(connId: string) {
        setBendCount(connId, project, 2, onUpdateWireRoute, portWorld, GRID);
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
                const { w, h } = nodeSizePx(d.type, (pl as { scale?: number }).scale, NODE_W, NODE_H);
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
            const item = PALETTE_BY_ID.get(String(d.type));
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
        let el: Element | null = document.elementFromPoint(clientX, clientY);
        while (el) {
            const raw = el.getAttribute("data-node-port");
            const pt = el.getAttribute("data-port-type");
            if (raw && pt) {
                const [deviceId, portId] = String(raw).split(":");
                const portType = String(pt) as PortType;
                if (deviceId && portId && portType) return { deviceId, portId, portType };
            }
            el = el.parentElement;
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
        const pt = canvasPoint(e.clientX, e.clientY);
        const world = toWorld(pt.x, pt.y);

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
            const pt = canvasPoint(e.clientX, e.clientY);
            const w = toWorld(pt.x, pt.y);
            const delta = wireSegDrag.axis === "H" ? w.y - wireSegDrag.startWorld.y : w.x - wireSegDrag.startWorld.x;
            moveSegment(wireSegDrag.connId, project, wireSegDrag.segIndex, wireSegDrag.axis, delta, wireSegDrag.baseRoute, onUpdateWireRoute, portWorld, GRID);
            return;
        }

        if (wireDrag) {
            const pt = canvasPoint(e.clientX, e.clientY);
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
            if (hit && onCreateWire && hit.portType === wireDrag.fromPortType && !(hit.deviceId === wireDrag.fromDeviceId && hit.portId === wireDrag.fromPortId)) {
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
        const pt = canvasPoint(e.clientX, e.clientY);

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

        const pt = canvasPoint(e.clientX, e.clientY);
        const before = toWorld(pt.x, pt.y);

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
        const { w: nodeW, h: nodeH } = nodeSizePx(d?.type, (pl as { scale?: number }).scale, NODE_W, NODE_H);

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

    return (
        // IMPORTANT: flex column + flex-1 canvas => full-height works when parent gives height
        <div className="flex h-full min-h-0 flex-col">
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
          relative flex-1 min-h-0 w-full overflow-hidden rounded-2xl border bg-background select-none
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

                <WiresLayer
                    project={project}
                    selectedConnId={selectedConnId}
                    wireDrag={wireDrag}
                    GRID={GRID}
                    polyPointsForConn={polyPointsForConnLocal}
                    portWorld={portWorld}
                    worldToScreen={toScreen}
                    screenToWorld={toWorld}
                />

                <WireInteractionLayer
                    project={project}
                    wireMode={wireMode}
                    GRID={GRID}
                    polyPointsForConn={polyPointsForConnLocal}
                    worldToScreen={toScreen}
                    screenToWorld={toWorld}
                    canvasPointFromEvent={canvasPoint}
                    ensureRoutePersisted={(connId) => ensureRoutePersisted(connId, project, onUpdateWireRoute, portWorld, GRID)}
                    pickSegment={(connId, clientX, clientY) => pickSegment(connId, project, clientX, clientY, portWorld, GRID, canvasPoint, toScreen)}
                    onSelectConn={setSelectedConnId}
                    onSelectDevice={setSelectedDeviceId}
                    onStartWireSegDrag={(drag) => {
                        canvasRef.current?.setPointerCapture?.(drag.pointerId);
                        setWireSegDrag(drag);
                    }}
                    suppressNextCanvasClickRef={suppressNextCanvasClickRef}
                />

                <div
                    className="absolute inset-0 z-10"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: "0 0",
                    }}
                >
                    <NodesLayer
                        project={project}
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
                </div>
            </div>

            <div className="mt-3 shrink-0 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div>Grid: {GRID}px | Pan: drag empty space | Zoom: mouse wheel</div>
                <div>{wireMode ? "Wire mode: drag from a port to a matching port. Drag wires to adjust routing." : "Tip: enable Wire mode to route wires."}</div>
            </div>
        </div>
    );
}

