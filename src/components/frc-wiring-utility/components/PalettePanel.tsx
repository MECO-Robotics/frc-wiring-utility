import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DeviceType } from "../core/palette";
import { PALETTE } from "../core/palette";

export function PalettePanel(props: {
    onPaletteDragStart: (e: React.DragEvent, type: DeviceType) => void;
    onQuickAdd: (type: DeviceType) => void;
}) {
    const { onPaletteDragStart, onQuickAdd } = props;

    return (
        <Card className="rounded-2xl">
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Palette</CardTitle>
            </CardHeader>

            <p className="text-xs text-muted-foreground">
                Drag components from the right panel onto the grid. Click a component to edit.
            </p>

            <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                    {PALETTE.map((p) => (
                        <div
                            key={p.id}
                            draggable
                            onDragStart={(e) => onPaletteDragStart(e, p.id)}
                            className="rounded-xl border bg-card hover:bg-accent/40 transition-colors p-2"
                            title="Drag onto schematic"
                        >
                            <div className="flex items-center justify-center rounded-lg bg-background/40"
                                style={{ width: 160, height: 90 }}>
                                <img
                                    src={p.svgUrl}
                                    alt={p.name}
                                    className="max-w-full max-h-full"
                                    draggable={false}
                                />
                            </div>

                            <div className="mt-2 text-xs font-medium leading-tight">{p.name}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                                {p.category}
                            </div>
                        </div>
                    ))}
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-muted-foreground">Quick add (center)</div>
                    <Select onValueChange={(v) => onQuickAdd(v as DeviceType)}>
                        <SelectTrigger className="h-9 w-[180px]">
                            <SelectValue placeholder="Add device" />
                        </SelectTrigger>
                        <SelectContent>
                            {PALETTE.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
}

