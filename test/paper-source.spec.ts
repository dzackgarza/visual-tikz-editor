import { strict as assert } from 'node:assert';
import { strokeEnvelope } from '../vendor/tikz-editor/embed/src/original-ink';
import { paperSource } from '../src/paper-source';

describe('paper TikZ projection', function () {
  it('keeps the drawn geometry and removes private sample records', function () {
    const source = '\\begin{tikzpicture}\n' + strokeEnvelope({
      key: 'stroke-1', intent: 'geometry', color: '#000000',
      samples: [{ x: 0, y: 0, time: 0 }, { x: 1, y: 1, time: 1 }],
    }, '\\draw (0,0) -- (1,1);') + '\\end{tikzpicture}\n';
    assert.equal(paperSource(source), '\\begin{tikzpicture}\n\\begin{scope}\n\\draw (0,0) -- (1,1);\n\\end{scope}\n\\end{tikzpicture}\n');
    assert.equal(paperSource('\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}'),
      '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}');
  });
});
