import type {
  NormalizedActionEntry,
  NormalizedEventLog,
  NormalizedGenerationEntry,
  NormalizedLogEntry
} from './types';

export interface ReplayHandlers {
  onGeneration?(entry: NormalizedGenerationEntry): void;
  onAction?(entry: NormalizedActionEntry): void;
}

export class EventLogReplayer {
  private readonly entries: NormalizedLogEntry[];
  private cursor = 0;
  private readonly active = new Set<string>();
  private generation: number | null = null;

  constructor(log: NormalizedEventLog) {
    if (!log || log.version !== 1 || !Array.isArray(log.entries)) {
      throw new TypeError('A normalized version 1 event log is required.');
    }
    this.entries = log.entries.map((entry) => structuredCloneSafe(entry));
  }

  get position(): number {
    return this.cursor;
  }

  get size(): number {
    return this.entries.length;
  }

  get done(): boolean {
    return this.cursor >= this.entries.length;
  }

  get currentGeneration(): number | null {
    return this.generation;
  }

  getActiveActions(): string[] {
    return [...this.active];
  }

  restart(): void {
    this.cursor = 0;
    this.active.clear();
    this.generation = null;
  }

  step(handlers: ReplayHandlers = {}): NormalizedLogEntry | null {
    const entry = this.entries[this.cursor];
    if (!entry) return null;
    this.cursor += 1;

    if (entry.type === 'generation') {
      this.active.clear();
      this.generation = entry.generation;
      handlers.onGeneration?.(entry);
      return entry;
    }

    if (this.generation === null) {
      throw new Error('Cannot replay an action before its generation marker.');
    }
    if (entry.generation !== this.generation) {
      throw new Error(`Action generation ${entry.generation} does not match ${this.generation}.`);
    }
    if (entry.phase === 'down') {
      if (this.active.has(entry.action)) {
        throw new Error(`Duplicate down for active action ${entry.action}.`);
      }
      this.active.add(entry.action);
    } else {
      if (!this.active.has(entry.action)) {
        throw new Error(`Cannot release inactive action ${entry.action}.`);
      }
      this.active.delete(entry.action);
    }
    handlers.onAction?.(entry);
    return entry;
  }

  stepAction(handlers: ReplayHandlers = {}): NormalizedActionEntry | null {
    while (!this.done) {
      const entry = this.step(handlers);
      if (entry?.type === 'action') return entry;
    }
    return null;
  }
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
