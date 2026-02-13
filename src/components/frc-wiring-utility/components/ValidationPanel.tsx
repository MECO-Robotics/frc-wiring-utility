import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import type { Issue } from "../core/types";

export function ValidationPanel(props: { issues: Issue[]; onSelectDevice: (id: string) => void }) {
    const { issues, onSelectDevice } = props;

    return (
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
                                    if (iss.ref?.deviceId) onSelectDevice(iss.ref.deviceId);
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
    );
}

