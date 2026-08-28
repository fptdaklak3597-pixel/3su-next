import type { OutputInvoiceSnapshot } from '../core/domain.js';
import type { EInvoiceProvider } from '../provider/contract.js';
import { assertTransition } from '../core/state-machine.js';
import { SeriesCoordinator } from './series-coordinator.js';

export interface IssueInvoiceResult {
  readonly invoice: OutputInvoiceSnapshot;
  readonly providerTransactionId?: string;
  readonly invoiceNumber?: string;
  readonly series?: string;
  readonly taxAuthorityCode?: string;
  readonly ambiguous: boolean;
}

/**
 * Orchestrate provider issue + status poll (mock/MISA).
 */
export class IssueInvoiceService {
  constructor(
    private readonly provider: EInvoiceProvider,
    private readonly coordinator = new SeriesCoordinator(),
  ) {}

  async issue(invoice: OutputInvoiceSnapshot): Promise<IssueInvoiceResult> {
    const series = invoice.series || 'DEFAULT';
    return this.coordinator.run(invoice.shopId, series, async () => {
      let state = invoice.state;
      state = assertTransition(state, 'submitting');

      const issueRes = await this.provider.issue({ invoice: { ...invoice, state } });
      if (!issueRes.accepted) {
        if (issueRes.error?.retry === 'ambiguous_reconcile_first') {
          return { invoice: { ...invoice, state: 'manual_review' }, ambiguous: true };
        }
        return { invoice: { ...invoice, state: 'rejected' }, ambiguous: false };
      }

      state = assertTransition('submitting', 'provider_received');
      const status = await this.provider.status({
        shopId: invoice.shopId,
        providerRefId: issueRes.providerRefId,
        providerTransactionId: issueRes.providerTransactionId,
      });

      if (status.status === 'issued') {
        state = assertTransition('provider_received', 'tax_pending');
        state = assertTransition(state, 'issued');
        return {
          invoice: { ...invoice, state },
          providerTransactionId: status.providerTransactionId,
          invoiceNumber: status.invoiceNumber,
          series: status.series,
          taxAuthorityCode: status.taxAuthorityCode,
          ambiguous: false,
        };
      }

      if (status.status === 'rejected') {
        return { invoice: { ...invoice, state: 'rejected' }, ambiguous: false };
      }

      return {
        invoice: { ...invoice, state: 'tax_pending' },
        providerTransactionId: status.providerTransactionId,
        ambiguous: false,
      };
    });
  }
}
