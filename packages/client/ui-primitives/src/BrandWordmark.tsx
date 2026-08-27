// arx brand wordmark: the product name in two blues, followed by the HARNESS
// plate. Native 180x34, with the word occupying 28px of that height — twice
// the 14px the previous letterforms drew. Both texts pin `textLength`, so a
// font fallback changes the glyph shapes but never the artwork's footprint.

import type { IconProps } from './icons/props.ts'
import css from './BrandWordmark.module.css'

const FACE = "'Inter', 'Helvetica Neue', Arial, sans-serif"

/**
 * Render the brand wordmark.
 * @param props.size - height in px (default 34; width follows the artwork).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 34, className }: IconProps) {
  return (
    <svg
      width={(size * 180) / 34}
      height={size}
      className={className}
      viewBox="0 0 180 34"
      fill="none"
      aria-hidden="true"
    >
      <text
        x="0"
        y="31"
        textLength="80"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={FACE}
        fontSize="54"
        fontWeight="700"
        letterSpacing="-2"
      >
        <tspan className={css.a}>a</tspan>
        <tspan className={css.rx}>rx</tspan>
      </text>
      <rect className={css.plate} x="95" y="7" width="84" height="20" rx="3" />
      <text
        className={css.plateLabel}
        x="105"
        y="21.5"
        textLength="64"
        lengthAdjust="spacingAndGlyphs"
        fontFamily={FACE}
        fontSize="13"
        fontWeight="700"
        letterSpacing="1.4"
      >
        HARNESS
      </text>
    </svg>
  )
}
