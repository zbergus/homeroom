/**
 * Virtual clock for the replay simulator. `v()` is milliseconds of simulated time since the sim's origin
 * (10 virtual minutes before the earliest game's first event). Real time scales by `speed`; pause/seek just rebase it.
 */
export class VirtualClock {
  private baseV = 0;
  private baseReal: number;
  private _speed: number;
  private _paused = false;

  constructor(speed = 1, private real: () => number = () => Date.now()) {
    this._speed = speed;
    this.baseReal = real();
  }

  v(): number {
    return this._paused ? this.baseV : this.baseV + (this.real() - this.baseReal) * this._speed;
  }
  get speed(): number {
    return this._speed;
  }
  get paused(): boolean {
    return this._paused;
  }
  private rebase(): void {
    this.baseV = this.v();
    this.baseReal = this.real();
  }
  setSpeed(s: number): void {
    if (!Number.isFinite(s) || s <= 0 || s > 5000) throw new Error("speed must be in (0, 5000]");
    this.rebase();
    this._speed = s;
  }
  pause(): void {
    this.rebase();
    this._paused = true;
  }
  resume(): void {
    this._paused = false;
    this.baseReal = this.real();
  }
  seek(v: number): void {
    this.baseV = Math.max(0, v);
    this.baseReal = this.real();
  }
}
