/**
 * web domain zod schemas (names derived from map keys: webProvidersRequestSchema /
 * webProvidersValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { WebProviderView, WebSelectionView } from './web.ts'

/** WebProviderView row of web.providers. */
export const webProviderViewSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  settingsNs: z.string(),
  settingsPath: z.array(z.string()),
  available: z.boolean(),
}) satisfies z.ZodType<Wire<WebProviderView>>

/** WebSelectionView of web.providers. */
export const webSelectionViewSchema = z.object({
  configured: z.string().min(1).optional(),
  effective: z.string().min(1).optional(),
  failure: z.enum([
    'WEB_PROVIDER_CONFIGURED_MISSING',
    'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
    'WEB_PROVIDER_UNAVAILABLE',
    'WEB_PROVIDER_AMBIGUOUS',
  ]).optional(),
}) satisfies z.ZodType<Wire<WebSelectionView>>

/** web.providers request payload. */
export const webProvidersRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'web.providers'>>>

/** web.providers response value. */
export const webProvidersValueSchema = z.object({
  providers: z.array(webProviderViewSchema),
  selection: webSelectionViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'web.providers'>>>
