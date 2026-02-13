import { useRef } from "react";
import type { Project } from "../core/types";

export function useProjectIO(opts: {
    setProject: (p: Project) => void;
    setSelectedDeviceId: (id: string | null) => void;
}) {
    const importRef = useRef<HTMLInputElement | null>(null);

    const normalizeImported = (raw: any): Project | null => {
        if (!raw || !Array.isArray(raw.devices) || !Array.isArray(raw.nets) || !Array.isArray(raw.connections)) return null;
        const placements = Array.isArray(raw.placements) ? raw.placements : [];
        const devIds = new Set(raw.devices.map((d: any) => d.id));
        const cleanedPlacements = placements
            .filter((pl: any) => pl && typeof pl.deviceId === "string" && devIds.has(pl.deviceId))
            .map((pl: any) => ({ deviceId: pl.deviceId, x: Number(pl.x) || 0, y: Number(pl.y) || 0 }));
        return { ...raw, placements: cleanedPlacements };
    };

    const onImportClick = () => importRef.current?.click();

    const onImportFile = async (file: File) => {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const norm = normalizeImported(parsed);
        if (!norm) {
            alert("Invalid project file");
            return;
        }
        opts.setProject(norm);
        opts.setSelectedDeviceId(norm.devices?.[0]?.id ?? null);
    };

    return { importRef, onImportClick, onImportFile };
}

