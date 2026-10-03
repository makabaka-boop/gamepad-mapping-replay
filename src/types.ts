export const MAX_GAMEPADS = 4;

export type AxisDirection = 'positive' | 'negative';

export interface GamepadButtonLike {
  pressed: boolean;
  touched?: boolean;
  value?: number;
}

export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly GamepadButtonLike[];
}

export interface GamepadProvider {
  getGamepads(): readonly (GamepadLike | null)[];
}

export interface Unsubscribe {
  (): void;
}

export interface GamepadEvents {
  onGamepadConnected?(listener: (gamepad: GamepadLike) => void): Unsubscribe;
  onGamepadDisconnected?(listener: (gamepad: GamepadLike) => void): Unsubscribe;
  onWindowBlur?(listener: () => void): Unsubscribe;
  onWindowFocus?(listener: () => void): Unsubscribe;
}

export type AxisKind = 'axis';
export type ButtonKind = 'button';

export interface InputRef {
  device: number;
  kind: AxisKind | ButtonKind;
  index: number;
  direction?: AxisDirection;
}

export interface NormalizedInputRef {
  device: number;
  kind: 'axis' | 'button';
  index: number;
  direction: AxisDirection | null;
}

export interface ChordMapping {
  inputs: InputRef[];
  priority?: number;
}

export interface NormalizedChordMapping {
  inputs: NormalizedInputRef[];
  priority: number;
}

export interface ActionMapping {
  name: string;
  bindings: ChordMapping[];
}

export interface NormalizedActionMapping {
  name: string;
  bindings: NormalizedChordMapping[];
}

export interface AxisInputConfig {
  center?: number;
  deadzone?: number;
  releaseHysteresis?: number;
}

export interface NormalizedAxisInputConfig {
  center: number;
  deadzone: number;
  releaseHysteresis: number;
}

export type AxisConfigMap = Record<string, AxisInputConfig>;

export interface GamepadConfig {
  actions: ActionMapping[];
  axes?: AxisConfigMap;
}

export interface NormalizedGamepadConfig {
  actions: NormalizedActionMapping[];
  axes: Record<string, NormalizedAxisInputConfig>;
}

export type LogReason = 'recording' | 'config' | 'initial';

export interface RuntimeGenerationEntry {
  sequence: number;
  type: 'generation';
  generation: number;
  reason: LogReason;
  timestamp: number;
  config: NormalizedGamepadConfig;
}

export interface RuntimeActionEntry {
  sequence: number;
  type: 'action';
  generation: number;
  timestamp: number;
  action: string;
  phase: 'down' | 'up';
}

export type RuntimeLogEntry = RuntimeGenerationEntry | RuntimeActionEntry;

export interface NormalizedGenerationEntry {
  type: 'generation';
  generation: number;
  reason: LogReason;
  t: number;
  config: NormalizedGamepadConfig;
}

export interface NormalizedActionEntry {
  type: 'action';
  generation: number;
  t: number;
  action: string;
  phase: 'down' | 'up';
}

export type NormalizedLogEntry = NormalizedGenerationEntry | NormalizedActionEntry;

export interface NormalizedEventLog {
  version: 1;
  entries: NormalizedLogEntry[];
}

export interface AxisCalibrationState {
  session: number;
  axisKey: string;
  samples: number;
  min: number;
  max: number;
  center: number | null;
  calibrating: boolean;
}
