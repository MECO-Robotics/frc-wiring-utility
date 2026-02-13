import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Project } from "../types";
import { safeInt } from "../helpers";

export function ProjectMetaFields(props: {
    project: Project;
    setProject: React.Dispatch<React.SetStateAction<Project>>;
}) {
    const { project, setProject } = props;

    return (
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
    );
}

