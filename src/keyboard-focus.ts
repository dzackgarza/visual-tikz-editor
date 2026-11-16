/**
 * The keyboard focus of the window when an editor view has loaded its document.
 *
 * A window that opens has the focus on its body, and a press on a button leaves the focus where
 * it is (`button-focus.ts`), so without this the keys reach no editor until a press on the canvas.
 * The view on screen takes the focus when no control has it; a control that has it, such as the
 * source pane during typing, keeps it.
 */
export function focusLoadedFrame(frame: HTMLIFrameElement | null): void {
  if (frame === null || !frame.checkVisibility({ visibilityProperty: true })) {
    return;
  }
  const focused = document.activeElement;
  if (focused !== null && focused !== document.body) {
    return;
  }
  focusFrame(frame);
}

/**
 * Gives the keyboard focus to the document of a frame. Focus on the frame's element alone leaves
 * the keys in this window when the frame's document lost the focus to another frame before.
 */
export function focusFrame(frame: HTMLIFrameElement): void {
  frame.focus();
  frame.contentWindow?.focus();
}
