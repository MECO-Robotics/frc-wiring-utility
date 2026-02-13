import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { NetKind, Project } from "../types";
import type { PortType } from "../palette";
import { uid } from "../helpers";

function netKindForPortType(pt: PortType): NetKind {
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
}

export function useWireActions(setProject: Dispatch<SetStateAction<Project>>) {
    const updateWireRoute = useCallback((connId: string, route: { x: number; y: number }[]) => {
        setProject((p) => ({
            ...p,
            connections: p.connections.map((c) => (c.id === connId ? { ...c, route } : c)),
        }));
    }, [setProject]);

    const addWire = useCallback((
        fromDeviceId: string,
        fromPortId: string,
        toDeviceId: string,
        toPortId: string,
        portType: PortType
    ) => {
        const kind = netKindForPortType(portType);
        const netId = `net:${kind}:${portType}`;

        setProject((p) => {
            const nets = p.nets.some((n) => n.id === netId)
                ? p.nets
                : [...p.nets, { id: netId, kind, name: `${kind} (${portType})` }];

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
    }, [setProject]);

    return {
        addWire,
        updateWireRoute,
    };
}
