import React from "react";
import type { Project } from "../types";
import { getPlacement } from "../helpers";
import { SchematicNode } from "./SchematicNode";
import { PALETTE_BY_ID } from "../paletteLookup";

const PX_PER_IN = 60; // tweak to taste (50/60/80). This is "zoom feel" at zoom=1.

function nodeSizePx(type: unknown, placementScale: number | undefined, fallbackW: number, fallbackH: number) {
    const item = PALETTE_BY_ID.get(type as any);

    const s = typeof placementScale === "number" && Number.isFinite(placementScale) && placementScale > 0 ? placementScale : 1;

    const phys = (item as any)?.physical_in;
    const w_in = phys?.w;
    const h_in = phys?.h;

    if (Number.isFinite(w_in) && Number.isFinite(h_in) && w_in > 0 && h_in > 0) {
        return { w: w_in * PX_PER_IN * s, h: h_in * PX_PER_IN * s };
    }

    // Fallback: keep app usable even if a part is missing physical dims
    return { w: fallbackW * s, h: fallbackH * s };
}

export function CanvasNode(props: {
    project: Project;
    deviceId: string;
    NODE_W: number;
    NODE_H: number;
    selectedDeviceId: string | null;
    setSelectedDeviceId: (id: string | null) => void;

    onNodePointerDown: (e: React.PointerEvent, deviceId: string) => void;
    onNodePointerMove: (e: React.PointerEvent) => void;
    onNodePointerUp: () => void;
}) {
    const {
        project,
        deviceId,
        NODE_W,
        NODE_H,
        selectedDeviceId,
        setSelectedDeviceId,
        onNodePointerDown,
        onNodePointerMove,
        onNodePointerUp,
    } = props;

    const d = project.devices.find((x) => x.id === deviceId);
    if (!d) return null;

    const pl = getPlacement(project, deviceId);
    if (!pl) return null;

    const selected = selectedDeviceId === deviceId;

    // Use placement.scale if you store it; otherwise defaults to 1
    const { w: nodeW, h: nodeH } = nodeSizePx(d.type, (pl as any).scale, NODE_W, NODE_H);

    return (
        <div
            className="absolute"
            style={{
                width: nodeW,
                height: nodeH,
                left: pl.x,
                top: pl.y,
                cursor: "grab",
            }}
            onPointerDown={(e) => {
                e.stopPropagation();
                onNodePointerDown(e, deviceId);
            }}
            onPointerMove={(e) => {
                e.stopPropagation();
                onNodePointerMove(e);
            }}
            onPointerUp={(e) => {
                e.stopPropagation();
                onNodePointerUp();
            }}
            onClick={(e) => {
                e.stopPropagation();
                setSelectedDeviceId(deviceId);
            }}
        >
            <SchematicNode device={d as any} selected={selected} />
        </div>
    );
}
