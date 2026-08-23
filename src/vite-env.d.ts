/// <reference types="vite/client" />

declare const __APP_NAME__: 'web' | 'mobile' | 'admin'
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_FIREBASE_API_KEY?: string
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string
  readonly VITE_FIREBASE_PROJECT_ID?: string
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string
  readonly VITE_FIREBASE_APP_ID?: string
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Types for GIS helpers — kept out of functions/ so Pages Wrangler does not bundle .d.ts */
declare module '*gis-core.js' {
  export const GIS_CSRF_COOKIE: string
  export const GIS_STORAGE_KEY: string
  export const MAX_GIS_POST_BYTES: number
  export const MAX_GIS_CREDENTIAL_LENGTH: number
  export const MAX_GIS_CSRF_LENGTH: number

  export interface GisSubmissionInput {
    credential?: string | null
    bodyCsrf?: string | null
    cookieHeader?: string | null
  }

  export type GisSubmissionResult =
    | { ok: true; status: 200; credential: string }
    | { ok: false; status: number; message: string }

  export function cookieValue(cookieHeader: string | null | undefined, name: string): string
  export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean
  export function isGisCredential(value: string | null | undefined): boolean
  export function validateGisSubmission(input: GisSubmissionInput): GisSubmissionResult
  export function randomNonce(): string
  export function gisCallbackPage(credential: string, nonce: string): string
  export function gisErrorPage(message: string): string
  export function gisResponseHeaders(nonce?: string): Record<string, string>
}
