/** Deterministic geometric traces in points, including deliberate near misses. */
export type Trace = { name: string; points: [number, number][]; primitive: string; error: number; unchanged?: boolean; intent?: 'ink' };
const sample = (count: number, point: (t: number) => [number, number]) =>
  Array.from({ length: count }, (_, i) => point(i / (count - 1)));
const polygon = (vertices: [number, number][]) => vertices.slice(1).flatMap((end, index) =>
  sample(12, t => [vertices[index][0] + t * (end[0] - vertices[index][0]), vertices[index][1] + t * (end[1] - vertices[index][1])]));

export const geometryTraces: Trace[] = [
  { name: 'open-line', points: sample(35, t => [20 + 100 * t, 40 + .7 * Math.sin(t * 20)]), primitive: ' -- ', error: 2 },
  { name: 'almost-closed-line', points: [[20, 20], [60, 21], [100, 20], [60, 19], [22, 20]], primitive: '\\draw', error: 8 },
  { name: 'rectangle', points: polygon([[20, 20], [120, 20], [120, 90], [20, 90], [20, 21]]), primitive: ' rectangle ', error: 2 },
  { name: 'circle', points: sample(65, t => [80 + 42 * Math.cos(t * 2 * Math.PI), 80 + 42 * Math.sin(t * 2 * Math.PI)]), primitive: ' circle ', error: 2 },
  { name: 'almost-closed-ellipse', points: sample(65, t => [90 + 65 * Math.cos(t * 6.2), 80 + 35 * Math.sin(t * 6.2)]), primitive: ' ellipse ', error: 5 },
  { name: 'open-arc', points: sample(45, t => [80 + 55 * Math.cos(t * Math.PI), 70 + 55 * Math.sin(t * Math.PI)]), primitive: ' controls ', error: 8 },
  { name: 'sharp-corner', points: polygon([[20, 20], [85, 20], [85, 95]]), primitive: '\\draw', error: 8 },
  { name: 'self-intersection', points: sample(80, t => [85 + 60 * Math.sin(t * 2 * Math.PI), 75 + 40 * Math.sin(t * 4 * Math.PI)]), primitive: '\\draw', error: 8 },
  { name: 'irregular-curve', points: sample(65, t => [20 + 140 * t, 75 + 28 * Math.sin(t * 8) + 7 * Math.sin(t * 19)]), primitive: ' controls ', error: 8 },
  { name: 'short-uncertain-stroke', points: [[20, 20], [21, 25], [23, 18]], primitive: '\\draw', error: 0.1, unchanged: true },
  { name: 'handwritten-loop', points: sample(40, t => [65 + 30 * Math.cos(t * 6.2), 75 + 30 * Math.sin(t * 6.2)]), primitive: '\\draw', error: 0.1, unchanged: true, intent: 'ink' },
];
