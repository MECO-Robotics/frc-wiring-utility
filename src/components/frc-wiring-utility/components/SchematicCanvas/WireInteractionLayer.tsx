import React from "react";
import type { Project } from "../../core/types";
import type { Pt as WirePt } from "../../../../helpers/wires";
import { snapToGrid } from "../../../../helpers/wires";
import { polylineToSvgPathScreen } from "./wireRouting";
import type { WireSegDrag } from "./types";

type Props = {
    project: Project;
    wireMode: boolean;
    GRID: number;
    polyPointsForConn: (c: Project["connections"][number]) => { pts: WirePt[]; bends: WirePt[] } | null;
    worldToScreen: (x: number, y: number) => { sx: number; sy: number };
    screenToWorld: (sx: number, sy: number) => { x: number; y: number };
    canvasPointFromEvent: (clientX: number, clientY: number) => { x: number; y: number };
    ensureRoutePersisted: (connId: string) => void;
    pickSegment: (connId: string, clientX: number, clientY: number) => { segIndex: number; axis: "H" | "V" } | null;
    onSelectConn: (connId: string) => void;
    onSelectDevice: (id: string | null) => void;
    onStartWireSegDrag: (drag: WireSegDrag) => void;
    suppressNextCanvasClickRef: React.MutableRefObject<boolean>;
};

export function WireInteractionLayer({
    project,
    wireMode,
    GRID,
    polyPointsForConn,
    worldToScreen,
    screenToWorld,
    canvasPointFromEvent,
    ensureRoutePersisted,
    pickSegment,
    onSelectConn,
    onSelectDevice,
    onStartWireSegDrag,
    suppressNextCanvasClickRef,
}: Props) {
    if (!wireMode) {
        return <svg className="absolute inset-0 z-50" style={{ width: "100%", height: "100%", pointerEvents: "none" }} />;
    }

    return (
        <svg className="absolute inset-0 z-50" style={{ width: "100%", height: "100%", pointerEvents: "none" }}>
            {project.connections.map((c) => {
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

                                suppressNextCanvasClickRef.current = true;

                                onSelectConn(c.id);
                                onSelectDevice(null);

                                ensureRoutePersisted(c.id);

                                const pick = pickSegment(c.id, e.clientX, e.clientY);
                                if (!pick) return;

                                const baseRoute = info.bends.map((p) => ({
                                    x: snapToGrid(p.x, GRID),
                                    y: snapToGrid(p.y, GRID),
                                }));

                                const local = canvasPointFromEvent(e.clientX, e.clientY);
                                const startWorld = screenToWorld(local.x, local.y);

                                onStartWireSegDrag({
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
                                suppressNextCanvasClickRef.current = true;
                            }}
                            onPointerUp={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                suppressNextCanvasClickRef.current = true;
                            }}
                        />
                    </g>
                );
            })}
        </svg>
    );
}


