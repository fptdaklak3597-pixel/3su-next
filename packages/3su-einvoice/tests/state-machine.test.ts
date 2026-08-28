import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  isImmutableFiscalState,
} from '../src/core/state-machine.js';

describe('invoice state machine', () => {
  it('allows happy path to issued', () => {
    const path = [
      'draft',
      'ready',
      'queued',
      'submitting',
      'provider_received',
      'tax_pending',
      'issued',
    ] as const;
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1]!;
      const to = path[i]!;
      expect(canTransition(from, to)).toBe(true);
      expect(assertTransition(from, to)).toBe(to);
    }
  });

  it('blocks draft to issued directly', () => {
    expect(canTransition('draft', 'issued')).toBe(false);
  });

  it('marks issued as immutable fiscal state', () => {
    expect(isImmutableFiscalState('issued')).toBe(true);
    expect(isImmutableFiscalState('draft')).toBe(false);
  });

  it('allows issued to correction markers', () => {
    expect(canTransition('issued', 'replaced')).toBe(true);
    expect(canTransition('issued', 'adjusted')).toBe(true);
  });
});
