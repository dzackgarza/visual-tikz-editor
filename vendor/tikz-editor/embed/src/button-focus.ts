/**
 * A press on a button leaves the keyboard focus where it is, so the keys go on acting on the
 * canvas after a press on a tool, a colour, a menu item, or a control of the document bar.
 * Safari does this by design (https://bugs.webkit.org/show_bug.cgi?id=22261#c68), and GTK has it
 * as `focus-on-click` (https://docs.gtk.org/gtk4/property.Widget.focus-on-click.html). WebKitGTK
 * and Chromium give a pressed button the focus, which takes the keys from the canvas.
 *
 * A text field that has the focus keeps the browser's behaviour: the press takes the focus, and
 * the field ends its edit.
 */

const BUTTON =
	'button, summary, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="radio"], [role="option"], [role="tab"]';
const TEXT_FIELD = 'input, textarea, select, [contenteditable]';

/** A `mousedown` listener of a window, for the capture phase. */
export function keepFocusAtButtonPress(event: MouseEvent): void {
	if (!(event.target instanceof Element) || event.target.closest(BUTTON) === null) return;
	if (document.activeElement?.closest(TEXT_FIELD)) return;
	event.preventDefault();
}
