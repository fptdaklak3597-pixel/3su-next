/**
 * Checkout facade: authoritative path when enabled, else legacy local confirmSale.
 */
import type { CheckoutInput, CheckoutResult } from '../domain/sales-core'
import { confirmSale as confirmSaleCore } from '../domain/sales-core'
import { reconcileProductBatchProjections } from '../domain/batchProjection'
import {
  confirmSaleAuthoritative,
  getShopIdForCommands,
  type SaleCommandInput,
} from '../authoritative/saleCommands'
import { isAuthoritativeMoneyStockEnabled, saleUiBanner } from '../authoritative/flag'
import { getCurrentUser } from '../db-core'
import { getMeta } from '../db'
import { getCloudShopId } from '../sync/cloud'
import { logError } from '../errorLogger'
import { postShopCommand, queueEinvoiceFromSale } from './cloudApi'
import { saleFromAuthoritativePayload, type AuthoritativeSalePayload } from './saleMapper'
import { clearDraft, DRAFT_CART } from '../domain/drafts'
import type { Sale } from '../types'

export type ConfirmCheckoutResult =
  | { status: 'committed'; sale: Sale; warnings: string[] }
  | { status: 'pending'; commandId: string; banner: string }

async function confirmSaleLocal(input: CheckoutInput): Promise<ConfirmCheckoutResult> {
  const result: CheckoutResult = await confirmSaleCore(input)
  await reconcileProductBatchProjections(result.sale.items.map((it) => it.productId))
  return { status: 'committed', sale: result.sale, warnings: result.warnings }
}

export async function confirmCheckout(input: CheckoutInput): Promise<ConfirmCheckoutResult> {
  const authoritative = await isAuthoritativeMoneyStockEnabled()
  if (!authoritative) {
    return confirmSaleLocal(input)
  }

  const user = await getCurrentUser()
  if (!user) throw new Error('Chưa đăng nhập')

  const shopId = await getShopIdForCommands()
  const cmdInput: SaleCommandInput = {
    shopId,
    userId: user.id,
    items: input.items.map((it) => ({
      productId: it.productId,
      qty: it.qty,
      unitName: it.unitName,
    })),
    discountRequest: input.discount,
    payMethod: input.payMethod,
    tendered: input.tendered,
    customerId: input.customerId ?? undefined,
    wholesale: input.wholesale,
  }

  const online = typeof navigator !== 'undefined' && navigator.onLine
  const auth = await confirmSaleAuthoritative(cmdInput, postShopCommand, { online })
  if (!auth.canFinalizeUi || auth.outcome === 'pending') {
    return {
      status: 'pending',
      commandId: auth.commandId,
      banner: auth.banner || saleUiBanner('pending'),
    }
  }

  const committed = auth.result?.events?.find((e) => e.type === 'SaleCommitted')
  if (!committed?.payload) throw new Error('Không có SaleCommitted từ cloud')

  const sale = saleFromAuthoritativePayload(
    committed.payload as AuthoritativeSalePayload,
    input.tendered,
  )
  await clearDraft(DRAFT_CART)
  return { status: 'committed', sale, warnings: [] }
}


export async function maybeQueueEinvoiceForSale(sale: Sale): Promise<void> {
  try {
    const auto = await getMeta('einvoice:autoIssue', false)
    if (!auto) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    const shopId = await getCloudShopId()
    if (!shopId) return
    await queueEinvoiceFromSale({
      sale: {
        saleId: sale.id,
        shopId,
        total: sale.total,
        occurredAt: sale.date,
        items: sale.items.map((it) => ({
          productId: it.productId,
          name: it.name,
          qty: it.qty,
          price: it.price,
          unit: it.unit,
        })),
        payMethod: sale.payMethod,
        customerId: sale.customerId || undefined,
      },
    })
    void import('./sdk').then((m) => m.processEinvoiceJobs(5)).catch((e) => { logError(e, 'einvoice.queue') })
  } catch (e) {
    logError(e, 'einvoice.queue')
  }
}
