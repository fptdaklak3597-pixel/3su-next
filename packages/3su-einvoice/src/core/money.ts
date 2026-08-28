import type { VndAmount } from './contracts.js';

export function assertIntegerVnd(value: number, label = 'amount'): VndAmount {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} phải là số nguyên VND không âm`);
  }
  return value;
}

export function sumIntegerVnd(values: readonly number[]): VndAmount {
  let total = 0;
  for (const v of values) {
    total += assertIntegerVnd(v);
  }
  return total;
}
