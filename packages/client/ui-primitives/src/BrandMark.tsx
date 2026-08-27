// arx brand mark: the eye-and-shield symbol, 253x136 native. Raster, embedded
// as a data URI per theme — the supplied artwork is a PNG, and no vector of it
// exists. Swapping in a vector later replaces this module's CSS and nothing
// else, because the mark's size contract lives here.

import type { IconProps } from './icons/props.ts'
import css from './BrandMark.module.css'

/** Native artwork proportion, from the 253x136 source. */
const ASPECT = 253 / 136

/**
 * Render the brand mark.
 * @param props.size - width in px (default 24; height keeps the 253:136 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the mark element (aria-hidden; pair with the wordmark for accessibility).
 */
export function BrandMark({ size = 24, className }: IconProps) {
  return (
    <span
      className={className === undefined ? css.mark : `${css.mark} ${className}`}
      style={{ width: `${String(size)}px`, height: `${String(size / ASPECT)}px` }}
      aria-hidden="true"
    />
  )
}
