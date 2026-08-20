import './types'

declare module './types' {
  interface ProductBatch {
    /** Owning product. Optional only while reading legacy records; all new writes fill it. */
    productId?: string
  }
}
