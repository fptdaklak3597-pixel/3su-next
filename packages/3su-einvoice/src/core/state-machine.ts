import type { InvoiceState } from './contracts.js';

const TRANSITIONS: Readonly<Record<InvoiceState, readonly InvoiceState[]>> = {
  draft: ['ready', 'manual_review'],
  ready: ['queued', 'manual_review'],
  queued: ['submitting', 'manual_review'],
  submitting: ['provider_received', 'rejected', 'manual_review'],
  provider_received: ['tax_pending', 'issued', 'rejected', 'manual_review'],
  tax_pending: ['issued', 'rejected', 'manual_review'],
  issued: ['replaced', 'adjusted', 'return_adjusted'],
  rejected: ['manual_review', 'queued'],
  manual_review: ['ready', 'queued', 'rejected'],
  replaced: [],
  adjusted: [],
  return_adjusted: [],
};

/** Fiscal payload fields are immutable once issued; correction states are terminal markers. */
export const IMMUTABLE_FISCAL_STATES: readonly InvoiceState[] = [
  'issued',
  'replaced',
  'adjusted',
  'return_adjusted',
];

export function canTransition(from: InvoiceState, to: InvoiceState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: InvoiceState, to: InvoiceState): InvoiceState {
  if (!canTransition(from, to)) {
    throw new Error(`Chuyển trạng thái hóa đơn không hợp lệ: ${from} → ${to}`);
  }
  return to;
}

export function isImmutableFiscalState(state: InvoiceState): boolean {
  return IMMUTABLE_FISCAL_STATES.includes(state);
}
