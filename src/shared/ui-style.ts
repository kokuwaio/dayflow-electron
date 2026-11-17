// The window's visual theme: upstream Dayflow's look or the flat "Modern" one.
// styles.css switches its tokens on `data-ui-style` on the root element.

export const UI_STYLES = ['dayflow', 'modern'] as const
export type UiStyle = (typeof UI_STYLES)[number]

/** A stored or requested style, or the Dayflow look when it is unknown. */
export function sanitizeUiStyle(value: unknown): UiStyle {
  return (UI_STYLES as readonly unknown[]).includes(value) ? (value as UiStyle) : 'dayflow'
}

/** The colour the window shows before the page paints: each style's window background. */
export function windowBackground(style: UiStyle, dark: boolean): string {
  if (style === 'modern') return dark ? '#0E0F12' : '#F7F7F8'
  return dark ? '#303C5B' : '#FFE6E0'
}
