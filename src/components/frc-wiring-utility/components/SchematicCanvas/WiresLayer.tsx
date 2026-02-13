import React from "react";
import type { Project } from "../../core/types";
import type { PortType } from "../../core/palette";
import type { Pt as WirePt } from "../../../../helpers/wires";
import { defaultRoute } from "../../../../helpers/wires";
import { polylineToSvgPathScreen } from "./wireRouting";

type WireDrag = {
    fromDeviceId: string;
    fromPortId: string;
    fromPortType: PortType;
    pointerSx: number;
    pointerSy: number;
};

type Props = {
    project: Project;
    selectedConnId: string | null;
    wireDrag: WireDrag | null;
    GRID: number;
    polyPointsForConn: (c: Project["connections"][number]) => { pts: WirePt[] } | null;
    portWorld: (deviceId: string, portId: string) => { x: number; y: number; portType: PortType } | null;
    worldToScreen: (x: number, y: number) => { sx: number; sy: number };
    screenToWorld: (sx: number, sy: number) => { x: number; y: number };
};

function orthoRouteWorld(a: WirePt, b: WirePt, grid: number): WirePt[] {
    const bends = defaultRoute(a, b, grid);
    return [a, ...bends, b];
}

export function WiresLayer({ project, selectedConnId, wireDrag, GRID, polyPointsForConn, portWorld, worldToScreen, screenToWorld }: Props) {
    return (
        <svg className="absolute inset-0 z-40" style={{ width: "100%", height: "100%", pointerEvents: "none" }}>
            {project.connections.map((c) => {
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
                        {isSel ? <path d={dpath} fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0.2} /> : null}
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
                    return <path d={dpath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 6" opacity={0.7} />;
                })()
                : null}
        </svg>
    );
}


