export {}

declare global {
  interface SubtleCrypto {
    deriveBits(
      algorithm: {
        name: 'PBKDF2'
        hash: AlgorithmIdentifier
        salt: Uint8Array<ArrayBufferLike>
        iterations: number
      },
      baseKey: CryptoKey,
      length?: number | null,
    ): Promise<ArrayBuffer>
  }
}
