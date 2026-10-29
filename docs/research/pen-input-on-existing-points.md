# Pen input on existing points

Question: with a drawing tool active, what does a pen stroke that starts on an existing point, endpoint, or node do, and how does the author move that point without leaving the tool? The user required the answer to come from iPadOS interaction patterns and prior art.

## Platform rules

- Apple Pencil makes a mark on contact. Apps must not require a button or mode before a mark, and Pencil content is manipulated directly ([HIG: Apple Pencil and Scribble](https://developer.apple.com/design/human-interface-guidelines/apple-pencil-and-scribble)).
- Pencil double tap and squeeze follow the user's system setting ([UIPencilInteraction](https://developer.apple.com/documentation/uikit/uipencilinteraction), [preferredTapAction](https://developer.apple.com/documentation/uikit/uipencilinteraction/preferredtapaction)). The HIG advises against using double tap to modify content; squeeze must be nondestructive and easy to undo.
- Hover predicts what a touch will do and never starts an action ([hover support](https://developer.apple.com/documentation/uikit/adopting-hover-support-for-apple-pencil)).
- The pencil draws; fingers navigate unless the user allows finger drawing ([PKCanvasViewDrawingPolicy](https://developer.apple.com/documentation/pencilkit/pkcanvasviewdrawingpolicy/default), [prefersPencilOnlyDrawing](https://developer.apple.com/documentation/uikit/uipencilinteraction/prefersPencilOnlyDrawing)).

## Prior art

| App | Pen touch on an existing point with a drawing tool | Moving a point without changing tool |
| --- | --- | --- |
| Affinity Designer for iPad | Tap the end node to continue the curve; tap the start node to close it | Hold a finger modifier with the other hand and drag the node ([help](https://affinity.help/designer2ipad/en-US.lproj/pages/CurvesShapes/draw_linesAndShapes.html), [modifiers](https://affinity.help/designeripad/en-US.lproj/pages/Workspace/onscreenModifiers.html)) |
| Illustrator for iPad | Pen tool uses the point | Touch shortcut held by the other hand ([help](https://helpx.adobe.com/illustrator/ipad/draw-and-edit-objects/draw-edit-on-ipad.html)); on-screen double tap toggles corner and curve |
| Linearity Curve | New points extend the path from its end node; the other endpoint closes it ([guide](https://www.linearity.io/academy/curve/ipad/user-guide/vector-editing/drawing-tools/)) | Double tap on the end node finishes the path |
| Concepts | — | Tap and hold anywhere activates selection, with a configurable delay ([manual](https://concepts.app/en/ios/manual/selection)) |
| GeoGebra | A construction tap on an existing point uses that point ([guide](https://cemc1.uwaterloo.ca/~math600/wp/G-0)) | — |
| tldraw, Freeform, OmniGraffle, Excalidraw | An arrow end over a shape binds to it, with a visible target ([tldraw](https://tldraw.dev/examples/arrow-binding-options), [Freeform](https://support.apple.com/guide/iphone/ipha089f35ce/ios), [Excalidraw](https://github.com/excalidraw/excalidraw/pull/7946)) | Drag the bound endpoint |

Holding the pen still at the end of a stroke is the established shape-recognition gesture in Apple Notes, Procreate QuickShape, Goodnotes, and Nebo ([Apple](https://support.apple.com/108919), [QuickShape](https://help.procreate.com/procreate/handbook/guides/quickshape), [Nebo](https://help.myscript.com/nebo/create-content/diagrams)).

## Policy derived from the survey

No surveyed app moves a point on a plain pen touch while a drawing tool is active. On-screen double tap already means finish path or toggle corner, and Pencil double tap belongs to the system setting, so neither moves points.

1. A pen stroke that starts on a point draws immediately and attaches its start to that point. Leaving the point before lift is still a stroke, attached at the start. The end of the stroke attaches by the same rule.
2. A finger held by the other hand is the move modifier: while it is down, a pen drag on a point moves the point. A pen held still on a point past a configurable delay (about 400–500 ms, shown by a filling ring) also moves it; pen motion before the delay keeps the gesture a stroke.
3. Fingers pan, zoom, and modify. Finger drawing is an explicit setting. Pencil double tap and squeeze follow the system preference.
4. Hover and an in-stroke target mark show the attachment target before commit. The move state changes the mark.
5. One gesture is one undo step: a stroke with its attachments, or a point move with the update of every attached object.

Unverified: Safari's `pointerType: "pen"` and hover events on a physical iPad ([WebKit 193945](https://bugs.webkit.org/show_bug.cgi?id=193945), [WebKit 296943](https://bugs.webkit.org/show_bug.cgi?id=296943)). The physical-tablet session confirms them.
