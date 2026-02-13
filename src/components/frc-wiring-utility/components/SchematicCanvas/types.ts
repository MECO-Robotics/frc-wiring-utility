import type { PortType } from "../../palette";
import type { Pt as WirePt } from "../../../../helpers/wires";

export type WireDrag = {
    fromDeviceId: string;
    fromPortId: string;
    fromPortType: PortType;
    pointerSx: number;
    pointerSy: number;
};

export type WireSegDrag = {
    connId: string;
    pointerId: number;
    segIndex: number;
    axis: "H" | "V";
    startWorld: WirePt;
    baseRoute: WirePt[];
};

