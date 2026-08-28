import { describe, expect, it } from 'vitest';
import { IssueInvoiceService } from '../src/application/issue-service.js';
import { MockMisaProvider } from '../src/provider/mock-misa.js';
import type { OutputInvoiceSnapshot } from '../src/core/domain.js';

function sampleInvoice(refId?: string): OutputInvoiceSnapshot {
  return {
    invoiceId: 'inv_test_1',
    shopId: 'shop_1',
    saleId: 'sale_1',
    documentKind: 'original',
    state: 'queued',
    seller: {
      legalName: 'HKD Test',
      taxCode: '0123456789',
      registeredAddress: 'Đắk Lắk',
    },
    buyer: { kind: 'anonymous_retail' },
    items: [
      {
        lineId: '1',
        description: 'Hàng A',
        quantity: 1,
        unitPrice: 10000,
        discountAmount: 0,
        adjustmentAmount: 0,
        lineTotal: 10000,
      },
    ],
    totals: {
      subtotal: 10000,
      discountTotal: 0,
      adjustmentTotal: 0,
      payableTotal: 10000,
      currency: 'VND',
    },
    occurredAt: '2026-08-23T10:00:00.000Z',
    createdAt: '2026-08-23T10:00:00.000Z',
    provider: 'misa',
    providerRefId: refId ?? crypto.randomUUID(),
    complianceDecisionId: 'dec_1',
    policyVersion: 'hk-2026-v1',
    series: '2C26TAA',
  };
}

describe('MockMisaProvider + IssueInvoiceService', () => {
  it('issues successfully', async () => {
    const provider = new MockMisaProvider('success');
    const svc = new IssueInvoiceService(provider);
    const res = await svc.issue(sampleInvoice());
    expect(res.invoice.state).toBe('issued');
    expect(res.invoiceNumber).toBe('0000001');
    expect(res.ambiguous).toBe(false);
  });

  it('tax pending then issued on status poll', async () => {
    const ref = crypto.randomUUID();
    const provider = new MockMisaProvider('tax_pending_then_issued');
    provider.setScenario(ref, 'tax_pending_then_issued');
    const svc = new IssueInvoiceService(provider);
    const res = await svc.issue(sampleInvoice(ref));
    expect(res.invoice.state).toBe('tax_pending');
  });

  it('duplicate ref returns rejected path', async () => {
    const ref = crypto.randomUUID();
    const provider = new MockMisaProvider('duplicate_ref');
    provider.setScenario(ref, 'duplicate_ref');
    const inv = sampleInvoice(ref);
    const svc = new IssueInvoiceService(provider);
    await provider.issue({ invoice: inv });
    const res = await svc.issue(inv);
    expect(res.invoice.state).toBe('rejected');
  });
});
