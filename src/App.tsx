import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Download, Upload, Plus, Trash2, MousePointer2, Moon, Sun } from "lucide-react";


/**
 * Refactor goals:
 * - Top utility bar
 * - Schematic canvas (grid background) is the main workspace
 * - Right panel palette for drag/drop + inspector
 * - Positions persisted in project JSON
 */

// ---------- Types ----------
type DeviceType = "Battery" | "MainBreaker" | "PDH" | "roboRIO" | "Radio" | "MotorController" | "Sensor" | "Other";
type NetKind = "POWER_12V" | "CAN" | "PWM" | "DIO" | "ANALOG" | "ETH" | "USB";

type Device = {
  id: string;
  type: DeviceType;
  name: string;
  subsystem?: string;
  attrs?: { canId?: number };
};

type Net = {
  id: string;
  kind: NetKind;
  name: string;
};

type Endpoint = { deviceId: string; port: string };
type Connection = {
  id: string;
  netId: string;
  from: Endpoint;
  to: Endpoint;
  attrs?: { note?: string; breakerA?: number; wireAwg?: number };
};

type PlacedDevice = {
  deviceId: string;
  x: number; // canvas coords
  y: number;
};

type Project = {
  meta: { team?: string; season?: number; rev?: string };
  devices: Device[];
  nets: Net[];
  connections: Connection[];
  placements?: PlacedDevice[]; // NEW
};

type Issue = {
  id: string;
  severity: "error" | "warn";
  title: string;
  detail?: string;
  ref?: { deviceId?: string; connId?: string };
};

// ---------- Helpers ----------
const uid = (p: string) => `${p}_${Math.random().toString(16).slice(2, 10)}`;

const safeInt = (s: string) => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
};

function downloadText(filename: string, text: string) {
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

function portsFor(type: DeviceType): string[] {
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

function deviceHasCanId(type: DeviceType): boolean {
  return type === "PDH" || type === "MotorController";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function snap(n: number, grid: number) {
  return Math.round(n / grid) * grid;
}

function ensurePlacements(p: Project): PlacedDevice[] {
  return Array.isArray(p.placements) ? p.placements : [];
}

function getPlacement(p: Project, deviceId: string): PlacedDevice | undefined {
  return ensurePlacements(p).find((x) => x.deviceId === deviceId);
}

function upsertPlacement(p: Project, placement: PlacedDevice): Project {
  const arr = ensurePlacements(p);
  const idx = arr.findIndex((x) => x.deviceId === placement.deviceId);
  const next = idx >= 0 ? arr.map((x, i) => (i === idx ? placement : x)) : [...arr, placement];
  return { ...p, placements: next };
}

function removePlacement(p: Project, deviceId: string): Project {
  const arr = ensurePlacements(p).filter((x) => x.deviceId !== deviceId);
  return { ...p, placements: arr };
}

// ---------- Validation (same as before) ----------
function validate(p: Project): Issue[] {
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

// ---------- Defaults ----------
const DEFAULT: Project = {
  meta: { team: "8324", season: 2026, rev: "v0.2" },
  devices: [
    { id: "bat", type: "Battery", name: "Battery" },
    { id: "mb", type: "MainBreaker", name: "Main Breaker" },
    { id: "pdh", type: "PDH", name: "PDH", attrs: { canId: 1 } },
    { id: "rio", type: "roboRIO", name: "roboRIO" },
    { id: "radio", type: "Radio", name: "Radio" },
    { id: "mc1", type: "MotorController", name: "Shooter MC", attrs: { canId: 12 }, subsystem: "Shooter" },
  ],
  nets: [
    { id: "pwr12", kind: "POWER_12V", name: "12V Main" },
    { id: "can0", kind: "CAN", name: "CAN Bus" },
    { id: "eth0", kind: "ETH", name: "Ethernet" },
  ],
  connections: [
    {
      id: "c1",
      netId: "pwr12",
      from: { deviceId: "bat", port: "12V_OUT" },
      to: { deviceId: "mb", port: "IN" },
      attrs: { note: "Battery leads", breakerA: 120, wireAwg: 6 },
    },
    {
      id: "c2",
      netId: "pwr12",
      from: { deviceId: "mb", port: "OUT" },
      to: { deviceId: "pdh", port: "MAIN_IN" },
      attrs: { note: "Main feed", breakerA: 120, wireAwg: 6 },
    },
    {
      id: "c3",
      netId: "pwr12",
      from: { deviceId: "pdh", port: "CH0" },
      to: { deviceId: "mc1", port: "12V_IN" },
      attrs: { note: "Shooter", breakerA: 40, wireAwg: 12 },
    },
    { id: "c4", netId: "can0", from: { deviceId: "rio", port: "CAN" }, to: { deviceId: "pdh", port: "CAN" }, attrs: { note: "CAN backbone" } },
    { id: "c5", netId: "can0", from: { deviceId: "pdh", port: "CAN" }, to: { deviceId: "mc1", port: "CAN" }, attrs: { note: "CAN chain" } },
    { id: "c6", netId: "eth0", from: { deviceId: "rio", port: "ETH" }, to: { deviceId: "radio", port: "ETH" }, attrs: { note: "RIO ↔ Radio" } },
  ],
  placements: [
    { deviceId: "bat", x: 80, y: 120 },
    { deviceId: "mb", x: 280, y: 120 },
    { deviceId: "pdh", x: 520, y: 120 },
    { deviceId: "rio", x: 520, y: 320 },
    { deviceId: "radio", x: 760, y: 320 },
    { deviceId: "mc1", x: 760, y: 120 },
  ],
};

// ---------- Palette ----------
const PALETTE: { type: DeviceType; label: string; hint: string }[] = [
  { type: "Battery", label: "Battery", hint: "12V source" },
  { type: "MainBreaker", label: "Main Breaker", hint: "120A main" },
  { type: "PDH", label: "PDH", hint: "Power distribution + CAN" },
  { type: "roboRIO", label: "roboRIO", hint: "Controller" },
  { type: "Radio", label: "Radio", hint: "Wi-Fi bridge" },
  { type: "MotorController", label: "Motor Controller", hint: "Talon/Spark/etc" },
  { type: "Sensor", label: "Sensor", hint: "DIO/Analog/USB" },
  { type: "Other", label: "Other", hint: "Generic block" },
];

// ---------- UI ----------
export default function FRCWiringUtilityApp() {
  const GRID = 20;
  const NODE_W = 170;
  const NODE_H = 72;

  const [project, setProject] = useState<Project>(() => structuredClone(DEFAULT));
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(project.devices[0]?.id ?? null);

  // canvas drag state
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    deviceId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const deviceById = useMemo(() => new Map(project.devices.map((d) => [d.id, d] as const)), [project.devices]);
  const issues = useMemo(() => validate(project), [project]);
  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");

  const selectedDevice = selectedDeviceId ? deviceById.get(selectedDeviceId) : undefined;

  // Import/export
  const importRef = useRef<HTMLInputElement | null>(null);
  const onImportClick = () => importRef.current?.click();

  // --- Dark mode toggle (class-based, shadcn-compatible) ---
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = window.localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") return saved;
    // default: follow system
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  });

  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    window.localStorage.setItem("theme", theme);
  }, [theme]);


  const normalizeImported = (raw: any): Project | null => {
    if (!raw || !Array.isArray(raw.devices) || !Array.isArray(raw.nets) || !Array.isArray(raw.connections)) return null;
    const placements = Array.isArray(raw.placements) ? raw.placements : [];
    // Basic guard: placement deviceIds must exist
    const devIds = new Set(raw.devices.map((d: any) => d.id));
    const cleanedPlacements = placements
      .filter((pl: any) => pl && typeof pl.deviceId === "string" && devIds.has(pl.deviceId))
      .map((pl: any) => ({ deviceId: pl.deviceId, x: Number(pl.x) || 0, y: Number(pl.y) || 0 }));
    return { ...raw, placements: cleanedPlacements };
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const norm = normalizeImported(parsed);
    if (!norm) {
      alert("Invalid project file");
      return;
    }
    setProject(norm);
    setSelectedDeviceId(norm.devices?.[0]?.id ?? null);
  };

  const exportJson = () => {
    const fn = `frc_wiring_${project.meta.team || "team"}_${project.meta.season || "season"}.json`;
    downloadText(fn, JSON.stringify(project, null, 2));
  };

  const newProject = () => {
    const next = structuredClone(DEFAULT) as Project;
    setProject(next);
    setSelectedDeviceId(next.devices[0]?.id ?? null);
  };

  // CRUD: devices (now also placement-aware)
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
      // snap & clamp to a soft bound (actual clamp happens on drop too)
      return upsertPlacement(withDev, { deviceId: id, x: snap(x, GRID), y: snap(y, GRID) });
    });

    setSelectedDeviceId(id);
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

  // Canvas: drop from palette
  const onPaletteDragStart = (e: React.DragEvent, type: DeviceType) => {
    e.dataTransfer.setData("application/x-frc-device-type", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  const canvasPointFromEvent = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const onCanvasDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-frc-device-type")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const onCanvasDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData("application/x-frc-device-type") as DeviceType;
    if (!type) return;

    e.preventDefault();
    const pt = canvasPointFromEvent(e.clientX, e.clientY);

    const el = canvasRef.current;
    const w = el?.clientWidth ?? 1200;
    const h = el?.clientHeight ?? 800;

    // Place centered-ish at cursor with grid snap
    const x = clamp(snap(pt.x - NODE_W / 2, GRID), 0, Math.max(0, w - NODE_W));
    const y = clamp(snap(pt.y - NODE_H / 2, GRID), 0, Math.max(0, h - NODE_H));
    addDeviceAt(type, x, y);
  };

  // Canvas: dragging existing nodes
  const onNodePointerDown = (e: React.PointerEvent, deviceId: string) => {
    const pl = getPlacement(project, deviceId);
    if (!pl) return;

    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    dragStateRef.current = {
      deviceId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pl.x,
      originY: pl.y,
    };

    setSelectedDeviceId(deviceId);
  };

  const onNodePointerMove = (e: React.PointerEvent) => {
    const st = dragStateRef.current;
    if (!st) return;

    const el = canvasRef.current;
    const w = el?.clientWidth ?? 1200;
    const h = el?.clientHeight ?? 800;

    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;

    const x = clamp(snap(st.originX + dx, GRID), 0, Math.max(0, w - NODE_W));
    const y = clamp(snap(st.originY + dy, GRID), 0, Math.max(0, h - NODE_H));

    setProject((p) => upsertPlacement(p, { deviceId: st.deviceId, x, y }));
  };

  const onNodePointerUp = () => {
    dragStateRef.current = null;
  };

  // Inspector edits
  const updateSelectedDevice = (patch: Partial<Device>) => {
    if (!selectedDevice) return;
    setProject((p) => ({
      ...p,
      devices: p.devices.map((d) => (d.id === selectedDevice.id ? { ...d, ...patch } : d)),
    }));
  };

  const updateSelectedCanId = (raw: string) => {
    if (!selectedDevice) return;
    const v = safeInt(raw);
    setProject((p) => ({
      ...p,
      devices: p.devices.map((d) =>
        d.id === selectedDevice.id ? { ...d, attrs: { ...(d.attrs ?? {}), canId: v } } : d
      ),
    }));
  };

  // Utility: quick add (button)
  const quickAdd = (type: DeviceType) => {
    const el = canvasRef.current;
    const w = el?.clientWidth ?? 1200;
    const h = el?.clientHeight ?? 800;
    addDeviceAt(type, snap(w / 2 - NODE_W / 2, GRID), snap(h / 2 - NODE_H / 2, GRID));
  };

  return (
    <div className="min-h-screen w-full bg-background">
      {/* Top utility bar */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 p-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight">frc-wiring-utility</h1>
              <Badge variant="secondary" className="hidden md:inline-flex">
                schematic-first
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Drag components from the right panel onto the grid. Click a component to edit.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Team</Label>
              <Input
                className="h-8 w-20"
                value={project.meta.team ?? ""}
                onChange={(e) => setProject((p) => ({ ...p, meta: { ...p.meta, team: e.target.value } }))}
              />
              <Label className="text-xs text-muted-foreground">Season</Label>
              <Input
                className="h-8 w-20"
                value={String(project.meta.season ?? "")}
                onChange={(e) => setProject((p) => ({ ...p, meta: { ...p.meta, season: safeInt(e.target.value) } }))}
              />
              <Label className="text-xs text-muted-foreground">Rev</Label>
              <Input
                className="h-8 w-20"
                value={project.meta.rev ?? ""}
                onChange={(e) => setProject((p) => ({ ...p, meta: { ...p.meta, rev: e.target.value } }))}
              />
            </div>

            <Separator orientation="vertical" className="hidden h-8 md:block" />

            <Button variant="secondary" className="h-8" onClick={newProject}>
              New
            </Button>

            <Button variant="secondary" className="h-8" onClick={onImportClick}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
                e.currentTarget.value = "";
              }}
            />

            <Button
              variant="secondary"
              className="h-8"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              title="Toggle dark mode"
            >
              {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
              {theme === "dark" ? "Light" : "Dark"}
            </Button>


            <Button className="h-8" onClick={exportJson}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>

            <div className="ml-1 flex items-center gap-2">
              <Badge variant={errors.length ? "destructive" : "secondary"}>{errors.length} errors</Badge>
              <Badge variant={warns.length ? "default" : "secondary"}>{warns.length} warnings</Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main layout: Schematic + Right panel */}
      <div className="mx-auto grid max-w-7xl gap-3 p-3 grid-cols-[1fr_360px]">

        {/* Schematic canvas */}
        <Card className="rounded-2xl">
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

          <CardContent>
            <div
              ref={canvasRef}
              onPointerDown={() => setSelectedDeviceId(null)}
              onClick={() => setSelectedDeviceId(null)}
              onDragOver={onCanvasDragOver}
              onDrop={onCanvasDrop}
              className="
                relative h-[72vh] min-h-[520px] w-full overflow-hidden rounded-2xl border bg-background
                [background-size:20px_20px]
                [background-image:linear-gradient(to_right,rgba(0,0,0,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.10)_1px,transparent_1px)]
                dark:[background-image:linear-gradient(to_right,rgba(255,255,255,0.10)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.10)_1px,transparent_1px)]
              "
            >
              {/* Hint overlay when empty */}
              {project.devices.length === 0 ? (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="rounded-2xl border bg-background/80 p-4 text-center text-sm text-muted-foreground">
                    Drag a device from the right panel onto the grid.
                  </div>
                </div>
              ) : null}

              {/* Nodes */}
              {project.devices.map((d) => {
                const pl = getPlacement(project, d.id);
                if (!pl) return null;
                const selected = selectedDeviceId === d.id;
                return (
                  <div
                    key={d.id}
                    className={
                      "absolute select-none rounded-2xl border bg-background shadow-sm transition " +
                      (selected ? "ring-2 ring-foreground/40" : "hover:shadow")
                    }
                    style={{
                      width: NODE_W,
                      height: NODE_H,
                      left: pl.x,
                      top: pl.y,
                      cursor: "grab",
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onNodePointerDown(e, d.id);
                    }}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={onNodePointerUp}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDeviceId(d.id);
                    }}
                  >
                    <div className="flex h-full flex-col justify-between p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{d.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {d.type}
                            {d.subsystem ? ` • ${d.subsystem}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="outline" className="text-[10px]">
                            <MousePointer2 className="mr-1 h-3 w-3" />
                            drag
                          </Badge>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          {deviceHasCanId(d.type) ? (
                            <Badge variant="outline" className="text-[10px]">
                              CAN {d.attrs?.canId ?? "—"}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              no CAN
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          ({pl.x}, {pl.y})
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div>
                Grid: {GRID}px • Drag from palette to create • Drag nodes to move • Snap enabled
              </div>
              <div>
                Next logical step: render connections as SVG paths using stored endpoints (ports) and node positions.
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right panel: palette + inspector + validation */}
        <div className="space-y-3">
          {/* Palette */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Palette</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {PALETTE.map((p) => (
                  <div
                    key={p.type}
                    draggable
                    onDragStart={(e) => onPaletteDragStart(e, p.type)}
                    className="rounded-xl border bg-background p-2 text-left hover:bg-muted/40"
                    title="Drag onto schematic"
                  >
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.hint}</div>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">Quick add (center)</div>
                <Select onValueChange={(v) => quickAdd(v as DeviceType)}>
                  <SelectTrigger className="h-9 w-[180px]">
                    <SelectValue placeholder="Add device" />
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
            </CardContent>
          </Card>

          {/* Inspector */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Inspector</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!selectedDevice ? (
                <div className="rounded-xl border p-3 text-sm text-muted-foreground">
                  Select a device on the schematic to edit.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{selectedDevice.name}</div>
                      <div className="text-xs text-muted-foreground">ID: {selectedDevice.id}</div>
                    </div>
                    <Button variant="destructive" className="h-8" onClick={() => deleteDevice(selectedDevice.id)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>

                  <div className="grid gap-2">
                    <Label className="text-xs">Name</Label>
                    <Input value={selectedDevice.name} onChange={(e) => updateSelectedDevice({ name: e.target.value })} />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Type</Label>
                      <Select
                        value={selectedDevice.type}
                        onValueChange={(v) => {
                          const newType = v as DeviceType;
                          const hasCan = deviceHasCanId(newType);
                          setProject((p) => ({
                            ...p,
                            devices: p.devices.map((d) =>
                              d.id === selectedDevice.id
                                ? { ...d, type: newType, attrs: { ...(d.attrs ?? {}), canId: hasCan ? d.attrs?.canId : undefined } }
                                : d
                            ),
                          }));
                        }}
                      >
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
                        onChange={(e) => updateSelectedDevice({ subsystem: e.target.value })}
                        placeholder="drivetrain"
                      />
                    </div>
                  </div>

                  {deviceHasCanId(selectedDevice.type) ? (
                    <div className="grid gap-2">
                      <Label className="text-xs">CAN ID</Label>
                      <Input
                        value={selectedDevice.attrs?.canId === undefined ? "" : String(selectedDevice.attrs?.canId)}
                        onChange={(e) => updateSelectedCanId(e.target.value)}
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
                    Position is stored in <code>project.placements</code>. If you later add a real connection renderer,
                    you’ll compute endpoints from node positions + port anchors.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Validation list */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Validation</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[240px] rounded-xl border">
                <div className="p-2 space-y-2">
                  {issues.length === 0 ? <div className="rounded-xl border p-3 text-sm">No issues found.</div> : null}

                  {issues.map((iss) => (
                    <button
                      key={iss.id}
                      onClick={() => {
                        if (iss.ref?.deviceId) setSelectedDeviceId(iss.ref.deviceId);
                      }}
                      className="w-full rounded-xl border p-2 text-left hover:bg-muted/50"
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5">
                          <AlertTriangle className={"h-4 w-4 " + (iss.severity === "error" ? "text-destructive" : "text-foreground")} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{iss.title}</div>
                            <Badge variant={iss.severity === "error" ? "destructive" : "outline"}>{iss.severity}</Badge>
                          </div>
                          {iss.detail ? <div className="text-xs text-muted-foreground">{iss.detail}</div> : null}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Import/export safety note */}
          <Card className="rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Data</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-2">
              <div>
                Export includes devices/nets/connections plus <code>placements</code>.
              </div>
              <div>
                If you import older JSON without <code>placements</code>, devices will show as “not placed” warnings until you drop/move them.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
