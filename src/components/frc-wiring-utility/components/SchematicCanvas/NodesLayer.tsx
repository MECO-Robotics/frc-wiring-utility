import React from "react";
import type { Project } from "../../types";
import { CanvasNode } from "../CanvasNode";

type Props = {
    project: Project;
    NODE_W: number;
    NODE_H: number;
    selectedDeviceId: string | null;
    setSelectedDeviceId: (id: string | null) => void;
    onNodePointerDown: (e: React.PointerEvent, deviceId: string) => void;
    onNodePointerMove: (e: React.PointerEvent) => void;
    onNodePointerUp: () => void;
    wireMode: boolean;
    compatiblePortSet: Set<string>;
    onPortPointerDown: (e: React.PointerEvent, deviceId: string, portId: string) => void;
};

export function NodesLayer({
    project,
    NODE_W,
    NODE_H,
    selectedDeviceId,
    setSelectedDeviceId,
    onNodePointerDown,
    onNodePointerMove,
    onNodePointerUp,
    wireMode,
    compatiblePortSet,
    onPortPointerDown,
}: Props) {
    return (
        <div
            className="absolute inset-0 z-10"
            style={{
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
    );
}

