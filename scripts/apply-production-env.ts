/**
 * `--mode mobile|admin` chọn app, không phải môi trường Vite.
 * Bản `vite build` vẫn phải lấy VITE_* từ .env.production.
 */
export function applyProductionEnvForAppBuild(
  command: string,
  mode: string,
  env: Record<string, string>,
  production: Record<string, string>,
): Record<string, string> {
  if (command !== 'build' || (mode !== 'mobile' && mode !== 'admin')) return env
  const next = { ...env }
  for (const [key, value] of Object.entries(production)) {
    if (!key.startsWith('VITE_') || !value) continue
    if (!next[key]) next[key] = value
  }
  return next
}
