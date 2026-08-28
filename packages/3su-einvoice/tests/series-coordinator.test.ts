import { describe, expect, it } from 'vitest';
import { SeriesCoordinator } from '../src/application/series-coordinator.js';

describe('SeriesCoordinator', () => {
  it('runs jobs for same series sequentially', async () => {
    const coord = new SeriesCoordinator();
    const order: number[] = [];
    const p1 = coord.run('s1', '2C26TAA', async () => {
      order.push(1);
      await sleep(20);
      order.push(2);
    });
    const p2 = coord.run('s1', '2C26TAA', async () => {
      order.push(3);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2, 3]);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
