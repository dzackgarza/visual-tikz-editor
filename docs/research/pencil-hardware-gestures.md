# Pencil hardware gestures in iPadOS Safari

Question: can the editor, running as a web page in iPadOS Safari, receive Apple Pencil double tap and squeeze, so that they follow the user's system setting as native apps do?

## Evidence

- Double tap and squeeze reach an app only through `UIPencilInteraction` (UIKit) or the SwiftUI equivalents, with a delegate that reads the user's preferred action ([Apple Pencil interactions](https://developer.apple.com/documentation/uikit/apple-pencil-interactions), [UIPencilInteraction](https://developer.apple.com/documentation/uikit/uipencilinteraction), [handling squeezes](https://developer.apple.com/documentation/applepencil/handling-squeezes-from-apple-pencil)).
- WebKit, the engine of every iPadOS browser, does not use `UIPencilInteraction`: a search of the WebKit source on 2026-10-30 found no match for `UIPencilInteraction` or `PencilInteraction`. The same search finds `WKContentView`, so the index covers the iOS sources.
- No web specification defines a stylus double tap or squeeze event. Pointer Events report pen contact, pressure, tilt, and hover only.
- WebKit tracks the Pencil Pro barrel roll as an unimplemented request ([WebKit 296943](https://bugs.webkit.org/show_bug.cgi?id=296943), status NEW). Pen pointer events and hover exist ([WebKit 193945](https://bugs.webkit.org/show_bug.cgi?id=193945), resolved).

## Result

This is a platform limit. A web page in iPadOS Safari cannot receive Pencil double tap or squeeze, so the editor cannot map them. The eraser and the tool changes stay on the rail, where the pen and a finger reach them. If the editor is later wrapped in a native shell, that shell owns a `UIPencilInteraction` and forwards the preferred action as an embed command. The physical-tablet session confirms that double tap and squeeze do nothing on the canvas.
