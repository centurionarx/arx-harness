/**
 * Project an error into sanitized UI copy without server messages or credentials.
 * @param cause - Failure from an auth or private-storage operation.
 * @returns Safe translation code for the rendered error.
 */
export function authErrorCode(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) return 'OPERATION_FAILED'
  const code = (cause as { code?: unknown }).code
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'OPERATION_FAILED'
}
