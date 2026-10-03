import type { GamepadLike, GamepadProvider, GamepadEvents, Unsubscribe } from './types';

export class BrowserGamepadProvider implements GamepadProvider, GamepadEvents {
  getGamepads(): readonly (GamepadLike | null)[] {
    const navigatorWithGamepads = globalThis.navigator as Navigator & {
      getGamepads?: () => (Gamepad | null)[];
    };
    const pads = navigatorWithGamepads.getGamepads?.call(navigator) ?? [];
    const result: (GamepadLike | null)[] = [null, null, null, null];
    pads.slice(0, 4).forEach((pad, index) => {
      if (pad) result[index] = pad;
    });
    return result;
  }

  onGamepadConnected(listener: (gamepad: GamepadLike) => void): Unsubscribe {
    const handler = (event: Event) => {
      const gamepadEvent = event as GamepadEvent;
      if (gamepadEvent.gamepad) listener(gamepadEvent.gamepad);
    };
    globalThis.addEventListener('gamepadconnected', handler);
    return () => globalThis.removeEventListener('gamepadconnected', handler);
  }

  onGamepadDisconnected(listener: (gamepad: GamepadLike) => void): Unsubscribe {
    const handler = (event: Event) => {
      const gamepadEvent = event as GamepadEvent;
      if (gamepadEvent.gamepad) listener(gamepadEvent.gamepad);
    };
    globalThis.addEventListener('gamepaddisconnected', handler);
    return () => globalThis.removeEventListener('gamepaddisconnected', handler);
  }

  onWindowBlur(listener: () => void): Unsubscribe {
    globalThis.addEventListener('blur', listener);
    return () => globalThis.removeEventListener('blur', listener);
  }

  onWindowFocus(listener: () => void): Unsubscribe {
    globalThis.addEventListener('focus', listener);
    return () => globalThis.removeEventListener('focus', listener);
  }
}
