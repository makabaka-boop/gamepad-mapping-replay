import type {
  GamepadButtonLike,
  GamepadLike,
  GamepadProvider,
  GamepadEvents,
  Unsubscribe
} from '../src/types';

export class FakeGamepad implements GamepadLike {
  readonly id: string;
  readonly index: number;
  connected = true;
  axes: number[];
  buttons: GamepadButtonLike[];

  constructor(id: string, index: number, axisCount = 2, buttonCount = 8) {
    this.id = id;
    this.index = index;
    this.axes = Array(axisCount).fill(0);
    this.buttons = Array(buttonCount).fill(null).map(() => ({ pressed: false, value: 0 }));
  }

  setButton(index: number, pressed: boolean): this {
    const button = this.buttons[index];
    if (!button) throw new Error(`Missing button ${index}`);
    button.pressed = pressed;
    button.value = pressed ? 1 : 0;
    return this;
  }

  setAxis(index: number, value: number): this {
    this.axes[index] = value;
    return this;
  }
}

type Listener<T> = (value: T) => void;

export class FakeGamepadProvider implements GamepadProvider, GamepadEvents {
  private pads: (FakeGamepad | null)[] = [null, null, null, null];
  private connectListeners = new Set<Listener<GamepadLike>>();
  private disconnectListeners = new Set<Listener<GamepadLike>>();
  private blurListeners = new Set<() => void>();
  private focusListeners = new Set<() => void>();

  set(gamepad: FakeGamepad | null, index = gamepad?.index ?? 0): void {
    this.pads[index] = gamepad;
    if (gamepad) gamepad.connected = true;
  }

  remove(index: number): FakeGamepad | null {
    const previous = this.pads[index] ?? null;
    if (previous) previous.connected = false;
    this.pads[index] = null;
    return previous;
  }

  replace(index: number, gamepad: FakeGamepad): void {
    const previous = this.remove(index);
    this.pads[index] = gamepadSafe(gamepad, index);
    if (previous) this.emit(this.disconnectListeners, previous);
    this.emit(this.connectListeners, this.pads[index]!);
  }

  emitConnect(gamepad: FakeGamepad): void {
    this.emit(this.connectListeners, gamepad);
  }

  emitDisconnect(gamepad?: GamepadLike): void {
    const index = gamepad?.index ?? this.pads.findIndex(pad => pad !== null);
    const disconnected = gamepad ?? (index >= 0 ? this.remove(index) : null);
    if (disconnected) {
      const stored = this.pads[index];
      if (stored) stored.connected = false;
      this.emit(this.disconnectListeners, disconnected);
    }
  }

  blur(): void {
    for (const listener of this.blurListeners) listener();
  }

  focus(): void {
    for (const listener of this.focusListeners) listener();
  }

  getGamepads(): readonly (GamepadLike | null)[] {
    return [...this.pads];
  }

  onGamepadConnected(listener: Listener<GamepadLike>): Unsubscribe {
    this.connectListeners.add(listener);
    return () => this.connectListeners.delete(listener);
  }

  onGamepadDisconnected(listener: Listener<GamepadLike>): Unsubscribe {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  onWindowBlur(listener: () => void): Unsubscribe {
    this.blurListeners.add(listener);
    return () => this.blurListeners.delete(listener);
  }

  onWindowFocus(listener: () => void): Unsubscribe {
    this.focusListeners.add(listener);
    return () => this.focusListeners.delete(listener);
  }

  private emit<T>(listeners: Set<Listener<T>>, value: T): void {
    for (const listener of listeners) listener(value);
  }
}

function gamepadSafe(gamepad: FakeGamepad, index: number): FakeGamepad {
  Object.defineProperty(gamepad, 'index', { value: index });
  gamepad.connected = true;
  return gamepad;
}
