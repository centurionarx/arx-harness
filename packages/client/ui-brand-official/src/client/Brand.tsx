import { BrandMark, BrandWordmark } from '@arx-ai/arx-client-ui-primitives'
import type { HeroBrandMarkOwnerProps, HeroBrandNameOwnerProps } from '@arx-ai/arx-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@arx-ai/arx-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official brand mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <BrandMark size={size} className={className} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark />
}

/**
 * Render the official name artwork at the height the new-session headline requests.
 * @param props - Host-supplied name presentation.
 * @returns the official name wordmark.
 */
export function OfficialHeroBrandName({ size, className }: HeroBrandNameOwnerProps) {
  return <BrandWordmark size={size} className={className} />
}
