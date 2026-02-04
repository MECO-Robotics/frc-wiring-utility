import React from "react";
import type { Project } from "../types";
import { getPlacement } from "../helpers";
import { SchematicNode } from "./SchematicNode";
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

    const { w: nodeW, h: nodeH } = nodeSize(d.type, NODE_W, NODE_H);

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
            <SchematicNode device={d} selected={selected} />
            {/* If you want coords, make it an optional overlay here, not inside SchematicNode */}
        </div>
    );
}
