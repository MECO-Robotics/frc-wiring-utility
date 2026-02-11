import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Minus } from "lucide-react";
import type { Device, DeviceType, Project } from "../types";
import { deviceHasCanId, portsFor, safeInt } from "../helpers";
import { PALETTE } from "../palette";

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

    const routeCount = Array.isArray(selectedConn?.route) ? selectedConn!.route.length : 0;

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

                {/* Device selected */}
                {selectedDevice ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{selectedDevice.name}</div>
                                <div className="text-xs text-muted-foreground">ID: {selectedDevice.id}</div>
                            </div>
                            <Button variant="destructive" className="h-8" onClick={() => onDeleteDevice(selectedDevice.id)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                            </Button>
                        </div>

                        <div className="grid gap-2">
                            <Label className="text-xs">Name</Label>
                            <Input
                                value={selectedDevice.name}
                                onChange={(e) => onPatchDevice(selectedDevice.id, { name: e.target.value })}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                                <Label className="text-xs">Type</Label>
                                <Select value={selectedDevice.type} onValueChange={(v) => onSetDeviceType(selectedDevice.id, v as DeviceType)}>
                                    <SelectTrigger className="h-9">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(PALETTE.map((x) => x.type) as DeviceType[]).map((t) => (
                                            <SelectItem key={t} value={t}>
                                                {t}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <Label className="text-xs">Subsystem</Label>
                                <Input
                                    className="h-9"
                                    value={selectedDevice.subsystem ?? ""}
                                    onChange={(e) => onPatchDevice(selectedDevice.id, { subsystem: e.target.value })}
                                    placeholder="drivetrain"
                                />
                            </div>
                        </div>

                        {deviceHasCanId(selectedDevice.type) ? (
                            <div className="grid gap-2">
                                <Label className="text-xs">CAN ID</Label>
                                <Input
                                    value={selectedDevice.attrs?.canId === undefined ? "" : String(selectedDevice.attrs?.canId)}
                                    onChange={(e) => onSetCanId(selectedDevice.id, safeInt(e.target.value))}
                                    placeholder="12"
                                />
                            </div>
                        ) : null}

                        <div className="space-y-1">
                            <Label className="text-xs">Ports</Label>
                            <div className="flex flex-wrap gap-2">
                                {portsFor(selectedDevice.type).map((p) => (
                                    <Badge key={p} variant="outline">
                                        {p}
                                    </Badge>
                                ))}
                            </div>
                        </div>

                        <Separator />

                        <div className="text-xs text-muted-foreground">
                            Position is stored in <code>project.placements</code>.
                        </div>
                    </div>
                ) : null}

                {/* Wire selected */}
                {!selectedDevice && selectedConn ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">Wire</div>
                                <div className="text-xs text-muted-foreground">ID: {selectedConn.id}</div>
                            </div>

                            <Badge variant="outline">
                                Nodes: {routeCount}
                            </Badge>
                        </div>

                        <div className="rounded-xl border p-3 text-xs space-y-2">
                            <div className="text-muted-foreground">From</div>
                            <div className="font-mono text-[11px]">
                                {selectedConn.from.deviceId} :: {selectedConn.from.port}
                            </div>

                            <div className="text-muted-foreground pt-2">To</div>
                            <div className="font-mono text-[11px]">
                                {selectedConn.to.deviceId} :: {selectedConn.to.port}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <Button
                                className="h-9"
                                onClick={() => onAddWireNode(selectedConn.id)}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add node
                            </Button>

                            <Button
                                className="h-9"
                                variant="secondary"
                                disabled={routeCount === 0}
                                onClick={() => onRemoveWireNode(selectedConn.id)}
                            >
                                <Minus className="mr-2 h-4 w-4" />
                                Remove node
                            </Button>
                        </div>

                        {onClearWireNodes ? (
                            <Button
                                className="h-9"
                                variant="destructive"
                                disabled={routeCount === 0}
                                onClick={() => onClearWireNodes(selectedConn.id)}
                            >
                                Clear nodes
                            </Button>
                        ) : null}

                        <Separator />

                        <div className="text-xs text-muted-foreground">
                            Nodes are stored in <code>connection.route</code> as world points.
                        </div>
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}