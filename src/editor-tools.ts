export const EDITOR_TOOLS = [
  { mode: "select", label: "Select", icon: "pi pi-arrow-up-left" },
  { mode: "magnify", label: "Zoom", icon: "pi pi-search" },
  { mode: "addFreehand", label: "Draw", icon: "pi pi-pencil" },
  { mode: "addLine", label: "Line", icon: "pi pi-minus" },
  { mode: "addArrow", label: "Arrow", icon: "pi pi-arrow-right" },
  { mode: "addNode", label: "Node", icon: "pi pi-circle" },
  { mode: "addPoint", label: "Point", icon: "pi pi-circle-fill" },
  { mode: "addImage", label: "Image", icon: "pi pi-image" },
  { mode: "addCircle", label: "Circle", icon: "pi pi-stop" },
  { mode: "addRect", label: "Rectangle", icon: "pi pi-stop" },
  { mode: "addEllipse", label: "Ellipse", icon: "pi pi-circle" },
  { mode: "addArc", label: "Arc", icon: "pi pi-replay" },
  { mode: "addPath", label: "Path", icon: "pi pi-share-alt" },
  { mode: "addBezier", label: "Bezier", icon: "pi pi-share-alt" },
  { mode: "addShape", label: "Shape", icon: "pi pi-objects-column" },
  { mode: "addMatrix", label: "Matrix", icon: "pi pi-table" },
  { mode: "addGrid", label: "Grid", icon: "pi pi-th-large" },
  { mode: "addBucket", label: "Fill", icon: "pi pi-palette" },
] as const;

export type EditorToolMode = (typeof EDITOR_TOOLS)[number]["mode"];

export interface EditorShapeOption {
  value: string;
  label: string;
}
