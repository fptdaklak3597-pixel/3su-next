/**
 * Serialize issuance per (shopId, invoiceSeries).
 */
export class SeriesCoordinator {
  private readonly chains = new Map<string, Promise<void>>();

  private key(shopId: string, series: string): string {
    return `${shopId}::${series}`;
  }

  async run<T>(shopId: string, series: string, fn: () => Promise<T>): Promise<T> {
    const k = this.key(shopId, series);
    const prev = this.chains.get(k) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const next = prev.then(() => gate);
    this.chains.set(k, next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.chains.get(k) === next) this.chains.delete(k);
    }
  }
}
