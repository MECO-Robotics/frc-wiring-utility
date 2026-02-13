import { useCallback, useMemo, useRef, useState } from "react";
import type { Device, DeviceType, Project } from "../types";
import { DEFAULT } from "../defaults";
import { validate } from "../validation";
import { deviceHasCanId, removePlacement, snap, uid, upsertPlacement } from "../helpers";

export function useProjectState(grid: number, nodeW: number, nodeH: number) {
    const [project, setProject] = useState<Project>(() => structuredClone(DEFAULT));
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(project.devices[0]?.id ?? null);
    const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
    const [wireMode, setWireMode] = useState(false);

    const centerFnRef = useRef<null | (() => void)>(null);
    const wireActionsRef = useRef<{
        addBend: (connId: string) => void;
        removeBend: (connId: string) => void;
        resetRoute: (connId: string) => void;
    } | null>(null);

    const issues = useMemo(() => validate(project), [project]);
    const errorsCount = issues.filter((i) => i.severity === "error").length;
    const warnsCount = issues.filter((i) => i.severity === "warn").length;

    const newProject = useCallback(() => {
        const next = structuredClone(DEFAULT) as Project;
        setProject(next);
        setSelectedDeviceId(next.devices[0]?.id ?? null);
        setSelectedConnId(null);
    }, []);

    const addDeviceAt = useCallback((type: DeviceType, x: number, y: number) => {
        const id = uid("dev");
        const d: Device = {
            id,
            type,
            name: type === "MotorController" ? "Motor Controller" : type,
            attrs: deviceHasCanId(type) ? { canId: undefined } : {},
        };

        setProject((p) => {
            const withDev = { ...p, devices: [...p.devices, d] };
            return upsertPlacement(withDev, { deviceId: id, x: snap(x, grid), y: snap(y, grid) });
        });

        setSelectedDeviceId(id);
    }, [grid]);

    const quickAdd = useCallback((type: DeviceType) => {
        addDeviceAt(type, snap(1200 / 2 - nodeW / 2, grid), snap(800 / 2 - nodeH / 2, grid));
    }, [addDeviceAt, grid, nodeH, nodeW]);

    const movePlacement = useCallback((deviceId: string, x: number, y: number) => {
        setProject((p) => upsertPlacement(p, { deviceId, x, y }));
    }, []);

    const deleteDevice = useCallback((id: string) => {
        setProject((p) => {
            const next: Project = {
                ...p,
                devices: p.devices.filter((d) => d.id !== id),
                connections: p.connections.filter((c) => c.from.deviceId !== id && c.to.deviceId !== id),
            };
            return removePlacement(next, id);
        });
        setSelectedDeviceId((prev) => (prev === id ? null : prev));
    }, []);

    const patchDevice = useCallback((id: string, patch: Partial<Device>) => {
        setProject((p) => ({
            ...p,
            devices: p.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        }));
    }, []);

    const setDeviceType = useCallback((id: string, newType: DeviceType) => {
        const hasCan = deviceHasCanId(newType);
        setProject((p) => ({
            ...p,
            devices: p.devices.map((d) =>
                d.id === id ? { ...d, type: newType, attrs: { ...(d.attrs ?? {}), canId: hasCan ? d.attrs?.canId : undefined } } : d
            ),
        }));
    }, []);

    const setCanId = useCallback((id: string, canId: number | undefined) => {
        setProject((p) => ({
            ...p,
            devices: p.devices.map((d) => (d.id === id ? { ...d, attrs: { ...(d.attrs ?? {}), canId } } : d)),
        }));
    }, []);

    const onPaletteDragStart = useCallback((e: React.DragEvent, type: DeviceType) => {
        e.dataTransfer.setData("application/x-frc-device-type", type);
        e.dataTransfer.effectAllowed = "copy";
    }, []);

    return {
        project,
        setProject,
        selectedDeviceId,
        setSelectedDeviceId,
        selectedConnId,
        setSelectedConnId,
        wireMode,
        setWireMode,
        centerFnRef,
        wireActionsRef,
        issues,
        errorsCount,
        warnsCount,
        newProject,
        addDeviceAt,
        quickAdd,
        movePlacement,
        deleteDevice,
        patchDevice,
        setDeviceType,
        setCanId,
        onPaletteDragStart,
    };
}

