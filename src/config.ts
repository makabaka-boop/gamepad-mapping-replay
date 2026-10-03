import {
  MAX_GAMEPADS,
  type AxisInputConfig,
  type AxisDirection,
  type GamepadConfig,
  type NormalizedActionMapping,
  type NormalizedAxisInputConfig,
  type NormalizedChordMapping,
  type NormalizedGamepadConfig,
  type NormalizedInputRef,
  type InputRef
} from './types';

const DEFAULT_DEADZONE = 0.12;
const DEFAULT_RELEASE_HYSTERESIS = 0.05;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new TypeError(message);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function clampSignedUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

export function axisKey(device: number, index: number): string {
  return `${device}:${index}`;
}

export function inputKey(ref: NormalizedInputRef): string {
  if (ref.kind === 'button') {
    return `d${ref.device}.b${ref.index}`;
  }
  return `d${ref.device}.a${ref.index}.${ref.direction}`;
}

export function normalizeInput(ref: InputRef): NormalizedInputRef {
  assert(isPlainObject(ref), 'Every chord input must be an object.');
  const device = ref.device;
  const index = ref.index;
  assert(Number.isInteger(device) && device >= 0 && device < MAX_GAMEPADS,
    `Input device must be an integer from 0 to ${MAX_GAMEPADS - 1}.`);
  assert(Number.isInteger(index) && index >= 0, 'Input index must be a non-negative integer.');

  if (ref.kind === 'button') {
    return { device, kind: 'button', index, direction: null };
  }
  if (ref.kind === 'axis') {
    assert(ref.direction === 'positive' || ref.direction === 'negative',
      'Axis input requires direction "positive" or "negative".');
    return { device, kind: 'axis', index, direction: ref.direction };
  }
  throw new TypeError(`Unsupported input kind: ${String(ref.kind)}`);
}

export function chordInputKey(inputs: readonly NormalizedInputRef[]): string {
  return inputs.map(inputKey).sort().join('+');
}

function normalizeAxisConfig(value: AxisInputConfig | undefined): NormalizedAxisInputConfig {
  const source = value ?? {};
  const center = source.center ?? 0;
  const deadzone = source.deadzone ?? DEFAULT_DEADZONE;
  const releaseHysteresis = source.releaseHysteresis ?? DEFAULT_RELEASE_HYSTERESIS;

  assert(isFiniteNumber(center) && center >= -1 && center <= 1,
    'Axis center must be a finite number from -1 to 1.');
  assert(isFiniteNumber(deadzone) && deadzone >= 0 && deadzone <= 1,
    'Axis deadzone must be a finite number from 0 to 1.');
  assert(isFiniteNumber(releaseHysteresis) && releaseHysteresis >= 0 && releaseHysteresis <= 1,
    'Axis releaseHysteresis must be a finite number from 0 to 1.');
  assert(releaseHysteresis < deadzone,
    'Axis releaseHysteresis must be smaller than deadzone.');

  return { center, deadzone, releaseHysteresis: clamp01(releaseHysteresis) };
}

export function normalizeConfig(config: unknown): NormalizedGamepadConfig {
  assert(isPlainObject(config), 'Configuration must be an object.');
  const source = config as Partial<GamepadConfig>;
  assert(Array.isArray(source.actions), 'Configuration requires an actions array.');

  const actions: NormalizedActionMapping[] = [];
  const actionNames = new Set<string>();

  for (const action of source.actions) {
    assert(isPlainObject(action), 'Each action must be an object.');
    assert(typeof action.name === 'string' && action.name.length > 0,
      'Each action requires a non-empty name.');
    assert(!actionNames.has(action.name), `Duplicate action name: ${action.name}`);
    assert(Array.isArray(action.bindings) && action.bindings.length > 0,
      `Action ${action.name} requires at least one binding.`);

    const bindings: NormalizedChordMapping[] = [];
    const chordKeys = new Set<string>();

    for (const binding of action.bindings) {
      assert(isPlainObject(binding), `Each binding for ${action.name} must be an object.`);
      assert(Array.isArray(binding.inputs) && binding.inputs.length > 0,
        `Each binding for ${action.name} requires at least one input.`);
      const priority = binding.priority ?? 0;
      assert(Number.isInteger(priority),
        `Binding priority for ${action.name} must be an integer.`);

      const unique = new Map<string, NormalizedInputRef>();
      for (const input of binding.inputs) {
        const normalized = normalizeInput(input);
        unique.set(inputKey(normalized), normalized);
      }
      const inputs = [...unique.values()].sort((a, b) => inputKey(a).localeCompare(inputKey(b)));
      const key = chordInputKey(inputs);
      if (chordKeys.has(key)) {
        continue;
      }
      chordKeys.add(key);
      bindings.push({ inputs, priority });
    }

    assert(bindings.length > 0, `Action ${action.name} requires at least one unique binding.`);
    actionNames.add(action.name);
    actions.push({ name: action.name, bindings });
  }

  const rawAxes = source.axes ?? {};
  assert(isPlainObject(rawAxes), 'Axes configuration must be an object.');
  const axes: Record<string, NormalizedAxisInputConfig> = {};
  for (const [key, axisConfig] of Object.entries(rawAxes)) {
    const match = /^(\d+):(\d+)$/.exec(key);
    assert(match !== null, `Axis key must be "<device>:<index>", got ${key}.`);
    const device = Number(match[1]);
    const index = Number(match[2]);
    assert(device < MAX_GAMEPADS, `Axis key device must be less than ${MAX_GAMEPADS}.`);
    axes[axisKey(device, index)] = normalizeAxisConfig(axisConfig);
  }

  const normalized: NormalizedGamepadConfig = { actions, axes };
  return deepFreeze(normalized);
}

export function getAxisConfig(
  config: NormalizedGamepadConfig,
  device: number,
  index: number
): NormalizedAxisInputConfig {
  return config.axes[axisKey(device, index)] ?? normalizeAxisConfig(undefined);
}

export function signedAxisMagnitude(raw: number, center: number): number {
  return Math.abs(clampSignedUnit(raw - center));
}

export function axisDirectionActive(
  raw: number,
  center: number,
  direction: AxisDirection
): boolean {
  const centered = clampSignedUnit(raw - center);
  if (direction === 'positive') return centered > 0;
  return centered < 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return Object.freeze(value);
}
