import { clampSignedUnit } from './config';

export class AxisCenterCalibrator {
  readonly axisKey: string;
  private sessionId: number;
  private samples: number[] = [];
  private active = false;
  private center: number | null = null;

  constructor(axisKey: string, sessionId: number, initialCenter: number | null = null) {
    this.axisKey = axisKey;
    this.sessionId = sessionId;
    this.center = initialCenter;
  }

  get session(): number {
    return this.sessionId;
  }

  get calibrating(): boolean {
    return this.active;
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  begin(): void {
    this.active = true;
    this.samples = [];
  }

  reset(sessionId: number, initialCenter: number | null = null): void {
    this.sessionId = sessionId;
    this.samples = [];
    this.active = false;
    this.center = initialCenter;
  }

  sample(value: number): void {
    if (!this.active || !Number.isFinite(value)) return;
    this.samples.push(clampSignedUnit(value));
  }

  finish(): number {
    if (!this.active || this.samples.length === 0) {
      throw new Error('Cannot finish calibration without samples.');
    }
    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.center = clampSignedUnit(average);
    this.active = false;
    return this.center;
  }

  cancel(): void {
    this.active = false;
    this.samples = [];
  }

  getCenter(): number | null {
    return this.center;
  }

  getState() {
    let min = 0;
    let max = 0;
    if (this.samples.length > 0) {
      min = Math.min(...this.samples);
      max = Math.max(...this.samples);
    }
    return {
      session: this.sessionId,
      axisKey: this.axisKey,
      samples: this.samples.length,
      min,
      max,
      center: this.center,
      calibrating: this.active
    };
  }
}
