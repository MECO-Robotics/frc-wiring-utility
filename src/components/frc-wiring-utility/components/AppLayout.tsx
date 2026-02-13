import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Device, DeviceType, Issue, Project } from "../types";
import type { PortType } from "../palette";
import { SchematicCanvas } from "./SchematicCanvas";
import { PalettePanel } from "./PalettePanel";
import { InspectorPanel } from "./InspectorPanel";
import { ValidationPanel } from "./ValidationPanel";
import { DataPanel } from "./DataPanel";

export function AppLayout(props: {
    project: Project;
    selectedDeviceId: string | null;
    setSelectedDeviceId: (id: string | null) => void;
    selectedConnId: string | null;
    setSelectedConnId: (id: string | null) => void;
    wireMode: boolean;
    setWireActions: (actions: { addBend: (connId: string) => void; removeBend: (connId: string) => void; resetRoute: (connId: string) => void }) => void;
    registerCenterFn: (fn: () => void) => void;
    GRID: number;
    NODE_W: number;
    NODE_H: number;
    onDropCreate: (type: DeviceType, x: number, y: number) => void;
    onMovePlacement: (deviceId: string, x: number, y: number) => void;
    onCreateWire: (fromDeviceId: string, fromPortId: string, toDeviceId: string, toPortId: string, portType: PortType) => void;
    onUpdateWireRoute: (connId: string, route: { x: number; y: number }[]) => void;
    onPaletteDragStart: (e: React.DragEvent, type: DeviceType) => void;
    onQuickAdd: (type: DeviceType) => void;
    onDeleteDevice: (id: string) => void;
    onPatchDevice: (id: string, patch: Partial<Device>) => void;
    onSetDeviceType: (id: string, newType: DeviceType) => void;
    onSetCanId: (id: string, canId: number | undefined) => void;
    onAddWireNode: (id: string) => void;
    onRemoveWireNode: (id: string) => void;
    onClearWireNodes: (id: string) => void;
    issues: Issue[];
    onSelectIssueDevice: (id: string) => void;
}) {
    const {
        project,
        selectedDeviceId,
        setSelectedDeviceId,
        selectedConnId,
        setSelectedConnId,
        wireMode,
        setWireActions,
        registerCenterFn,
        GRID,
        NODE_W,
        NODE_H,
        onDropCreate,
        onMovePlacement,
        onCreateWire,
        onUpdateWireRoute,
        onPaletteDragStart,
        onQuickAdd,
        onDeleteDevice,
        onPatchDevice,
        onSetDeviceType,
        onSetCanId,
        onAddWireNode,
        onRemoveWireNode,
        onClearWireNodes,
        issues,
        onSelectIssueDevice,
    } = props;

    return (
        <div className="mx-auto grid max-w-7xl min-h-0 grid-cols-[1fr_360px] gap-3 overflow-hidden p-3">
            <Card className="flex h-full min-h-0 flex-col rounded-2xl">
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">Schematic</CardTitle>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline">{project.devices.length} devices</Badge>
                            <Badge variant="outline">{project.connections.length} connections</Badge>
                            <Badge variant="outline">{project.nets.length} nets</Badge>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="min-h-0 flex-1">
                    <SchematicCanvas
                        project={project}
                        selectedDeviceId={selectedDeviceId}
                        setSelectedDeviceId={setSelectedDeviceId}
                        selectedConnId={selectedConnId}
                        setSelectedConnId={setSelectedConnId}
                        registerWireActions={setWireActions}
                        GRID={GRID}
                        NODE_W={NODE_W}
                        NODE_H={NODE_H}
                        onDropCreate={onDropCreate}
                        onMovePlacement={onMovePlacement}
                        wireMode={wireMode}
                        onCreateWire={onCreateWire}
                        onUpdateWireRoute={onUpdateWireRoute}
                        registerCenterFn={registerCenterFn}
                    />
                </CardContent>
            </Card>

            <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-1">
                <PalettePanel onPaletteDragStart={onPaletteDragStart} onQuickAdd={onQuickAdd} />

                <InspectorPanel
                    project={project}
                    selectedDeviceId={selectedDeviceId}
                    selectedConnectionId={selectedConnId}
                    onDeleteDevice={onDeleteDevice}
                    onPatchDevice={onPatchDevice}
                    onSetDeviceType={onSetDeviceType}
                    onSetCanId={onSetCanId}
                    onAddWireNode={onAddWireNode}
                    onRemoveWireNode={onRemoveWireNode}
                    onClearWireNodes={onClearWireNodes}
                />

                <ValidationPanel issues={issues} onSelectDevice={onSelectIssueDevice} />

                <DataPanel />
            </div>
        </div>
    );
}
