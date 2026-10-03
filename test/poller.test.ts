import { describe, expect, it } from 'vitest';
import { EventLogReplayer } from '../src/replayer';
import { EventRecorder } from '../src/recorder';
import { GamepadActionPoller } from '../src/poller';
import type { GamepadConfig, RuntimeLogEntry } from '../src/types';
import { FakeGamepad, FakeGamepadProvider } from './fakeProvider';

function config(): GamepadConfig {
  return {
    axes: {
      '0:0': { center: 0, deadzone: 0.2, releaseHysteresis: 0.1 }
    },
    actions: [
      { name: 'right', bindings: [{ inputs: [{ device: 0, kind: 'axis', index: 0, direction: 'positive' }] }] },
      { name: 'left', bindings: [{ inputs: [{ device: 0, kind: 'axis', index: 0, direction: 'negative' }] }] },
      { name: 'jump', bindings: [{ inputs: [{ device: 0, kind: 'button', index: 0 }] }] },
      { name: 'runJump', bindings: [{
        priority: 10,
        inputs: [
          { device: 0, kind: 'button', index: 0 },
          { device: 0, kind: 'button', index: 2 }
        ]
      }] },
      { name: 'run', bindings: [{ inputs: [{ device: 0, kind: 'button', index: 2 }] }] },
      { name: 'otherDevice', bindings: [{ inputs: [{ device: 1, kind: 'button', index: 0 }] }] },
      { name: 'coop', bindings: [{
        inputs: [
          { device: 0, kind: 'button', index: 1 },
          { device: 1, kind: 'button', index: 1 }
        ]
      }] }
    ]
  };
}

function makePoller(provider = new FakeGamepadProvider()) {
  let time = 100;
  const poller = new GamepadActionPoller({ config: config(), provider, now: () => time });
  return {
    poller,
    provider,
    tick(ms = 10) {
      time += ms;
    }
  };
}

function actionEvents(entries: RuntimeLogEntry[]) {
  return entries
    .filter(entry => entry.type === 'action')
    .map(entry => entry.type === 'action' ? `${entry.phase}:${entry.action}` : '');
}

describe('axis calibration, deadzone, and release hysteresis', () => {
  it('keeps an axis active while noise stays above the lower release threshold', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);

    expect(actionEvents(poller.poll())).toEqual([]);
    pad.setAxis(0, 0.21);
    expect(actionEvents(poller.poll())).toEqual(['down:right']);

    pad.setAxis(0, 0.12);
    expect(actionEvents(poller.poll())).toEqual([]);

    pad.setAxis(0, 0.1);
    expect(actionEvents(poller.poll())).toEqual(['up:right']);
  });

  it('does not trigger the opposite direction while crossing the center', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);

    pad.setAxis(0, -0.21);
    expect(actionEvents(poller.poll())).toEqual(['down:left']);
    pad.setAxis(0, 0.21);
    expect(actionEvents(poller.poll())).toEqual(['up:left', 'down:right']);
  });

  it('uses a per-device calibration session and does not inherit it after replacement', () => {
    const { poller, provider } = makePoller();
    const first = new FakeGamepad('pad-a', 0);
    provider.set(first, 0);
    poller.poll();
    const firstSession = poller.getDeviceSessionId(0);

    poller.startAxisCalibration(0, 0);
    first.setAxis(0, 0.08);
    poller.poll();
    first.setAxis(0, 0.12);
    poller.poll();
    expect(poller.finishAxisCalibration(0, 0)).toBeCloseTo(0.1);

    first.setAxis(0, 0.31);
    const entries = poller.poll();
    expect(actionEvents(entries)).toEqual(['down:right']);

    provider.replace(0, new FakeGamepad('pad-b', 0));
    const replacementEvents = poller.poll().map(entry => entry.type === 'action' && `${entry.phase}:${entry.action}`).filter(Boolean);
    expect(replacementEvents).toEqual(['up:right']);
    expect(poller.getDeviceSessionId(0)).not.toBe(firstSession);
    expect(poller.getAxisCalibrationState(0, 0)).toBeNull();

    // The new physical device starts from configured center 0, not the old learned center 0.1.
    const second = provider.getGamepads()[0]!;
    (second as FakeGamepad).setAxis(0, 0.12);
    expect(actionEvents(poller.poll())).toEqual([]);
    (second as FakeGamepad).setAxis(0, 0.21);
    expect(actionEvents(poller.poll())).toEqual(['down:right']);
  });
});

describe('chord priority and input competition', () => {
  it('prefers a higher-priority chord and releases it before competing actions', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);
    poller.poll();

    pad.setButton(0, true);
    expect(actionEvents(poller.poll())).toEqual(['down:jump']);

    pad.setButton(2, true);
    expect(actionEvents(poller.poll())).toEqual(['up:jump', 'down:runJump']);

    pad.setButton(0, false);
    expect(actionEvents(poller.poll())).toEqual(['up:runJump', 'down:run']);
  });

  it('emits deterministic releases before presses for competing chords in one batch', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);
    poller.poll();

    // The batch already contains the complete higher-priority chord.
    pad.setButton(0, true);
    pad.setButton(2, true);
    expect(actionEvents(poller.poll())).toEqual(['down:runJump']);

    // Both selected chord inputs disappear while the lower-priority member remains.
    pad.setButton(0, false);
    pad.setButton(2, true);
    expect(actionEvents(poller.poll())).toEqual(['up:runJump', 'down:run']);
  });

  it('does not emit repeated events across unchanged polls or batches', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);
    pad.setButton(0, true);

    expect(actionEvents(poller.poll())).toEqual(['down:jump']);
    expect(actionEvents(poller.poll())).toEqual([]);
    expect(actionEvents(poller.poll())).toEqual([]);
    expect(poller.getActiveActions()).toEqual(['jump']);
  });

  it('supports chords spanning separate physical devices', () => {
    const { poller, provider } = makePoller();
    const pad0 = new FakeGamepad('pad-a', 0);
    const pad1 = new FakeGamepad('pad-b', 1);
    provider.set(pad0, 0);
    provider.set(pad1, 1);
    poller.poll();

    pad0.setButton(1, true);
    expect(actionEvents(poller.poll())).toEqual([]);
    pad1.setButton(1, true);
    expect(actionEvents(poller.poll())).toEqual(['down:coop']);
  });
});

describe('device disconnect, same-index replacement, and focus loss', () => {
  it('releases bindings from a disconnected device while preserving another device', () => {
    const { poller, provider } = makePoller();
    const pad0 = new FakeGamepad('pad-a', 0);
    const pad1 = new FakeGamepad('pad-b', 1);
    provider.set(pad0, 0);
    provider.set(pad1, 1);
    poller.poll();

    pad0.setButton(0, true);
    pad1.setButton(0, true);
    expect(actionEvents(poller.poll())).toEqual(['down:jump', 'down:otherDevice']);

    provider.emitDisconnect(pad0);
    expect(actionEvents(poller.poll())).toEqual(['up:jump']);
    expect(poller.getDeviceSessionId(0)).toBeNull();
    expect(poller.getActiveActions()).toEqual(['otherDevice']);
  });

  it('releases all logical presses when the page loses focus and waits for a new poll', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);
    pad.setButton(0, true);
    expect(actionEvents(poller.poll())).toEqual(['down:jump']);

    provider.blur();
    expect(actionEvents(poller.poll())).toEqual(['up:jump']);
    expect(poller.isSuspended()).toBe(true);

    // Inputs cannot produce logical actions while suspended.
    pad.setButton(2, true);
    expect(actionEvents(poller.poll())).toEqual([]);

    provider.focus();
    pad.setButton(0, false);
    pad.setButton(2, false);
    expect(actionEvents(poller.poll())).toEqual([]);
  });

  it('starts a fresh calibration session even when the same hardware reconnects at that slot', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('same-hardware', 0);
    provider.set(pad, 0);
    poller.poll();
    poller.startAxisCalibration(0, 0);
    pad.setAxis(0, 0.05);
    poller.poll();
    poller.finishAxisCalibration(0, 0);
    expect(poller.getAxisCalibrationState(0, 0)?.center).toBe(0.05);

    provider.replace(0, new FakeGamepad('same-hardware', 0));
    poller.poll();
    expect(poller.getAxisCalibrationState(0, 0)).toBeNull();
  });

  it('does not reopen a session from a stale snapshot after a disconnect event', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);
    poller.poll();
    const session = poller.getDeviceSessionId(0);

    pad.connected = false;
    provider.emitDisconnect(pad);
    expect(poller.poll()).toEqual([]);
    expect(poller.getDeviceSessionId(0)).toBeNull();
    expect(poller.getDeviceSessionId(0)).not.toBe(session);
  });

  it('prefers the connect event device when a stale snapshot still holds the previous device', () => {
    const { poller, provider } = makePoller();
    const oldPad = new FakeGamepad('pad-a', 0);
    provider.set(oldPad, 0);
    poller.poll();
    const firstSession = poller.getDeviceSessionId(0);

    const newPad = new FakeGamepad('pad-b', 1);
    Object.defineProperty(newPad, 'index', { value: 0 });
    provider.emitDisconnect(oldPad);
    provider.emitConnect(newPad);
    const nextSessionId = poller.getDeviceSessionId(0);
    expect(nextSessionId).toBe(firstSession);
    poller.poll();
    expect(poller.getDeviceSessionId(0)).not.toBe(firstSession);
    expect(poller.getDeviceSessionId(0)).toBe((firstSession ?? 0) + 1);
  });

  it('maps only the first four browser slots', () => {
    const { poller, provider } = makePoller();
    for (let index = 0; index < 4; index++) {
      provider.set(new FakeGamepad(`pad-${index}`, index), index);
    }
    expect(poller.poll()).toEqual([]);
    expect([0, 1, 2, 3].map(index => poller.getDeviceSessionId(index))).not.toContain(null);
  });
});

describe('recording, normalized export, config generations, and provider-free replay', () => {
  it('records only state changes and replays action entries without a gamepad', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);
    poller.poll();

    const recorder = new EventRecorder();
    const start = poller.beginLogGeneration('recording');
    recorder.start(start);

    pad.setButton(0, true);
    recorder.ingest(poller.poll());
    recorder.ingest(poller.poll());
    pad.setButton(0, false);
    recorder.ingest(poller.poll());

    const log = recorder.exportLog();
    expect(log.version).toBe(1);
    expect(log.entries.map(entry => entry.type)).toEqual(['generation', 'action', 'action']);
    expect(log.entries[0]).toMatchObject({ type: 'generation', t: 0, reason: 'recording' });

    const replayer = new EventLogReplayer(log);
    expect(replayer.stepAction()?.phase).toBe('down');
    expect(replayer.getActiveActions()).toEqual(['jump']);
    expect(replayer.stepAction()?.phase).toBe('up');
    expect(replayer.getActiveActions()).toEqual([]);
    expect(replayer.done).toBe(true);
  });

  it('closes the old active actions and starts a new generation when config changes', () => {
    const { poller, provider } = makePoller();
    const pad = new FakeGamepad('pad-a', 0);
    provider.set(pad, 0);
    pad.setButton(0, true);
    poller.poll();

    expect(() => poller.setConfig({ actions: [{ name: 'jump', bindings: [] }] })).toThrow();
    expect(poller.getActiveActions()).toEqual(['jump']);
    expect(poller.getGeneration()).toBe(0);

    const recorder = new EventRecorder();
    recorder.start(poller.beginLogGeneration('recording'));
    poller.poll(); // down is swallowed by the generation boundary

    pad.setButton(0, true);
    recorder.ingest(poller.poll());

    const changed = config();
    changed.actions = [{ name: 'renamed', bindings: [{ inputs: [{ device: 0, kind: 'button', index: 0 }] }] }];
    const entries = poller.setConfig(changed);
    recorder.ingest(entries);

    const actionTypes = entries.filter(entry => entry.type === 'action').map(entry => entry.type === 'action' && `${entry.phase}:${entry.action}`);
    expect(actionTypes).toEqual(['up:jump']);
    const generation = entries.find(entry => entry.type === 'generation');
    expect(generation).toMatchObject({ type: 'generation', reason: 'config' });

    recorder.ingest(poller.poll());
    const log = recorder.exportLog();
    const generations = log.entries.filter(entry => entry.type === 'generation');
    expect(generations).toHaveLength(2);
  });
});
