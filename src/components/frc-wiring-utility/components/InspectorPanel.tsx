import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Device, DeviceType, Project } from "../core/types";
import { DeviceInspector } from "./DeviceInspector";
import { WireInspector } from "./WireInspector";

type Connection = Project["connections"][number];

export function InspectorPanel(props: {
    project: Project;

    selectedDeviceId: string | null;

    // NEW: connection selection
    selectedConnectionId: string | null;

    onDeleteDevice: (id: string) => void;
    onPatchDevice: (id: string, patch: Partial<Device>) => void;
    onSetDeviceType: (id: string, newType: DeviceType) => void;
    onSetCanId: (id: string, canId: number | undefined) => void;

    // NEW: wire route editing
    onAddWireNode: (connectionId: string) => void;
    onRemoveWireNode: (connectionId: string) => void;

    // Optional: quick-clear route
    onClearWireNodes?: (connectionId: string) => void;
}) {
    const {
        project,
        selectedDeviceId,
        selectedConnectionId,
        onDeleteDevice,
        onPatchDevice,
        onSetDeviceType,
        onSetCanId,
        onAddWireNode,
        onRemoveWireNode,
        onClearWireNodes,
    } = props;

    const selectedDevice = useMemo(
        () => (selectedDeviceId ? project.devices.find((d) => d.id === selectedDeviceId) : undefined),
        [project.devices, selectedDeviceId]
    );

    const selectedConn: Connection | undefined = useMemo(
        () => (selectedConnectionId ? project.connections.find((c) => c.id === selectedConnectionId) : undefined),
        [project.connections, selectedConnectionId]
    );

    return (
        <Card className="rounded-2xl">
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Inspector</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
                {/* Nothing selected */}
                {!selectedDevice && !selectedConn ? (
                    <div className="rounded-xl border p-3 text-sm text-muted-foreground">
                        Select a device or wire on the schematic to edit.
                    </div>
                ) : null}

                {selectedDevice ? (
                    <DeviceInspector
                        device={selectedDevice}
                        onDeleteDevice={onDeleteDevice}
                        onPatchDevice={onPatchDevice}
                        onSetDeviceType={onSetDeviceType}
                        onSetCanId={onSetCanId}
                    />
                ) : null}

                {!selectedDevice && selectedConn ? (
                    <WireInspector
                        connection={selectedConn}
                        onAddWireNode={onAddWireNode}
                        onRemoveWireNode={onRemoveWireNode}
                        onClearWireNodes={onClearWireNodes}
                    />
                ) : null}
            </CardContent>
        </Card>
    );
}

