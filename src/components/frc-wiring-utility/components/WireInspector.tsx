import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Minus, Plus } from "lucide-react";
import type { Project } from "../types";

type Connection = Project["connections"][number];

export function WireInspector(props: {
    connection: Connection;
    onAddWireNode: (connectionId: string) => void;
    onRemoveWireNode: (connectionId: string) => void;
    onClearWireNodes?: (connectionId: string) => void;
}) {
    const { connection, onAddWireNode, onRemoveWireNode, onClearWireNodes } = props;
    const routeCount = Array.isArray(connection.route) ? connection.route.length : 0;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">Wire</div>
                    <div className="text-xs text-muted-foreground">ID: {connection.id}</div>
                </div>

                <Badge variant="outline">Nodes: {routeCount}</Badge>
            </div>

            <div className="space-y-2 rounded-xl border p-3 text-xs">
                <div className="text-muted-foreground">From</div>
                <div className="font-mono text-[11px]">
                    {connection.from.deviceId} :: {connection.from.port}
                </div>

                <div className="pt-2 text-muted-foreground">To</div>
                <div className="font-mono text-[11px]">
                    {connection.to.deviceId} :: {connection.to.port}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <Button className="h-9" onClick={() => onAddWireNode(connection.id)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add node
                </Button>

                <Button
                    className="h-9"
                    variant="secondary"
                    disabled={routeCount === 0}
                    onClick={() => onRemoveWireNode(connection.id)}
                >
                    <Minus className="mr-2 h-4 w-4" />
                    Remove node
                </Button>
            </div>

            {onClearWireNodes ? (
                <Button
                    className="h-9"
                    variant="destructive"
                    disabled={routeCount === 0}
                    onClick={() => onClearWireNodes(connection.id)}
                >
                    Clear nodes
                </Button>
            ) : null}

            <Separator />

            <div className="text-xs text-muted-foreground">
                Nodes are stored in <code>connection.route</code> as world points.
            </div>
        </div>
    );
}

