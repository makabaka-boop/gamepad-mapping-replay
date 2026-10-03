import type {
  NormalizedActionEntry,
  NormalizedEventLog,
  NormalizedGenerationEntry,
  NormalizedLogEntry,
  RuntimeActionEntry,
  RuntimeGenerationEntry,
  RuntimeLogEntry
} from './types';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class EventRecorder {
  private entries: NormalizedLogEntry[] = [];
  private active = false;
  private generationStart: number | null = null;

  get recording(): boolean {
    return this.active;
  }

  get length(): number {
    return this.entries.length;
  }

  ingest(entries: readonly RuntimeLogEntry[]): void {
    if (!this.active) return;
    for (const entry of entries) {
      this.entries.push(this.normalize(entry));
    }
  }

  start(generation: RuntimeGenerationEntry): NormalizedEventLog {
    this.active = true;
    this.entries = [];
    this.generationStart = generation.timestamp;
    this.entries.push(this.normalizeGeneration(generation));
    return this.exportLog();
  }

  stop(): void {
    this.active = false;
  }

  clear(): void {
    this.active = false;
    this.entries = [];
    this.generationStart = null;
  }

  getEntries(): readonly NormalizedLogEntry[] {
    return clone(this.entries);
  }

  exportLog(): NormalizedEventLog {
    return {
      version: 1,
      entries: clone(this.entries)
    };
  }

  private normalize(entry: RuntimeLogEntry): NormalizedLogEntry {
    return entry.type === 'generation'
      ? this.normalizeGeneration(entry)
      : this.normalizeAction(entry);
  }

  private normalizeGeneration(entry: RuntimeGenerationEntry): NormalizedGenerationEntry {
    this.generationStart = entry.timestamp;
    return {
      type: 'generation',
      generation: entry.generation,
      reason: entry.reason,
      t: 0,
      config: clone(entry.config)
    };
  }

  private normalizeAction(entry: RuntimeActionEntry): NormalizedActionEntry {
    const start = this.generationStart ?? entry.timestamp;
    const relative = Math.max(0, entry.timestamp - start);
    return {
      type: 'action',
      generation: entry.generation,
      t: relative,
      action: entry.action,
      phase: entry.phase
    };
  }
}
