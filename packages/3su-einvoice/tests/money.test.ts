import { describe, expect, it } from 'vitest';
import { assertIntegerVnd, sumIntegerVnd } from '../src/core/money.js';

describe('money', () => {
  it('assertIntegerVnd accepts non-negative integers', () => {
    expect(assertIntegerVnd(1000)).toBe(1000);
  });

  it('rejects fractional VND', () => {
    expect(() => assertIntegerVnd(10.5)).toThrow();
  });

  it('sums integer VND', () => {
    expect(sumIntegerVnd([100, 200, 300])).toBe(600);
  });
});
