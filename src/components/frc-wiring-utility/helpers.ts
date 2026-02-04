import type { DeviceType, PlacedDevice, Project } from "./types";

export const uid = (p: string) => `${p}_${Math.random().toString(16).slice(2, 10)}`;

export const safeInt = (s: string) => {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
};

export function downloadText(filename: string, text: string) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export function portsFor(type: DeviceType): string[] {
    switch (type) {
        case "Battery":
            return ["12V_OUT"];
        case "MainBreaker":
            return ["IN", "OUT"];
        case "PDH":
            return ["MAIN_IN", "CAN", "CH0", "CH1", "CH2", "CH3", "CH4", "CH5"];
        case "roboRIO":
            return ["CAN", "ETH", "PWM0", "PWM1", "PWM2", "DIO0", "DIO1", "AI0", "AI1", "USB"];
        case "Radio":
            return ["ETH", "12V_IN"];
        case "MotorController":
            return ["12V_IN", "CAN", "PWM"];
        case "Sensor":
            return ["DIO", "ANALOG", "USB"];
        default:
            return ["PORT0"];
    }
}

export function deviceHasCanId(type: DeviceType): boolean {
    return type === "PDH" || type === "MotorController";
}

export function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

export function snap(n: number, grid: number) {
    return Math.round(n / grid) * grid;
}

export function ensurePlacements(p: Project): PlacedDevice[] {
    return Array.isArray(p.placements) ? p.placements : [];
}

export function getPlacement(p: Project, deviceId: string): PlacedDevice | undefined {
    return ensurePlacements(p).find((x) => x.deviceId === deviceId);
}

export function upsertPlacement(p: Project, placement: PlacedDevice): Project {
    const arr = ensurePlacements(p);
    const idx = arr.findIndex((x) => x.deviceId === placement.deviceId);
    const next = idx >= 0 ? arr.map((x, i) => (i === idx ? placement : x)) : [...arr, placement];
    return { ...p, placements: next };
}

export function removePlacement(p: Project, deviceId: string): Project {
    const arr = ensurePlacements(p).filter((x) => x.deviceId !== deviceId);
    return { ...p, placements: arr };
}

// Snap a center coordinate to the grid, then convert back to top-left.
export function snapTopLeftByCenter(topLeft: number, size: number, grid: number) {
    const center = topLeft + size / 2;
    const snappedCenter = snap(center, grid);
    return snappedCenter - size / 2;
}

// Given a desired center coordinate, snap it and return top-left.
export function snapCenterToTopLeft(center: number, size: number, grid: number) {
    const snappedCenter = snap(center, grid);
    return snappedCenter - size / 2;
}
