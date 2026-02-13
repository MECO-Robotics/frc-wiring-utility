import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import type { Device, DeviceType } from "../types";
import { deviceHasCanId, portsFor, safeInt } from "../helpers";
import { PALETTE } from "../palette";

export function DeviceInspector(props: {
    device: Device;
    onDeleteDevice: (id: string) => void;
    onPatchDevice: (id: string, patch: Partial<Device>) => void;
    onSetDeviceType: (id: string, newType: DeviceType) => void;
    onSetCanId: (id: string, canId: number | undefined) => void;
}) {
    const { device, onDeleteDevice, onPatchDevice, onSetDeviceType, onSetCanId } = props;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{device.name}</div>
                    <div className="text-xs text-muted-foreground">ID: {device.id}</div>
                </div>
                <Button variant="destructive" className="h-8" onClick={() => onDeleteDevice(device.id)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                </Button>
            </div>

            <div className="grid gap-2">
                <Label className="text-xs">Name</Label>
                <Input
                    value={device.name}
                    onChange={(e) => onPatchDevice(device.id, { name: e.target.value })}
                />
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={device.type} onValueChange={(v) => onSetDeviceType(device.id, v as DeviceType)}>
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
                        value={device.subsystem ?? ""}
                        onChange={(e) => onPatchDevice(device.id, { subsystem: e.target.value })}
                        placeholder="drivetrain"
                    />
                </div>
            </div>

            {deviceHasCanId(device.type) ? (
                <div className="grid gap-2">
                    <Label className="text-xs">CAN ID</Label>
                    <Input
                        value={device.attrs?.canId === undefined ? "" : String(device.attrs?.canId)}
                        onChange={(e) => onSetCanId(device.id, safeInt(e.target.value))}
                        placeholder="12"
                    />
                </div>
            ) : null}

            <div className="space-y-1">
                <Label className="text-xs">Ports</Label>
                <div className="flex flex-wrap gap-2">
                    {portsFor(device.type).map((p) => (
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
    );
}

