import React, { useRef, useState } from "react";
import type { DeviceType, Project } from "../types";
import { CanvasNode } from "./CanvasNode";
import { clamp, getPlacement, snapCenterToTopLeft, snapTopLeftByCenter } from "../helpers";
import { PALETTE_BY_ID } from "../paletteLookup";

function safePos(n: unknown, fallback: number) {
    const x = typeof n === "number" ? n : Number(n);
    return Number.isFinite(x) && x > 0 ? x : fallback;
}

function nodeSize(type: unknown, fallbackW: number, fallbackH: number) {
    const item = PALETTE_BY_ID.get(type as any);
    const aspect = item?.svg_meta?.aspect;

    const w = safePos((item as any)?.size?.w ?? item?.svg_meta?.w ?? (item as any)?.svg_meta?.width, fallbackW);
    let h = safePos((item as any)?.size?.h ?? item?.svg_meta?.h ?? (item as any)?.svg_meta?.height, fallbackH);

    if (
        (!((item as any)?.size?.h) && !(item?.svg_meta as any)?.h && !((item as any)?.svg_meta?.height)) &&
        typeof aspect === "number" &&
        Number.isFinite(aspect) &&
        aspect > 0
    ) {
        h = w / aspect;
    }

    return { w, h };
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

    // NEW: expose a centering function up to parent (optional but useful)
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
        registerCenterFn,
    } = props;

    const canvasRef = useRef<HTMLDivElement | null>(null);

    // View transform:
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

    const canvasPointFromEvent = (clientX: number, clientY: number) => {
        const el = canvasRef.current;
        if (!el) return { x: 0, y: 0 };
        const r = el.getBoundingClientRect();
        return { x: clientX - r.left, y: clientY - r.top };
    };

    const screenToWorld = (sx: number, sy: number) => {
        return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom };
    };

    const worldToScreen = (wx: number, wy: number) => {
        return { x: wx * zoom + pan.x, y: wy * zoom + pan.y };
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

        // screen -> world
        const world = screenToWorld(pt.x, pt.y);

        const { w: nodeW, h: nodeH } = nodeSize(type, NODE_W, NODE_H);

        const x = snapCenterToTopLeft(world.x, nodeW, GRID);
        const y = snapCenterToTopLeft(world.y, nodeH, GRID);
        onDropCreate(type, x, y);
    };

    // ---------- Panning ----------
    const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;

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
        const st = panDragRef.current;
        if (!st?.active) return;

        const dx = e.clientX - st.startClientX;
        const dy = e.clientY - st.startClientY;

        if (!st.moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) st.moved = true;

        setPan({ x: st.originPanX + dx, y: st.originPanY + dy });
    };

    const onCanvasPointerUp = () => {
        panDragRef.current = null;
    };

    const onCanvasClick = () => {
        const st = panDragRef.current;
        if (st?.moved) return;
        setSelectedDeviceId(null);
    };

    // ---------- Zoom (wheel, anchored at cursor) ----------
    const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
        // Prevent page scroll when cursor is over canvas
        e.preventDefault();

        const pt = canvasPointFromEvent(e.clientX, e.clientY);

        // World coord under cursor BEFORE zoom
        const before = screenToWorld(pt.x, pt.y);

        // Choose zoom factor. Trackpads send small deltas; wheels send bigger.
        const base = 0.0015;
        const factor = Math.exp(-e.deltaY * base); // deltaY>0 => zoom out

        const nextZoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);

        // If clamped, adjust factor so anchoring math remains consistent
        const appliedFactor = nextZoom / zoom;

        // Update pan so that the same world point stays under the cursor:
        // screen = world*zoom + pan
        // keep cursor screen pt fixed => newPan = pt - before*nextZoom
        const nextPanX = pt.x - before.x * (zoom * appliedFactor);
        const nextPanY = pt.y - before.y * (zoom * appliedFactor);

        setZoom(nextZoom);
        setPan({ x: nextPanX, y: nextPanY });
    };

    // ---------- Node dragging ----------
    const onNodePointerDown = (e: React.PointerEvent, deviceId: string) => {
        const pl = getPlacement(project, deviceId);
        if (!pl) return;

        const d = project.devices.find((x) => x.id === deviceId);
        const { w: nodeW, h: nodeH } = nodeSize(d?.type, NODE_W, NODE_H);

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

        // Important: pointer deltas are in SCREEN pixels; convert to WORLD delta by /zoom
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

    // Grid should scale with zoom. Keep it readable by scaling the background-size.
    const gridPx = GRID * zoom;

    const centerOnItems = () => {
        const el = canvasRef.current;
        if (!el) return;

        const placements = project.devices
            .map((d) => {
                const pl = getPlacement(project, d.id);
                if (!pl) return null;
                const sz = nodeSize(d.type, NODE_W, NODE_H);
                return { x: pl.x, y: pl.y, w: sz.w, h: sz.h };
            })
            .filter(Boolean) as { x: number; y: number; w: number; h: number }[];

        // If no items, just reset view
        if (placements.length === 0) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            return;
        }

        // World-space bounds of all nodes (include per-node sizes)
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

        // Canvas size in screen px
        const cw = el.clientWidth;
        const ch = el.clientHeight;

        // Padding around the fitted box (screen px)
        const pad = 80;
        const availW = Math.max(1, cw - pad * 2);
        const availH = Math.max(1, ch - pad * 2);

        // Fit zoom (uniform)
        const fitZoom = Math.min(availW / boundsW, availH / boundsH);
        const nextZoom = clamp(fitZoom, ZOOM_MIN, ZOOM_MAX);

        // Center bounds in screen
        const worldCx = minX + boundsW / 2;
        const worldCy = minY + boundsH / 2;
        const screenCx = cw / 2;
        const screenCy = ch / 2;

        // screen = world*zoom + pan => pan = screen - world*zoom
        const nextPanX = screenCx - worldCx * nextZoom;
        const nextPanY = screenCy - worldCy * nextZoom;

        setZoom(nextZoom);
        setPan({ x: nextPanX, y: nextPanY });
    };

    // Let parent store a handle for the button
    React.useEffect(() => {
        registerCenterFn?.(centerOnItems);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registerCenterFn, project, NODE_W, NODE_H]);

    // Spacebar centers/fits (avoid scrolling / button activation)
    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.code !== "Space") return;

            // Don't steal space when typing in inputs
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
                    // grid scales with zoom and shifts with pan
                    backgroundSize: `${gridPx}px ${gridPx}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px`,
                    cursor: panDragRef.current?.active ? "grabbing" : "grab",
                    // Needed so onWheel preventDefault actually works in React
                    touchAction: "none",
                }}
            >
                {/* HUD */}
                <div className="absolute right-3 top-3 z-10 rounded-xl border bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
                    Zoom: {Math.round(zoom * 100)}%
                </div>

                {project.devices.length === 0 ? (
                    <div className="absolute inset-0 grid place-items-center">
                        <div className="rounded-2xl border bg-background/80 p-4 text-center text-sm text-muted-foreground">
                            Drag a device from the right panel onto the grid.
                        </div>
                    </div>
                ) : null}

                {/* inside the canvas div (same place you render nodes) */}
                <div
                    className="absolute inset-0"
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
                        />
                    ))}
                </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div>Grid: {GRID}px • Pan: drag empty space • Zoom: mouse wheel • Snap is in world units</div>
                <div>Next logical step: render connections as SVG paths using ports + node positions in world coords.</div>
            </div>
        </div>
    );
}
