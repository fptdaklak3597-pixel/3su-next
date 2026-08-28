import type {
  EInvoiceProvider,
  ProviderArtifactQuery,
  ProviderArtifacts,
  ProviderAdjustmentRequest,
  ProviderConnectionInput,
  ProviderConnectionResult,
  ProviderInvoiceRequest,
  ProviderIssueResult,
  ProviderPreviewResult,
  ProviderReadinessInput,
  ProviderReadinessResult,
  ProviderReplacementRequest,
  ProviderSendEmailRequest,
  ProviderSendEmailResult,
  ProviderStatusQuery,
  ProviderStatusResult,
  ProviderTemplate,
  ProviderTemplateQuery,
} from '../provider/contract.js';
import type { ProviderRefId } from '../core/contracts.js';

export type MockScenario =
  | 'success'
  | 'token_expired'
  | 'timeout_before_receive'
  | 'timeout_after_receive'
  | 'duplicate_ref'
  | 'tax_pending_then_issued'
  | 'tax_rejected'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_template';

interface RefState {
  scenario: MockScenario;
  received: boolean;
  issued: boolean;
  transactionId?: string;
}

/**
 * In-memory MISA simulator for contract/orchestration tests.
 */
export class MockMisaProvider implements EInvoiceProvider {
  private readonly refs = new Map<string, RefState>();
  private readonly defaultScenario: MockScenario = 'success';

  constructor(private readonly scenarioForNewRef: MockScenario = 'success') {}

  setScenario(providerRefId: ProviderRefId, scenario: MockScenario): void {
    const cur = this.refs.get(providerRefId) ?? {
      scenario,
      received: false,
      issued: false,
    };
    this.refs.set(providerRefId, { ...cur, scenario });
  }

  async connect(input: ProviderConnectionInput): Promise<ProviderConnectionResult> {
    return { connected: true, provider: input.provider };
  }

  async readiness(_input: ProviderReadinessInput): Promise<ProviderReadinessResult> {
    return {
      ready: true,
      checks: [{ key: 'mock', ok: true }],
    };
  }

  async listTemplates(_input: ProviderTemplateQuery): Promise<readonly ProviderTemplate[]> {
    return [
      {
        templateId: 'mock-mtt-1',
        series: '2C26TAA',
        displayName: 'Hóa đơn bán hàng MTT (mock)',
        active: true,
      },
    ];
  }

  async preview(_input: ProviderInvoiceRequest): Promise<ProviderPreviewResult> {
    return { ok: true, previewReference: 'mock-preview' };
  }

  async issue(input: ProviderInvoiceRequest): Promise<ProviderIssueResult> {
    const ref = input.invoice.providerRefId ?? `mock-ref-${input.invoice.invoiceId}`;
    const state = this.refs.get(ref) ?? {
      scenario: this.scenarioForNewRef,
      received: false,
      issued: false,
    };

    if (state.scenario === 'duplicate_ref' && state.received) {
      return {
        accepted: false,
        providerRefId: ref,
        error: {
          category: 'conflict',
          retry: 'non_retryable',
          code: 'DUPLICATE_REF',
          message: 'RefID đã tồn tại',
        },
      };
    }

    if (state.scenario === 'token_expired') {
      return {
        accepted: false,
        providerRefId: ref,
        error: {
          category: 'auth_failed',
          retry: 'retryable',
          code: 'TOKEN_EXPIRED',
          message: 'Token hết hạn',
        },
      };
    }

    if (state.scenario === 'timeout_before_receive') {
      throw new Error('MOCK_TIMEOUT_BEFORE_RECEIVE');
    }

    state.received = true;
    const txId = `misa-tx-${ref.slice(0, 8)}`;
    state.transactionId = txId;

    if (state.scenario === 'timeout_after_receive') {
      throw new Error('MOCK_TIMEOUT_AFTER_RECEIVE');
    }

    if (state.scenario === 'rate_limited') {
      return {
        accepted: false,
        providerRefId: ref,
        error: {
          category: 'provider_rate_limited',
          retry: 'retryable',
          code: '429',
          message: 'Rate limited',
        },
      };
    }

    if (state.scenario === 'server_error') {
      return {
        accepted: false,
        providerRefId: ref,
        error: {
          category: 'provider_unavailable',
          retry: 'retryable',
          code: '500',
          message: 'Server error',
        },
      };
    }

    if (state.scenario === 'invalid_template') {
      return {
        accepted: false,
        providerRefId: ref,
        error: {
          category: 'provider_rejected',
          retry: 'non_retryable',
          code: 'INVALID_TEMPLATE',
          message: 'Mẫu không hợp lệ',
        },
      };
    }

    this.refs.set(ref, state);
    return {
      accepted: true,
      providerRefId: ref,
      providerTransactionId: txId,
    };
  }

  async status(input: ProviderStatusQuery): Promise<ProviderStatusResult> {
    const state = this.refs.get(input.providerRefId);
    if (!state?.received) {
      return { status: 'unknown' };
    }
    if (state.scenario === 'tax_rejected') {
      return {
        status: 'rejected',
        providerTransactionId: state.transactionId,
        error: {
          category: 'provider_rejected',
          retry: 'non_retryable',
          code: 'CQT_REJECT',
          message: 'CQT từ chối',
        },
      };
    }
    if (state.scenario === 'tax_pending_then_issued' && !state.issued) {
      return {
        status: 'pending',
        providerTransactionId: state.transactionId,
      };
    }
    state.issued = true;
    this.refs.set(input.providerRefId, state);
    return {
      status: 'issued',
      providerTransactionId: state.transactionId,
      invoiceNumber: '0000001',
      series: '2C26TAA',
      taxAuthorityCode: 'MOCK-CQT-CODE',
    };
  }

  async replace(_input: ProviderReplacementRequest): Promise<ProviderIssueResult> {
    return {
      accepted: true,
      providerRefId: `replace-${crypto.randomUUID()}`,
      providerTransactionId: 'misa-tx-replace',
    };
  }

  async adjust(_input: ProviderAdjustmentRequest): Promise<ProviderIssueResult> {
    return {
      accepted: true,
      providerRefId: `adjust-${crypto.randomUUID()}`,
      providerTransactionId: 'misa-tx-adjust',
    };
  }

  async download(_input: ProviderArtifactQuery): Promise<ProviderArtifacts> {
    const xml = new TextEncoder().encode('<Invoice>mock</Invoice>');
    const pdf = new TextEncoder().encode('%PDF-mock');
    return { xml, pdf };
  }

  async sendEmail(_input: ProviderSendEmailRequest): Promise<ProviderSendEmailResult> {
    return { sent: true };
  }
}
