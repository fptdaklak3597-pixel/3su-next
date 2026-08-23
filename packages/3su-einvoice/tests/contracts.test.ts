import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_RESULTS,
  DOCUMENT_KINDS,
  ERROR_CATEGORIES,
  INVOICE_EVENT_TYPES,
  INVOICE_STATES,
  RETRY_CLASSIFICATIONS,
} from '../src/index.js';

describe('3su-einvoice canonical contracts', () => {
  it('keeps invoice lifecycle literals stable', () => {
    expect(INVOICE_STATES).toEqual([
      'draft',
      'ready',
      'queued',
      'submitting',
      'provider_received',
      'tax_pending',
      'issued',
      'rejected',
      'manual_review',
      'replaced',
      'adjusted',
      'return_adjusted',
    ]);
  });

  it('keeps fiscal document kinds stable', () => {
    expect(DOCUMENT_KINDS).toEqual([
      'original',
      'replacement',
      'adjustment',
      'return_adjustment',
    ]);
  });

  it('keeps compliance outcomes stable', () => {
    expect(COMPLIANCE_RESULTS).toEqual([
      'receipt_only',
      'voluntary_einvoice',
      'mandatory_einvoice',
      'manual_review',
    ]);
  });

  it('keeps error and retry taxonomies independent', () => {
    expect(ERROR_CATEGORIES).toContain('ambiguous_provider_result');
    expect(RETRY_CLASSIFICATIONS).toEqual([
      'retryable',
      'non_retryable',
      'ambiguous_reconcile_first',
      'manual_review',
    ]);
  });

  it('publishes lifecycle event names without provider names', () => {
    expect(INVOICE_EVENT_TYPES).toContain('invoice.issued');
    expect(INVOICE_EVENT_TYPES.every((event) => !event.toLowerCase().includes('misa'))).toBe(true);
  });
});
