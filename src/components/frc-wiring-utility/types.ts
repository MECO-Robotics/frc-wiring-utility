export type DeviceType =
    | "Battery"
    | "MainBreaker"
    | "PDH"
    | "roboRIO"
    | "Radio"
    | "MotorController"
    | "Sensor"
    | "Other";

export type NetKind = "POWER_12V" | "CAN" | "PWM" | "DIO" | "ANALOG" | "ETH" | "USB";

export type Device = {
    id: string;
    type: DeviceType;
    name: string;
    subsystem?: string;
    attrs?: { canId?: number };
};

export type Net = {
    id: string;
    kind: NetKind;
    name: string;
};

export type Endpoint = { deviceId: string; port: string };

export type RoutePoint = { x: number; y: number };

export type Connection = {
    id: string;
    netId: string;
    from: Endpoint;
    to: Endpoint;
    attrs?: { note?: string; breakerA?: number; wireAwg?: number };
    route?: RoutePoint[]; // <= bend points in WORLD coords, excluding endpoints
};

export type PlacedDevice = {
    deviceId: string;
    x: number;
    y: number;
};

export type Project = {
    meta: { team?: string; season?: number; rev?: string };
    devices: Device[];
    nets: Net[];
    connections: Connection[];
    placements?: PlacedDevice[];
};

export type Issue = {
    id: string;
    severity: "error" | "warn";
    title: string;
    detail?: string;
    ref?: { deviceId?: string; connId?: string };
};
