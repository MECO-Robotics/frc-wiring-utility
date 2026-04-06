import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DataPanel() {
    return (
        <Card className="rounded-2xl">
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div>
                    Export includes devices, nets, connections, and <code>placements</code>.
                </div>
                <div>
                    If you import older JSON without <code>placements</code>, devices will show "not placed"
                    warnings until you drop or move them.
                </div>
            </CardContent>
        </Card>
    );
}
