import type { Issue, Project } from "./types";
import { deviceHasCanId, getPlacement, uid } from "./helpers";

export function validate(p: Project): Issue[] {
    const issues: Issue[] = [];
    const devById = new Map(p.devices.map((d) => [d.id, d] as const));
    const netById = new Map(p.nets.map((n) => [n.id, n] as const));

    // Duplicate CAN IDs among devices that have them
    const used = new Map<number, string[]>();
    for (const d of p.devices) {
        if (!deviceHasCanId(d.type)) continue;
        const cid = d.attrs?.canId;
        if (cid === undefined) {
            issues.push({
                id: uid("iss"),
                severity: "warn",
                title: "Missing CAN ID",
                detail: `${d.name} (${d.type}) has no CAN ID`,
                ref: { deviceId: d.id },
            });
            continue;
        }
        const arr = used.get(cid) ?? [];
        arr.push(d.id);
        used.set(cid, arr);
    }
    for (const [cid, ids] of used.entries()) {
        if (ids.length > 1) {
            issues.push({
                id: uid("iss"),
                severity: "error",
                title: "Duplicate CAN ID",
                detail: `CAN ${cid} used by: ${ids.map((id) => devById.get(id)?.name ?? id).join(", ")}`,
            });
        }
    }

    // Connections reference existing devices + nets
    for (const c of p.connections) {
        if (!netById.has(c.netId)) {
            issues.push({
                id: uid("iss"),
                severity: "error",
                title: "Connection references missing net",
                detail: `${c.id} → netId=${c.netId}`,
                ref: { connId: c.id },
            });
        }
        if (!devById.has(c.from.deviceId) || !devById.has(c.to.deviceId)) {
            issues.push({
                id: uid("iss"),
                severity: "error",
                title: "Connection references missing device",
                detail: `${c.id}: from=${c.from.deviceId} to=${c.to.deviceId}`,
                ref: { connId: c.id },
            });
        }
    }

    // Basic power wire metadata check
    const powerNetIds = new Set(p.nets.filter((n) => n.kind === "POWER_12V").map((n) => n.id));
    for (const c of p.connections) {
        if (!powerNetIds.has(c.netId)) continue;
        if (c.attrs?.breakerA === undefined) {
            issues.push({
                id: uid("iss"),
                severity: "warn",
                title: "Power connection missing breaker",
                detail: `${c.id} has no breakerA`,
                ref: { connId: c.id },
            });
        }
        if (c.attrs?.wireAwg === undefined) {
            issues.push({
                id: uid("iss"),
                severity: "warn",
                title: "Power connection missing wire gauge",
                detail: `${c.id} has no wireAwg`,
                ref: { connId: c.id },
            });
        }
    }

    // Placement sanity: devices with no placement
    for (const d of p.devices) {
        if (!getPlacement(p, d.id)) {
            issues.push({
                id: uid("iss"),
                severity: "warn",
                title: "Device not placed on schematic",
                detail: `${d.name} (${d.type}) is not placed`,
                ref: { deviceId: d.id },
            });
        }
    }

    return issues;
}
