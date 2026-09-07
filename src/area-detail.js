// Lifecycle for one area's optional detail. The base model is always available;
// all time values are monotonic seconds supplied by the scene (or tests).
export class AreaDetail {
  constructor({ base, load, cacheSeconds = 30, onError = console.warn }) {
    this.base = base;
    this.load = load;
    this.cacheSeconds = cacheSeconds;
    this.onError = onError;
    this.detail = null;
    this.pending = null;
    this.wanted = false;
    this.lastWanted = -Infinity;
    this.now = 0;
    this.level = 0;
    this.retryAt = 0;
    this.failures = 0;
    this.disposed = false;
  }

  update({ enter, retain }, level, now) {
    if (this.disposed) return;
    this.now = now;
    if (Number.isFinite(level)) this.level = level;
    this.wanted = enter || (this.wanted && retain);
    if (this.wanted) this.lastWanted = now;
    if (!this.wanted && this.detail && now - this.lastWanted >= this.cacheSeconds) {
      this.detail.dispose();
      this.detail = null;
    }
    this.present();
    if (this.wanted && !this.detail && !this.pending && now >= this.retryAt) {
      this.pending = Promise.resolve().then(() => this.load(this.failures)).then(detail => {
        // A slow request may finish long after a jump away, or after shutdown.
        if (this.disposed || (!this.wanted && this.now - this.lastWanted >= this.cacheSeconds)) {
          detail.dispose();
          return;
        }
        this.detail = detail;
        this.failures = 0;
        this.present();
      }).catch(error => {
        if (this.disposed) return;
        this.failures++;
        this.retryAt = this.now + Math.min(60, 10 * 2 ** Math.min(this.failures - 1, 3));
        this.onError(error);
      }).finally(() => { this.pending = null; });
    }
  }

  present() {
    const active = this.wanted && this.detail;
    if (active) this.detail.update(this.level);
    else this.base.update(this.level);
    // Apply the current tide before showing either representation.
    this.base.group.visible = !active;
    if (this.detail) this.detail.group.visible = !!active;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detail?.dispose();
    this.detail = null;
    this.base.dispose();
  }
}
