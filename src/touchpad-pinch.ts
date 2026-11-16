/**
 * The pinch on a touchpad that the desktop shell reports to the window's page.
 *
 * WebKitGTK gives a page no event of a pinch on a touchpad: it magnifies the whole page itself.
 * The desktop shell (src-tauri/src/main.rs) takes the pinch before WebKit and sends each of its
 * steps to the window as a `touchpad-pinch` event. Each view of the workbench listens for the
 * event and zooms by the step when the pointer is over it. In a browser a pinch arrives as wheel
 * events with Ctrl, and no such event is sent.
 */

import { z } from "zod";

/** The name of the window event of one step of a pinch. */
export const TOUCHPAD_PINCH = "touchpad-pinch";

const touchpadPinchSchema = z.object({
  /** The distance of the fingers relative to the step before. */
  ratio: z.number().positive(),
  /** The pointer, in the CSS pixels of the window. */
  x: z.number(),
  y: z.number(),
});

export type TouchpadPinchStep = {
  ratio: number;
  /** The pointer relative to the element that the step is over. */
  place: { x: number; y: number };
};

/**
 * The step of `event` when its pointer is over `element`, and null when it is over another part
 * of the window. An element that is not shown has an empty box, so no step is over it.
 */
export function touchpadPinchOver(event: Event, element: Element | null): TouchpadPinchStep | null {
  if (element === null) return null;
  const { ratio, x, y } = touchpadPinchSchema.parse((event as CustomEvent<unknown>).detail);
  const box = element.getBoundingClientRect();
  if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) return null;
  return { ratio, place: { x: x - box.left, y: y - box.top } };
}
