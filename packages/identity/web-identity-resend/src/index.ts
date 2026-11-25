/**
 * Resend is the sole outbound identity delivery adapter. No ambient API key,
 * token logging, recipient override, webhook or inbox service.
 * @module @arx-ai/arx-web-identity-resend
 */
import { lstat, readFile } from 'node:fs/promises'
import { privateAccessViolation } from '@arx-ai/arx-atomic-write'
import { isAbsolute, basename } from 'node:path'
import type { Context } from '@arx-ai/cordis'
import z from '@arx-ai/schemastery'
import { identityFailure } from '@arx-ai/arx-web-identity'
import type { IdentityDelivery, IdentityDeliveryProvider, IdentityDeliveryResult } from '@arx-ai/arx-web-identity'
export const name = 'web-identity-resend'
export const inject = ['webIdentity']
/**
 * Explicit protected Resend key file and operator-configured sender.
 */
export interface Config {
  /**
   * Absolute protected file containing the operator Resend API key; no inline key or ambient environment lookup is
   * used.
   */
  keyFile: string
  /**
   * Operator-configured Resend sender passed to the private invitation/reset transport.
   */
  from: string
}
export const Config: z<Config> = z.object({ keyFile: z.string().required(), from: z.string().required() })
/** Explicit fetch boundary makes external delivery testable without sending mail. */
export class ResendIdentityDelivery implements IdentityDeliveryProvider {
  constructor(private readonly key: string, private readonly from: string, private readonly fetcher: typeof fetch = fetch) { }
  /**
       * Send a private identity envelope to its registered recipient through the explicit Resend boundary.
       * @param mail - Private invitation or reset envelope.
       * @param signal - Cancels the external HTTP operation.
       * @returns Provider acceptance ID; recipient delivery remains separate.
       */
  async send(mail: IdentityDelivery, signal: AbortSignal): Promise<IdentityDeliveryResult> {
    if (mail.expiresAt <= Date.now())
      identityFailure('AUTH_DELIVERY', 503, 'Identity delivery expired')
    const verb = mail.purpose === 'invitation' ? 'Defina sua senha' : 'Recupere seu acesso'
    const response = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST', signal, headers: { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json',
        'Idempotency-Key': 'arx-identity-' + mail.operationId },
      body: JSON.stringify({ from: this.from, to: [mail.to], subject: verb + ' — CENTURIONarx',
        text: verb + ': ' + mail.link + '\nEste link expira e pode ser usado uma única vez.' }),
    })
    if (!response.ok)
      identityFailure('AUTH_DELIVERY', 503, 'Identity delivery not accepted')
    const body = await response.json() as {
      id?: unknown
    }
    if (typeof body.id !== 'string' || body.id.length === 0 || body.id.length > 128)
      identityFailure('AUTH_DELIVERY', 503, 'Invalid delivery acknowledgement')
    return Object.freeze({ providerId: body.id })
  }
}
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!isAbsolute(config.keyFile) || basename(config.keyFile) === '.env' || /[\r\n]/.test(config.from)
        || !config.from.includes('@'))
    identityFailure('AUTH_CONFIGURATION', 503, 'Private Resend configuration required')
  const info = await lstat(config.keyFile)
  if (!info.isFile() || info.isSymbolicLink())
    identityFailure('AUTH_CONFIGURATION', 503, 'Private Resend key required')
  const violation = await privateAccessViolation(config.keyFile, info, { posixOwner: true })
  if (violation !== undefined)
    identityFailure('AUTH_CONFIGURATION', 503, 'Private Resend key required', violation)
  const key = (await readFile(config.keyFile, 'utf8')).trim()
  if (!/^re_[A-Za-z0-9_-]{10,}$/.test(key))
    identityFailure('AUTH_CONFIGURATION', 503, 'Resend key invalid')
  ctx.effect(() => ctx.webIdentity.registerDelivery(new ResendIdentityDelivery(key, config.from)), 'web-identity-resend: private delivery registration')
}
