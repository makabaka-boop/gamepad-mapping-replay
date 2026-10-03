import { BrowserGamepadProvider } from './browserProvider';
import { EventRecorder } from './recorder';
import { EventLogReplayer } from './replayer';
import { GamepadActionPoller } from './poller';
import type {
  GamepadConfig,
  NormalizedEventLog,
  NormalizedLogEntry,
  RuntimeLogEntry
} from './types';

const defaultConfig: GamepadConfig = {
  axes: {
    '0:0': { center: 0, deadzone: 0.14, releaseHysteresis: 0.06 },
    '0:1': { center: 0, deadzone: 0.14, releaseHysteresis: 0.06 }
  },
  actions: [
    {
      name: 'jump',
      bindings: [{ inputs: [{ device: 0, kind: 'button', index: 0 }] }]
    },
    {
      name: 'runJump',
      bindings: [{
        priority: 10,
        inputs: [
          { device: 0, kind: 'button', index: 0 },
          { device: 0, kind: 'button', index: 2 }
        ]
      }]
    },
    {
      name: 'fire',
      bindings: [{ inputs: [{ device: 0, kind: 'button', index: 7 }] }]
    },
    {
      name: 'moveRight',
      bindings: [{ inputs: [{ device: 0, kind: 'axis', index: 0, direction: 'positive' }] }]
    },
    {
      name: 'moveLeft',
      bindings: [{ inputs: [{ device: 0, kind: 'axis', index: 0, direction: 'negative' }] }]
    },
    {
      name: 'moveDown',
      bindings: [{ inputs: [{ device: 0, kind: 'axis', index: 1, direction: 'positive' }] }]
    },
    {
      name: 'moveUp',
      bindings: [{ inputs: [{ device: 0, kind: 'axis', index: 1, direction: 'negative' }] }]
    }
  ]
};

const $ = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const provider = new BrowserGamepadProvider();
const poller = new GamepadActionPoller({ config: defaultConfig, provider });
const recorder = new EventRecorder();
let replayer: EventLogReplayer | null = null;

const configInput = $<HTMLTextAreaElement>('#configInput');
const configError = $<HTMLParagraphElement>('#configError');
const devices = $<HTMLDivElement>('#devices');
const focusState = $<HTMLSpanElement>('#focusState');
const activeActions = $<HTMLUListElement>('#activeActions');
const liveLog = $<HTMLOListElement>('#liveLog');
const recordButton = $<HTMLButtonElement>('#recordButton');
const stopButton = $<HTMLButtonElement>('#stopButton');
const exportButton = $<HTMLButtonElement>('#exportButton');
const calibrationAxis = $<HTMLSelectElement>('#calibrationAxis');
const calibrationState = $<HTMLPreElement>('#calibrationState');
const replayFile = $<HTMLInputElement>('#replayFile');
const replayStep = $<HTMLButtonElement>('#replayStep');
const replayAction = $<HTMLButtonElement>('#replayAction');
const replayRestart = $<HTMLButtonElement>('#replayRestart');
const replayInfo = $<HTMLParagraphElement>('#replayInfo');
const replayActive = $<HTMLUListElement>('#replayActive');
const replayLog = $<HTMLOListElement>('#replayLog');

configInput.value = JSON.stringify(defaultConfig, null, 2);

function entriesFromPoll(): void {
  const entries = poller.poll();
  recorder.ingest(entries);
  for (const entry of entries) appendRuntimeEntry(entry);
}

function appendRuntimeEntry(entry: RuntimeLogEntry): void {
  const line = entry.type === 'generation'
    ? `gen #${entry.generation} (${entry.reason})`
    : `${entry.phase.padEnd(4)} ${entry.action} [gen ${entry.generation}]`;
  appendList(liveLog, line);
}

function appendList(list: HTMLOListElement, text: string): void {
  const item = document.createElement('li');
  item.textContent = text;
  list.append(item);
  list.scrollTop = list.scrollHeight;
  while (list.children.length > 200) list.firstElementChild?.remove();
}

function render(): void {
  const pads = provider.getGamepads();
  devices.innerHTML = '';
  const axisOptions: string[] = [];

  for (let index = 0; index < 4; index++) {
    const pad = pads[index];
    const card = document.createElement('div');
    card.className = `device-card${pad?.connected ? ' connected' : ''}`;
    const title = document.createElement('strong');
    title.textContent = `设备 ${index}`;
    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.textContent = pad
      ? `${pad.id || '未知设备'} / 会话 ${poller.getDeviceSessionId(index) ?? '-'}`
      : '未连接';
    card.append(title, detail);
    devices.append(card);

    if (pad?.connected) {
      pad.axes.forEach((_, axis) => axisOptions.push(`${index}:${axis}`));
    }
  }

  const selected = calibrationAxis.value;
  calibrationAxis.innerHTML = '';
  for (const optionValue of axisOptions) {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = `设备 ${optionValue.replace(':', ' / 轴 ')}`;
    calibrationAxis.append(option);
  }
  if ([...calibrationAxis.options].some(option => option.value === selected)) {
    calibrationAxis.value = selected;
  }

  focusState.textContent = poller.isSuspended() ? '页面已失焦，输入已释放' : '页面已聚焦';
  focusState.classList.toggle('suspended', poller.isSuspended());

  const active = poller.getActiveActions();
  activeActions.innerHTML = '';
  for (const action of active) {
    const item = document.createElement('li');
    item.textContent = action;
    activeActions.append(item);
  }

  const axisValue = calibrationAxis.value;
  if (axisValue) {
    const [device, axis] = axisValue.split(':').map(Number) as [number, number];
    calibrationState.textContent = JSON.stringify(
      poller.getAxisCalibrationState(device, axis),
      null,
      2
    );
  }
}

function applyConfig(): void {
  try {
    const parsed = JSON.parse(configInput.value) as GamepadConfig;
    const entries = poller.setConfig(parsed);
    configInput.value = JSON.stringify(poller.getConfig(), null, 2);
    configError.textContent = '';
    recorder.ingest(entries);
    for (const entry of entries) appendRuntimeEntry(entry);
    render();
  } catch (error) {
    configError.textContent = error instanceof Error ? error.message : String(error);
  }
}

function downloadLog(): void {
  const log = recorder.exportLog();
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gamepad-events-${new Date().toISOString().replaceAll(':', '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function calibrationTarget(): [number, number] | null {
  const match = /^(\d+):(\d+)$/.exec(calibrationAxis.value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

function renderReplayState(entry?: NormalizedLogEntry | null): void {
  if (!replayer) return;
  replayInfo.textContent = `事件 ${replayer.position}/${replayer.size}；代次 ${replayer.currentGeneration ?? '-'}`;
  replayActive.innerHTML = '';
  for (const action of replayer.getActiveActions()) {
    const item = document.createElement('li');
    item.textContent = action;
    replayActive.append(item);
  }
  if (entry) {
    appendList(
      replayLog,
      entry.type === 'generation'
        ? `gen #${entry.generation} (${entry.reason})`
        : `${entry.phase.padEnd(4)} ${entry.action} t=${entry.t}`
    );
  }
  replayStep.disabled = replayer.done;
  replayAction.disabled = replayer.done;
}

$<HTMLButtonElement>('#applyConfig').addEventListener('click', applyConfig);
$<HTMLButtonElement>('#formatConfig').addEventListener('click', () => {
  configInput.value = JSON.stringify(JSON.parse(configInput.value) as unknown, null, 2);
  configError.textContent = '';
});

recordButton.addEventListener('click', () => {
  const generation = poller.beginLogGeneration('recording');
  recorder.start(generation);
  liveLog.innerHTML = '';
  appendRuntimeEntry(generation);
  recordButton.disabled = true;
  stopButton.disabled = false;
  exportButton.disabled = false;
});

stopButton.addEventListener('click', () => {
  recorder.stop();
  recordButton.disabled = false;
  stopButton.disabled = true;
});

exportButton.addEventListener('click', downloadLog);

$<HTMLButtonElement>('#startCalibration').addEventListener('click', () => {
  const target = calibrationTarget();
  if (target) poller.startAxisCalibration(target[0], target[1]);
});
$<HTMLButtonElement>('#finishCalibration').addEventListener('click', () => {
  const target = calibrationTarget();
  if (target) {
    try {
      poller.finishAxisCalibration(target[0], target[1]);
    } catch (error) {
      calibrationState.textContent = error instanceof Error ? error.message : String(error);
    }
  }
});
$<HTMLButtonElement>('#cancelCalibration').addEventListener('click', () => {
  const target = calibrationTarget();
  if (target) poller.cancelAxisCalibration(target[0], target[1]);
});

replayFile.addEventListener('change', async () => {
  const file = replayFile.files?.[0];
  if (!file) return;
  const parsed = JSON.parse(await file.text()) as NormalizedEventLog;
  replayer = new EventLogReplayer(parsed);
  replayLog.innerHTML = '';
  replayStep.disabled = false;
  replayAction.disabled = false;
  replayRestart.disabled = false;
  renderReplayState();
});
replayStep.addEventListener('click', () => {
  renderReplayState(replayer?.step());
});
replayAction.addEventListener('click', () => {
  renderReplayState(replayer?.stepAction());
});
replayRestart.addEventListener('click', () => {
  replayer?.restart();
  replayLog.innerHTML = '';
  renderReplayState();
});

provider.onWindowBlur?.(() => entriesFromPoll());
window.addEventListener('gamepadconnected', () => render());
window.addEventListener('gamepaddisconnected', () => render());

function frame(): void {
  entriesFromPoll();
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
