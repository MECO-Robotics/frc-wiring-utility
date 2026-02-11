import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import type { Device, DeviceType, Project, NetKind } from "./types";
import { DEFAULT } from "./defaults";
import type { PortType } from "./palette";
import { validate } from "./validation";
import { deviceHasCanId, downloadText, removePlacement, snap, uid, upsertPlacement } from "./helpers";

import { useTheme } from "./hooks/useTheme";
import { useProjectIO } from "./hooks/useProjectIO";

import { TopBar } from "./components/TopBar";
import { SchematicCanvas } from "./components/SchematicCanvas";
import { PalettePanel } from "./components/PalettePanel";
import { InspectorPanel } from "./components/InspectorPanel";
import { ValidationPanel } from "./components/ValidationPanel";
import { DataPanel } from "./components/DataPanel";

export default function FRCWiringUtilityApp() {
    const GRID = 20;
    const NODE_W = 170;
    const NODE_H = 72;

    const [project, setProject] = useState<Project>(() => structuredClone(DEFAULT));
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(project.devices[0]?.id ?? null);
    const [wireMode, setWireMode] = useState(false);
    const [selectedConnId, setSelectedConnId] = useState<string | null>(null);

    const wireActionsRef = useRef<{
        addBend: (connId: string) => void;
        removeBend: (connId: string) => void;
        resetRoute: (connId: string) => void;
    } | null>(null);

    const { theme, setTheme } = useTheme();

    const { importRef, onImportClick, onImportFile } = useProjectIO({
        setProject,
        setSelectedDeviceId,
    });

    const issues = useMemo(() => validate(project), [project]);
    const errorsCount = issues.filter((i) => i.severity === "error").length;
    const warnsCount = issues.filter((i) => i.severity === "warn").length;

    const exportJson = () => {
        const fn = `frc_wiring_${project.meta.team || "team"}_${project.meta.season || "season"}.json`;
        downloadText(fn, JSON.stringify(project, null, 2));
    };

    const newProject = () => {
        const next = structuredClone(DEFAULT) as Project;
        setProject(next);
        setSelectedDeviceId(next.devices[0]?.id ?? null);
    };

    // CRUD (still centralized)
    const netKindForPortType = (pt: PortType): NetKind => {
        switch (pt) {
            case "ethernet":
                return "ETH";
            case "usb":
                return "USB";
            case "4_gauge":
            case "12_gauge":
                return "POWER_12V";
            case "18_gauge":
            default:
                // We don't have a generic "signal" kind in the schema; DIO is the least-wrong bucket.
                return "DIO";
        }
    };

    const updateWireMeta = (connId: string, patch: Record<string, any>) => {
        setProject((p) => ({
            ...p,
            connections: p.connections.map((c: any) => (c.id === connId ? { ...c, ...patch } : c)),
        }));
    };

    const updateWireRoute = (connId: string, route: { x: number; y: number }[]) => {
        setProject((p) => ({
            ...p,
            connections: p.connections.map((c: any) => (c.id === connId ? { ...c, route } : c)),
        }));
    };

    const addWire = (
        fromDeviceId: string,
        fromPortId: string,
        toDeviceId: string,
        toPortId: string,
        portType: PortType
    ) => {
        const kind = netKindForPortType(portType);
        const netId = `net:${kind}:${portType}`;

        setProject((p) => {
            // Ensure a net exists (stable id so imports/exports are deterministic)
            const nets = p.nets.some((n) => n.id === netId)
                ? p.nets
                : [...p.nets, { id: netId, kind, name: `${kind} (${portType})` }];

            // De-dupe: don't add exact same endpoints on same net (either direction)
            const exists = p.connections.some(
                (c) =>
                    c.netId === netId &&
                    ((c.from.deviceId === fromDeviceId && c.from.port === fromPortId && c.to.deviceId === toDeviceId && c.to.port === toPortId) ||
                        (c.from.deviceId === toDeviceId && c.from.port === toPortId && c.to.deviceId === fromDeviceId && c.to.port === fromPortId))
            );
            if (exists) return { ...p, nets };

            const connections = [
                ...p.connections,
                {
                    id: uid("conn"),
                    netId,
                    from: { deviceId: fromDeviceId, port: fromPortId },
                    to: { deviceId: toDeviceId, port: toPortId },
                },
            ];

            return { ...p, nets, connections };
        });
    };

    const addDeviceAt = (type: DeviceType, x: number, y: number) => {
        const id = uid("dev");
        const d: Device = {
            id,
            type,
            name: type === "MotorController" ? "Motor Controller" : type,
            attrs: deviceHasCanId(type) ? { canId: undefined } : {},
        };

        setProject((p) => {
            const withDev = { ...p, devices: [...p.devices, d] };
            return upsertPlacement(withDev, { deviceId: id, x: snap(x, GRID), y: snap(y, GRID) });
        });

        setSelectedDeviceId(id);
    };

    const movePlacement = (deviceId: string, x: number, y: number) => {
        setProject((p) => upsertPlacement(p, { deviceId, x, y }));
    };

    const deleteDevice = (id: string) => {
        setProject((p) => {
            const next: Project = {
                ...p,
                devices: p.devices.filter((d) => d.id !== id),
                connections: p.connections.filter((c) => c.from.deviceId !== id && c.to.deviceId !== id),
            };
            return removePlacement(next, id);
        });
        if (selectedDeviceId === id) setSelectedDeviceId(null);
    };

    const patchDevice = (id: string, patch: Partial<Device>) => {
        setProject((p) => ({
            ...p,
            devices: p.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        }));
    };

    const setDeviceType = (id: string, newType: DeviceType) => {
        const hasCan = deviceHasCanId(newType);
        setProject((p) => ({
            ...p,
            devices: p.devices.map((d) =>
                d.id === id ? { ...d, type: newType, attrs: { ...(d.attrs ?? {}), canId: hasCan ? d.attrs?.canId : undefined } } : d
            ),
        }));
    };

    const setCanId = (id: string, canId: number | undefined) => {
        setProject((p) => ({
            ...p,
            devices: p.devices.map((d) => (d.id === id ? { ...d, attrs: { ...(d.attrs ?? {}), canId } } : d)),
        }));
    };

    // Palette drag
    const onPaletteDragStart = (e: React.DragEvent, type: DeviceType) => {
        e.dataTransfer.setData("application/x-frc-device-type", type);
        e.dataTransfer.effectAllowed = "copy";
    };

    // Quick add center
    const quickAdd = (type: DeviceType) => {
        // place center-ish by using a fixed “likely canvas” size; the canvas clamps during drop/move anyway
        addDeviceAt(type, snap(1200 / 2 - NODE_W / 2, GRID), snap(800 / 2 - NODE_H / 2, GRID));
    };

    const centerFnRef = React.useRef<null | (() => void)>(null);

    return (
        <div className="grid h-screen w-full grid-rows-[auto_1fr] overflow-hidden bg-background">
            <TopBar
                project={project}
                setProject={setProject}
                onNew={newProject}
                onImportClick={onImportClick}
                importRef={importRef}
                onImportFile={onImportFile}
                onExport={exportJson}
                errorsCount={errorsCount}
                warnsCount={warnsCount}
                theme={theme}
                onCenterView={() => centerFnRef.current?.()}
                toggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                wireMode={wireMode}
                onToggleWireMode={() => setWireMode((w) => !w)}
            />

            <div className="mx-auto grid max-w-7xl min-h-0 grid-cols-[1fr_360px] gap-3 p-3 overflow-hidden">
                <Card className="rounded-2xl h-full min-h-0 flex flex-col">
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
                            registerWireActions={(a) => {
                                wireActionsRef.current = a;
                            }}
                            GRID={GRID}
                            NODE_W={NODE_W}
                            NODE_H={NODE_H}
                            onDropCreate={addDeviceAt}
                            onMovePlacement={movePlacement}
                            wireMode={wireMode}
                            onCreateWire={addWire}
                            onUpdateWireRoute={updateWireRoute}
                            onUpdateWireMeta={updateWireMeta}
                            registerCenterFn={(fn) => {
                                centerFnRef.current = fn;
                            }}
                        />
                    </CardContent>
                </Card>

                <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-1">
                    <PalettePanel onPaletteDragStart={onPaletteDragStart} onQuickAdd={quickAdd} />

                    <InspectorPanel
                        project={project}
                        selectedDeviceId={selectedDeviceId}
                        selectedConnectionId={selectedConnId}
                        onDeleteDevice={deleteDevice}
                        onPatchDevice={patchDevice}
                        onSetDeviceType={setDeviceType}
                        onSetCanId={setCanId}
                        onAddWireNode={(id) => wireActionsRef.current?.addBend(id)}
                        onRemoveWireNode={(id) => wireActionsRef.current?.removeBend(id)}
                        onClearWireNodes={(id) => wireActionsRef.current?.resetRoute(id)}
                    />

                    <ValidationPanel issues={issues} onSelectDevice={(id) => setSelectedDeviceId(id)} />

                    <DataPanel />
                </div>
            </div>
        </div>
    );
}
