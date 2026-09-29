// The expand/collapse toggle shared by the height-capped block primitives
// (TerminalBlock, ReadBlock, DiffBlock, SearchBlock): a button between the head
// and tail slices that names the hidden rows while capped and collapses them
// again once expanded. The owning block keeps the expanded state and slices its
// own rows; this renders the control and its accessible name.

/** Copy for the cap toggle; each capped block's labels extend it. */
export interface CapToggleLabels {
  /** Collapse-toggle aria label while expanded. */
  collapseAria: string
  /** Collapse-toggle text while expanded. */
  collapse: string
  /** Expand-toggle aria label while capped, given the hidden row count. */
  expandAria: (hidden: number) => string
  /** Expand-toggle text while capped, given the hidden row count. */
  expand: (hidden: number) => string
}

/**
 * Render the toggle for a capped block's hidden middle.
 * @param props.className - the owning block's toggle class.
 * @param props.expanded - whether the block currently shows every row.
 * @param props.hidden - the row count the cap hides while collapsed.
 * @param props.labels - the owning block's resolved copy.
 * @param props.onToggle - flips the owning block's expanded state.
 * @returns the toggle button.
 */
export function CapToggle({ className, expanded, hidden, labels, onToggle }: {
  className: string | undefined
  expanded: boolean
  hidden: number
  labels: CapToggleLabels
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={className}
      aria-expanded={expanded}
      aria-label={expanded ? labels.collapseAria : labels.expandAria(hidden)}
      onClick={onToggle}
    >
      {expanded ? labels.collapse : labels.expand(hidden)}
    </button>
  )
}
