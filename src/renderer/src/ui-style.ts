import type { UiStyle } from '@shared/ui-style'

/** Switches the window's visual theme; styles.css keys its tokens on this attribute. */
export function applyUiStyle(style: UiStyle): void {
  document.documentElement.dataset.uiStyle = style
}
