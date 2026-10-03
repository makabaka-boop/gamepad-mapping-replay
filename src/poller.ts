import { AxisCenterCalibrator } from './calibration';
import {
  axisDirectionActive,
  axisKey,
  getAxisConfig,
  inputKey,
  normalizeConfig
} from './config';
import {
  MAX_GAMEPADS,
  type GamepadConfig,
  type GamepadEvents,
  type GamepadLike,
  type GamepadProvider,
  type NormalizedGamepadConfig,
  type NormalizedInputRef,
  type RuntimeActionEntry,
  type RuntimeGenerationEntry,
  type RuntimeLogEntry,
  type Unsubscribe
} from './types';

interface DeviceSession {
  id: number;
  device: number;
  gamepadId: string;
  gamepadIndex: number;
  connectedAt: number;
  keys: Set<string>;
  axisActive: Map<string, boolean>;
  calibrators: Map<string, AxisCenterCalibrator>;
}

interface SelectedAction {
  keys: ReadonlySet<string>;
  bindingIndex: number;
}

interface Candidate extends SelectedAction {
  action: string;
  actionIndex: number;
  priority: number;
  length: number;
  bindingIndex: number;
}

export interface GamepadActionPollerOptions {
  config: GamepadConfig | NormalizedGamepadConfig;
  provider: GamepadProvider & Partial<GamepadEvents>;
  now?: () => number;
}

export class GamepadActionPoller {
  private config: NormalizedGamepadConfig;
  private readonly provider: GamepadProvider & Partial<GamepadEvents>;
  private readonly now: () => number;
  private readonly sessions = new Map<number, DeviceSession>();
  private readonly down = new Set<string>();
  private selected = new Map<string, SelectedAction>();
  private readonly forcedReleases = new Set<string>();
  private readonly pendingConnects = new Map<number, GamepadLike>();
  private readonly pendingDisconnects = new Set<number>();
  private readonly subscriptions: Unsubscribe[] = [];
  private generation = 0;
  private sequence = 0;
  private sessionCounter = 0;
  private generationReason: RuntimeGenerationEntry['reason'] = 'initial';
  private suspended = false;

  constructor(options: GamepadActionPollerOptions) {
    this.config = normalizeConfig(options.config);
    this.provider = options.provider;
    this.now = options.now ?? (() => Date.now());
    this.subscribe();
  }

  getConfig(): NormalizedGamepadConfig {
    return this.config;
  }

  getGeneration(): number {
    return this.generation;
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  getActiveActions(): string[] {
    return this.config.actions
      .map(action => action.name)
      .filter(name => this.selected.has(name));
  }

  getDeviceSessionId(device: number): number | null {
    const session = this.sessions.get(device);
    return session?.id ?? null;
  }

  setConfig(config: GamepadConfig | NormalizedGamepadConfig): RuntimeLogEntry[] {
    const timestamp = this.now();
    const normalized = normalizeConfig(config);
    const releases = this.releaseAll(timestamp);
    this.config = normalized;
    this.beginGeneration('config', timestamp);
    return [...releases, this.generationEntry(timestamp)];
  }

  beginLogGeneration(reason: 'recording' | 'initial' = 'recording'): RuntimeGenerationEntry {
    const timestamp = this.now();
    this.resetRuntimeInputState();
    this.beginGeneration(reason, timestamp);
    return this.generationEntry(timestamp);
  }

  poll(): RuntimeLogEntry[] {
    const timestamp = this.now();

    if (this.suspended) {
      this.reconcileSuspendedSessions();
      if (this.selected.size === 0) return [];
      const releases = this.releaseAll(timestamp);
      this.resetRuntimeInputState();
      return releases;
    }

    const pads = this.provider.getGamepads();
    this.reconcileSessions(pads);
    this.readPads(pads);
    const next = this.resolveActions();
    return this.diffSelection(next, timestamp);
  }

  startAxisCalibration(device: number, axis: number): void {
    const session = this.requireSession(device);
    const key = axisKey(device, axis);
    let calibrator = session.calibrators.get(key);
    if (!calibrator) {
      calibrator = new AxisCenterCalibrator(key, session.id, null);
      session.calibrators.set(key, calibrator);
    }
    calibrator.begin();
  }

  sampleAxisCalibration(device: number, axis: number, rawValue: number): void {
    this.requireSession(device).calibrators
      .get(axisKey(device, axis))
      ?.sample(rawValue);
  }

  finishAxisCalibration(device: number, axis: number): number {
    const calibrator = this.requireSession(device).calibrators.get(axisKey(device, axis));
    if (!calibrator) throw new Error(`No active calibration for ${axisKey(device, axis)}.`);
    return calibrator.finish();
  }

  cancelAxisCalibration(device: number, axis: number): void {
    this.requireSession(device).calibrators.get(axisKey(device, axis))?.cancel();
  }

  getAxisCalibrationState(device: number, axis: number) {
    return this.sessions.get(device)?.calibrators
      .get(axisKey(device, axis))
      ?.getState() ?? null;
  }

  destroy(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.length = 0;
  }

  private subscribe(): void {
    if (this.provider.onGamepadConnected) {
      this.subscriptions.push(this.provider.onGamepadConnected(gamepad => {
        if (!this.validPadIndex(gamepad.index)) return;
        this.pendingConnects.set(gamepad.index, gamepad);
      }));
    }
    if (this.provider.onGamepadDisconnected) {
      this.subscriptions.push(this.provider.onGamepadDisconnected(gamepad => {
        if (!this.validPadIndex(gamepad.index)) return;
        this.pendingDisconnects.add(gamepad.index);
        this.pendingConnects.delete(gamepad.index);
      }));
    }
    if (this.provider.onWindowBlur) {
      this.subscriptions.push(this.provider.onWindowBlur(() => {
        this.suspended = true;
      }));
    }
    if (this.provider.onWindowFocus) {
      this.subscriptions.push(this.provider.onWindowFocus(() => {
        this.suspended = false;
      }));
    }
  }

  private validPadIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < MAX_GAMEPADS;
  }

  private reconcileSuspendedSessions(): void {
    const pads = this.provider.getGamepads();
    const disconnectedSlots = new Set<number>(this.pendingDisconnects);
    for (const index of disconnectedSlots) {
      this.closeSession(index);
    }
    this.pendingDisconnects.clear();

    for (let index = 0; index < MAX_GAMEPADS; index++) {
      const pad = pads[index] ?? this.pendingConnects.get(index) ?? null;
      const session = this.sessions.get(index);
      const hasConnectEvent = this.pendingConnects.has(index);
      if (session && !disconnectedSlots.has(index)
        && (!this.isUsablePad(pad, index)
          || (hasConnectEvent && this.identityChanged(session, pad)))) {
        this.closeSession(index);
      }
    }

    for (let index = 0; index < MAX_GAMEPADS; index++) {
      if (disconnectedSlots.has(index)) continue;
      const pad = pads[index];
      if (this.isUsablePad(pad, index) && !this.sessions.has(index)) {
        // Wait until focus to open the session so a replacement device cannot inherit a calibration session.
        this.pendingConnects.set(index, pad);
      }
    }
  }

  private reconcileSessions(pads: readonly (GamepadLike | null)[]): void {
    const disconnectedSlots = new Set<number>(this.pendingDisconnects);
    for (const index of disconnectedSlots) {
      this.closeSession(index);
    }
    this.pendingDisconnects.clear();

    for (let index = 0; index < MAX_GAMEPADS; index++) {
      const snapshotPad = pads[index];
      const eventPad = this.pendingConnects.get(index);
      const hasConnectEvent = this.pendingConnects.has(index);
      const session = this.sessions.get(index);

      let pad: GamepadLike | null = null;
      if (this.isUsablePad(eventPad, index)
        && (disconnectedSlots.has(index)
          || !this.isUsablePad(snapshotPad, index)
          || snapshotPad.id !== eventPad.id)) {
        pad = eventPad;
      } else if (this.isUsablePad(snapshotPad, index)) {
        pad = snapshotPad;
      }

      if (!this.isUsablePad(pad, index)) {
        if (session) this.closeSession(index);
        continue;
      }
      if (session && (hasConnectEvent || this.identityChanged(session, pad))) {
        this.closeSession(index);
      }
      if (!this.sessions.has(index)) {
        this.openSession(index, pad);
      }
      this.pendingConnects.delete(index);
    }
  }

  private isUsablePad(pad: GamepadLike | null | undefined, index: number): pad is GamepadLike {
    return pad !== null
      && pad !== undefined
      && pad.connected === true
      && pad.index === index
      && Array.isArray(pad.axes)
      && Array.isArray(pad.buttons);
  }

  private identityChanged(session: DeviceSession, pad: GamepadLike): boolean {
    return session.gamepadId !== pad.id || session.gamepadIndex !== pad.index;
  }

  private openSession(device: number, pad: GamepadLike): void {
    this.sessionCounter += 1;
    const session: DeviceSession = {
      id: this.sessionCounter,
      device,
      gamepadId: pad.id,
      gamepadIndex: pad.index,
      connectedAt: this.now(),
      keys: new Set(),
      axisActive: new Map(),
      calibrators: new Map()
    };
    this.sessions.set(device, session);
  }

  private closeSession(device: number): void {
    const session = this.sessions.get(device);
    if (!session) return;

    for (const action of this.config.actions.map(action => action.name)) {
      const selectedAction = this.selected.get(action);
      if (selectedAction && this.bindingUsesDevice(selectedAction, device)) {
        this.forcedReleases.add(action);
      }
    }

    for (const key of session.keys) this.down.delete(key);
    this.sessions.delete(device);
  }

  private bindingUsesDevice(selected: SelectedAction, device: number): boolean {
    const prefix = `d${device}.`;
    for (const key of selected.keys) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  private readPads(pads: readonly (GamepadLike | null)[]): void {
    for (let device = 0; device < MAX_GAMEPADS; device++) {
      const session = this.sessions.get(device);
      const pad = pads[device];
      if (!session || !this.isUsablePad(pad, device)) {
        continue;
      }

      for (const key of session.keys) this.down.delete(key);
      session.keys.clear();
      this.readAxes(session, pad);
      this.readButtons(session, pad);
    }
  }

  private readAxes(session: DeviceSession, pad: GamepadLike): void {
    pad.axes.forEach((rawValue, axis) => {
      const key = axisKey(session.device, axis);
      const calibrator = session.calibrators.get(key);
      if (calibrator?.calibrating) calibrator.sample(rawValue);

      const fallback = getAxisConfig(this.config, session.device, axis);
      const center = calibrator?.getCenter() ?? fallback.center;
      const releaseThreshold = Math.max(0, fallback.deadzone - fallback.releaseHysteresis);
      const raw = Number.isFinite(rawValue) ? rawValue : 0;

      for (const direction of ['positive', 'negative'] as const) {
        const ref: NormalizedInputRef = {
          device: session.device,
          kind: 'axis',
          index: axis,
          direction
        };
        const input = inputKey(ref);
        const activeKey = `${input}:active`;
        const wasActive = session.axisActive.get(activeKey) ?? false;
        const magnitude = Math.abs(raw - center);
        const aligned = axisDirectionActive(raw, center, direction);
        const active = aligned
          && (wasActive ? magnitude > releaseThreshold : magnitude >= fallback.deadzone);
        session.axisActive.set(activeKey, active);
        if (active) {
          this.down.add(input);
          session.keys.add(input);
        }
      }
    });
  }

  private readButtons(session: DeviceSession, pad: GamepadLike): void {
    pad.buttons.forEach((button, index) => {
      const input = inputKey({ device: session.device, kind: 'button', index, direction: null });
      const pressed = button?.pressed === true;
      if (pressed) {
        this.down.add(input);
        session.keys.add(input);
      }
    });
  }

  private resolveActions(): Map<string, SelectedAction> {
    const candidates: Candidate[] = [];
    this.config.actions.forEach((action, actionIndex) => {
      action.bindings.forEach((binding, bindingIndex) => {
        if (binding.inputs.every(input => this.down.has(inputKey(input)))) {
          candidates.push({
            action: action.name,
            actionIndex,
            bindingIndex,
            priority: binding.priority,
            length: binding.inputs.length,
            keys: new Set(binding.inputs.map(inputKey))
          });
        }
      });
    });

    candidates.sort((a, b) =>
      b.priority - a.priority
      || b.length - a.length
      || a.actionIndex - b.actionIndex
      || a.bindingIndex - b.bindingIndex
    );

    const usedKeys = new Set<string>();
    const next = new Map<string, SelectedAction>();
    for (const candidate of candidates) {
      if (next.has(candidate.action)) continue;
      let overlaps = false;
      for (const key of candidate.keys) {
        if (usedKeys.has(key)) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      for (const key of candidate.keys) usedKeys.add(key);
      next.set(candidate.action, { keys: candidate.keys, bindingIndex: candidate.bindingIndex });
    }
    return next;
  }

  private diffSelection(next: Map<string, SelectedAction>, timestamp: number): RuntimeActionEntry[] {
    const events: RuntimeActionEntry[] = [];

    for (const action of this.config.actions) {
      const wasSelected = this.selected.has(action.name);
      const mustReleaseBeforeResolve = this.forcedReleases.has(action.name);
      if (wasSelected && (mustReleaseBeforeResolve || !next.has(action.name))) {
        events.push(this.actionEntry(action.name, 'up', timestamp));
      }
    }

    for (const action of this.config.actions) {
      const isSelected = next.has(action.name);
      const wasSelected = this.selected.has(action.name);
      if (isSelected && (!wasSelected || this.forcedReleases.has(action.name))) {
        events.push(this.actionEntry(action.name, 'down', timestamp));
      }
    }

    this.selected = next;
    this.forcedReleases.clear();
    return events;
  }

  private releaseAll(timestamp: number): RuntimeActionEntry[] {
    const events: RuntimeActionEntry[] = [];
    for (const action of this.config.actions) {
      if (this.selected.has(action.name)) {
        events.push(this.actionEntry(action.name, 'up', timestamp));
      }
    }
    this.selected.clear();
    this.forcedReleases.clear();
    return events;
  }

  private resetRuntimeInputState(): void {
    this.down.clear();
    this.forcedReleases.clear();
    for (const session of this.sessions.values()) {
      session.keys.clear();
      session.axisActive.clear();
    }
  }

  private beginGeneration(reason: RuntimeGenerationEntry['reason'], timestamp: number): void {
    this.generation += 1;
    this.generationReason = reason;
    this.sequence = 0;
    this.selected.clear();
    this.resetRuntimeInputState();
    void timestamp;
  }

  private generationEntry(timestamp: number): RuntimeGenerationEntry {
    return {
      sequence: this.sequence++,
      type: 'generation',
      generation: this.generation,
      reason: this.generationReason,
      timestamp,
      config: this.config
    };
  }

  private actionEntry(action: string, phase: 'down' | 'up', timestamp: number): RuntimeActionEntry {
    return {
      sequence: this.sequence++,
      type: 'action',
      generation: this.generation,
      timestamp,
      action,
      phase
    };
  }

  private requireSession(device: number): DeviceSession {
    const session = this.sessions.get(device);
    if (!session) throw new Error(`Gamepad ${device} is not connected.`);
    return session;
  }
}
