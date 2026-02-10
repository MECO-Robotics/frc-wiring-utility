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
    wireMode?: boolean;
    compatiblePortSet?: Set<string>; // `${deviceId}::${portId}` for highlighting
    onPortPointerDown?: (e: React.PointerEvent, deviceId: string, portId: string) => void;
}) {
    const {
        device: d,
        selected,
        className,
        showPorts = true,
        portDotRadius = 4,
        wireMode = false,
        compatiblePortSet,
        onPortPointerDown,
    } = props;

    const item = PALETTE_BY_ID.get(d.type);
    if (!item) throw new Error(`SchematicNode: unknown palette id "${d.type}"`);

    const vb = item.svg_meta?.viewBox;
    const vbW = vb && Number.isFinite(vb.width) && vb.width > 0 ? vb.width : 1000;
    const vbH = vb && Number.isFinite(vb.height) && vb.height > 0 ? vb.height : 1000;

    // Make dots visible regardless of viewBox scale.
    const autoR = Math.max(10, Math.min(vbW, vbH) * 0.012); // ~12px-ish on typical nodes
    const r = Number.isFinite(portDotRadius) ? portDotRadius! : autoR;


    return (
        <div
            className={
                "relative h-full w-full select-none " +
                (selected ? "ring-2 ring-foreground/40 rounded-xl" : "") +
                (className ? ` ${className}` : "")
            }
            data-node-id={d.id ?? ""}
            data-node-type={d.type}
            data-node-root="true"
        >
            <svg className="h-full w-full block" viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="none">
                <image href={item.svgUrl} x={0} y={0} width={vbW} height={vbH} preserveAspectRatio="none" />

                {showPorts &&
                    item.ports.map((p) => {
                        const x = clamp01(p.x) * vbW;
                        const y = clamp01(p.y) * vbH;
                        const key = `${d.id ?? ""}::${p.id}`;
                        const highlight = !!compatiblePortSet?.has(key);

                        // Radius in viewBox units (visible even when vb is 1000x1000)
                        const r = Math.max(10, Math.min(vbW, vbH) * 0.012);

                        const commonData = {
                            "data-port-id": p.id,
                            "data-port-type": p.type,
                            "data-node-port": `${d.id ?? ""}:${p.id}`,
                        } as const;

                        return (
                            <g key={p.id} style={{ cursor: wireMode ? "crosshair" : "default" }}>
                                {/* halo: bigger hit area + glow */}
                                <circle
                                    cx={x}
                                    cy={y}
                                    r={r + 10}
                                    fill="white"
                                    opacity={highlight ? 0.55 : 0.18}
                                    vectorEffect="non-scaling-stroke"
                                    {...commonData}
                                    onPointerDown={(e) => {
                                        if (!wireMode) return;
                                        e.stopPropagation();
                                        onPortPointerDown?.(e, d.id ?? "", p.id);
                                    }}
                                />
                                {/* dot */}
                                <circle
                                    cx={x}
                                    cy={y}
                                    r={r + (highlight ? 2 : 0)}
                                    fill="white"
                                    stroke="black"
                                    strokeWidth={6}
                                    vectorEffect="non-scaling-stroke"
                                    {...commonData}
                                    onPointerDown={(e) => {
                                        if (!wireMode) return;
                                        e.stopPropagation();
                                        onPortPointerDown?.(e, d.id ?? "", p.id);
                                    }}
                                />
                            </g>
                        );
                    })}
            </svg>
        </div>
    );
}
