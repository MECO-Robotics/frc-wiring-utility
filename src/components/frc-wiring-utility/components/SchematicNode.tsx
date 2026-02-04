import React from "react";
import type { DeviceType } from "../palette";
import { PALETTE_BY_ID } from "../paletteLookup";

type DeviceLike = {
    id?: string;            // unique instance id (node id) - recommended
    name: string;           // not rendered here (keep for labels elsewhere)
    type: DeviceType;       // palette id
    subsystem?: string;     // not rendered here
    attrs?: { canId?: number };
};

function clamp01(n: number) {
    if (!Number.isFinite(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
}

export function SchematicNode(props: {
    device: DeviceLike;
    selected?: boolean;
    className?: string;
    showPorts?: boolean;      // default true; can hide in palette if wanted
    portDotRadius?: number;   // in px, default 4
}) {
    const { device: d, selected, className, showPorts = true, portDotRadius = 4 } = props;

    const item = PALETTE_BY_ID.get(d.type);
    if (!item) {
        // Fail loudly: if a node type isn't in the palette, wiring can't work
        throw new Error(`SchematicNode: unknown palette id "${d.type}"`);
    }

    const aspect = item.svg_meta?.aspect ?? 1; // width/height
    // We'll render into a fixed viewBox and map ports in that space.
    // This makes port placement resolution-independent.
    const vbW = 1000;
    const vbH = aspect && Number.isFinite(aspect) && aspect > 0 ? vbW / aspect : 1000;

    return (
        <div
            className={
                "relative h-full w-full select-none " +
                (selected ? "ring-2 ring-foreground/40 rounded-xl" : "") +
                (className ? ` ${className}` : "")
            }
            data-node-id={d.id ?? ""}
            data-node-type={d.type}
        >
            {/* SVG-only node */}
            <svg
                className="h-full w-full block"
                viewBox={`0 0 ${vbW} ${vbH}`}
                preserveAspectRatio="xMidYMid meet"
            >
                {/* Component body as an image so we don't need inline SVG parsing */}
                <image
                    href={item.svgUrl}
                    x={0}
                    y={0}
                    width={vbW}
                    height={vbH}
                    preserveAspectRatio="xMidYMid meet"
                />

                {/* Port markers (anchors for wires) */}
                {showPorts &&
                    item.ports.map((p) => {
                        const x = clamp01(p.x) * vbW;
                        const y = clamp01(p.y) * vbH;
                        return (
                            <g
                                key={p.id}
                                data-port-id={p.id}
                                data-port-type={p.type}
                                data-node-port={`${d.id ?? ""}:${p.id}`}
                            >
                                {/* outer ring */}
                                <circle cx={x} cy={y} r={portDotRadius + 2} opacity={0.35} />
                                {/* inner dot */}
                                <circle cx={x} cy={y} r={portDotRadius} />
                            </g>
                        );
                    })}
            </svg>
        </div>
    );
}
