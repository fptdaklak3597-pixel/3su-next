/**
 * MISA meInvoice HTTP client skeleton — wire URLs when sandbox credentials exist.
 * Phase 5: replace stubs with real endpoints from MISA Postman.
 */
export interface MisaEnv {
  readonly baseUrl: string;
  readonly appId: string;
}

export const MISA_SANDBOX_BASE = 'https://api.meinvoice.vn/api/v3';

export function resolveMisaEnv(env: Record<string, string | undefined>): MisaEnv | null {
  const appId = env.MISA_APP_ID?.trim();
  if (!appId) return null;
  return {
    baseUrl: env.MISA_API_BASE?.trim() || MISA_SANDBOX_BASE,
    appId,
  };
}

export async function misaAuthToken(
  env: MisaEnv,
  username: string,
  password: string,
): Promise<{ token: string; expiresAt: number }> {
  // Phase 5: POST /auth/token with app_id
  void env;
  void username;
  void password;
  throw new Error('MISA sandbox chưa cấu hình — cần MISA_APP_ID và credential shop');
}
