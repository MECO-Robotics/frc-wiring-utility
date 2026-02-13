import React from "react";
import { downloadText } from "../core/helpers";
import { useTheme } from "../hooks/useTheme";
import { useProjectIO } from "../hooks/useProjectIO";
import { useProjectState } from "../hooks/useProjectState";
import { useWireActions } from "../hooks/useWireActions";
import { TopBar } from "../components/TopBar";
import { AppLayout } from "../components/AppLayout";

export default function FRCWiringUtilityApp() {
    const GRID = 20;
    const NODE_W = 170;
    const NODE_H = 72;

    const {
        project,
        setProject,
        selectedDeviceId,
        setSelectedDeviceId,
        selectedConnId,
        setSelectedConnId,
        wireMode,
        setWireMode,
        centerFnRef,
        wireActionsRef,
        issues,
        errorsCount,
        warnsCount,
        newProject,
        addDeviceAt,
        quickAdd,
        movePlacement,
        deleteDevice,
        patchDevice,
        setDeviceType,
        setCanId,
        onPaletteDragStart,
    } = useProjectState(GRID, NODE_W, NODE_H);

    const { theme, setTheme } = useTheme();
    const { addWire, updateWireRoute } = useWireActions(setProject);

    const { importRef, onImportClick, onImportFile } = useProjectIO({
        setProject,
        setSelectedDeviceId,
    });

    const exportJson = () => {
        const fn = `frc_wiring_${project.meta.team || "team"}_${project.meta.season || "season"}.json`;
        downloadText(fn, JSON.stringify(project, null, 2));
    };

    return (
        <div className="grid h-screen w-full grid-rows-[auto_1fr] overflow-hidden bg-background">
            <TopBar
                project={project}
                setProject={setProject}
                onNew={newProject}
                onImportClick={onImportClick}
                importRef={importRef}
                onImportFile={onImportFile}
                onExport={exportJson}
                errorsCount={errorsCount}
                warnsCount={warnsCount}
                theme={theme}
                onCenterView={() => centerFnRef.current?.()}
                toggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                wireMode={wireMode}
                onToggleWireMode={() => setWireMode((w) => !w)}
            />

            <AppLayout
                project={project}
                selectedDeviceId={selectedDeviceId}
                setSelectedDeviceId={setSelectedDeviceId}
                selectedConnId={selectedConnId}
                setSelectedConnId={setSelectedConnId}
                wireMode={wireMode}
                setWireActions={(actions) => {
                    wireActionsRef.current = actions;
                }}
                registerCenterFn={(fn) => {
                    centerFnRef.current = fn;
                }}
                GRID={GRID}
                NODE_W={NODE_W}
                NODE_H={NODE_H}
                onDropCreate={addDeviceAt}
                onMovePlacement={movePlacement}
                onCreateWire={addWire}
                onUpdateWireRoute={updateWireRoute}
                onPaletteDragStart={onPaletteDragStart}
                onQuickAdd={quickAdd}
                onDeleteDevice={deleteDevice}
                onPatchDevice={patchDevice}
                onSetDeviceType={setDeviceType}
                onSetCanId={setCanId}
                onAddWireNode={(id) => wireActionsRef.current?.addBend(id)}
                onRemoveWireNode={(id) => wireActionsRef.current?.removeBend(id)}
                onClearWireNodes={(id) => wireActionsRef.current?.resetRoute(id)}
                issues={issues}
                onSelectIssueDevice={setSelectedDeviceId}
            />
        </div>
    );
}

