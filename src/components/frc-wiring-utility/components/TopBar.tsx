import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Download, Upload, Moon, Sun, Crosshair, Cable } from "lucide-react";
import type { Project } from "../types";
import { safeInt } from "../helpers";

export function TopBar(props: {
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project>>;
    onNew: () => void;
    onImportClick: () => void;
    importRef: React.RefObject<HTMLInputElement | null>;
    onImportFile: (file: File) => Promise<void>;
    onExport: () => void;
    errorsCount: number;
    warnsCount: number;
    theme: "light" | "dark";
    toggleTheme: () => void;

    onCenterView: () => void;

    wireMode: boolean;
    onToggleWireMode: () => void;
}) {
    const {
        project,
        setProject,
        onNew,
        onImportClick,
        importRef,
        onImportFile,
        onExport,
        errorsCount,
        warnsCount,
        theme,
        toggleTheme,
        onCenterView,
        wireMode,
        onToggleWireMode,
    } = props;

    return (
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
                            onChange={(e) =>
                                setProject((p) => ({ ...p, meta: { ...p.meta, team: e.target.value } }))
                            }
                        />
                        <Label className="text-xs text-muted-foreground">Season</Label>
                        <Input
                            className="h-8 w-20"
                            value={String(project.meta.season ?? "")}
                            onChange={(e) =>
                                setProject((p) => ({ ...p, meta: { ...p.meta, season: safeInt(e.target.value) } }))
                            }
                        />
                        <Label className="text-xs text-muted-foreground">Rev</Label>
                        <Input
                            className="h-8 w-20"
                            value={project.meta.rev ?? ""}
                            onChange={(e) =>
                                setProject((p) => ({ ...p, meta: { ...p.meta, rev: e.target.value } }))
                            }
                        />
                    </div>

                    <Separator orientation="vertical" className="hidden h-8 md:block" />

                    <Button variant="secondary" className="h-8" onClick={onNew}>
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

                    <Button variant="secondary" className="h-8" onClick={toggleTheme} title="Toggle dark mode">
                        {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                        {theme === "dark" ? "Light" : "Dark"}
                    </Button>

                    <Button className="h-8" onClick={onExport}>
                        <Download className="mr-2 h-4 w-4" />
                        Export
                    </Button>

                    <Button variant="secondary" className="h-8" onClick={onCenterView} title="Center/fit (Space)">
                        <Crosshair className="mr-2 h-4 w-4" />
                        Center
                    </Button>

                    <Button
                        variant={wireMode ? "default" : "secondary"}
                        className="h-8"
                        onClick={onToggleWireMode}
                        title="Wire mode: drag from one port to a matching port"
                    >
                        <Cable className="mr-2 h-4 w-4" />
                        {wireMode ? "Wire: On" : "Wire: Off"}
                    </Button>

                    <div className="ml-1 flex items-center gap-2">
                        <Badge variant={errorsCount ? "destructive" : "secondary"}>{errorsCount} errors</Badge>
                        <Badge variant={warnsCount ? "default" : "secondary"}>{warnsCount} warnings</Badge>
                    </div>
                </div>
            </div>
        </header>
    );
}