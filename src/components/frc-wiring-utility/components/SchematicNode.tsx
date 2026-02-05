import React from "react";
import type { DeviceType } from "../palette";
import { PALETTE_BY_ID } from "../paletteLookup";

type DeviceLike = {
    id?: string;
    name: string;
    type: DeviceType;
    subsystem?: string;
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
    showPorts?: boolean;
    portDotRadius?: number;
}) {
    const { device: d, selected, className, showPorts = true, portDotRadius = 4 } = props;

    const item = PALETTE_BY_ID.get(d.type);
    if (!item) throw new Error(`SchematicNode: unknown palette id "${d.type}"`);

    const vb = item.svg_meta?.viewBox;
    const vbW = vb && Number.isFinite(vb.width) && vb.width > 0 ? vb.width : 1000;
    const vbH = vb && Number.isFinite(vb.height) && vb.height > 0 ? vb.height : 1000;

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
            <svg className="h-full w-full block" viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="none">
                <image href={item.svgUrl} x={0} y={0} width={vbW} height={vbH} preserveAspectRatio="none" />

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
                                <circle cx={x} cy={y} r={portDotRadius + 2} opacity={0.35} />
                                <circle cx={x} cy={y} r={portDotRadius} />
                            </g>
                        );
                    })}
            </svg>
        </div>
    );
}
