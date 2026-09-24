import { describe, expect, it } from 'vitest';
import { parseMeasurementEvidence } from '../packages/protocol/src/wire/measurements.js';
import { contextualizeMeasurement } from '../packages/viewer/src/measurements/context.js';
import type { MeasurementCandidate } from '../packages/viewer/src/measurements/geometry.js';

const edge = (key: string, start: [number, number, number], end: [number, number, number]): MeasurementCandidate => ({
  key,
  operand: { kind: 'edge', edgeId: key, start, end },
  anchor: start,
  triIds: key === 'a' ? [1, 2] : [3, 4],
});

describe('measurement evidence context', () => {
  it('records feature identity, the visible primary reading and a deterministic summary', () => {
    const a = edge('a', [0, 0, 0], [10, 0, 0]);
    const b = edge('b', [0, 0, 0], [-5, 5 * Math.sqrt(3), 0]);
    const contextual = contextualizeMeasurement(
      {
        kind: 'relation',
        operands: [a.operand, b.operand],
        distance: { method: 'segment-segment', unit: 'mm', value: 0, start: [0, 0, 0], end: [0, 0, 0] },
        angle: { method: 'edge-corner', unit: 'deg', value: 120 },
      },
      [a, b],
      candidate => (candidate === a ? 'plate#1 top edge' : 'wall#1 side edge'),
    );
    expect(contextual.partLabel).toBe('plate#1 top edge to wall#1 side edge');
    expect(contextual.evidence).toMatchObject({
      operands: [{ feature: 'plate#1 top edge' }, { feature: 'wall#1 side edge' }],
      display: { text: '120°', primary: 'angle' },
      summary: 'Angle 120° between plate#1 top edge and wall#1 side edge.',
    });
    expect(parseMeasurementEvidence(contextual.evidence)).toEqual(contextual.evidence);
    expect(() =>
      parseMeasurementEvidence({
        ...contextual.evidence,
        display: { text: '120°', primary: 'distance' },
      }),
    ).toThrow(/visible angle/);
    expect(() =>
      parseMeasurementEvidence({
        ...contextual.evidence,
        operands: [{ ...contextual.evidence.operands[0], feature: 'x'.repeat(161) }, contextual.evidence.operands[1]],
      }),
    ).toThrow(/feature/);
  });

  it('names supporting-plane semantics and the same rounded reading the user acts on', () => {
    const first: MeasurementCandidate = {
      key: 'first',
      operand: { kind: 'plane', patchId: 1, triangleId: 1, origin: [0, 0, 8], normal: [0, 0, 1] },
      anchor: [0, 0, 8],
      triIds: [1],
    };
    const second: MeasurementCandidate = {
      key: 'second',
      operand: { kind: 'plane', patchId: 2, triangleId: 2, origin: [0, 0, 46], normal: [0, 0, 1] },
      anchor: [0, 0, 46],
      triIds: [2],
    };
    const contextual = contextualizeMeasurement(
      {
        kind: 'relation',
        operands: [first.operand, second.operand],
        distance: { method: 'parallel-gap', unit: 'mm', value: 38.0000003, start: [0, 0, 8], end: [0, 0, 46.0000003] },
        angle: { method: 'plane-plane', unit: 'deg', value: 0 },
      },
      [first, second],
      candidate => (candidate === first ? 'plate#1 top face' : 'wall#1 top face'),
    );
    expect(contextual.evidence).toMatchObject({
      display: { text: '38 mm', primary: 'distance' },
      summary: 'Distance 38 mm between plate#1 top face and wall#1 top face using supporting planes.',
    });
  });

  it('preserves tiny nonzero readings with the same significant formatting as the Viewer', () => {
    const candidate = edge('a', [0, 0, 0], [0.000001, 0, 0]);
    if (candidate.operand.kind !== 'edge') {
      throw new Error('Expected an edge fixture.');
    }
    const contextual = contextualizeMeasurement(
      {
        kind: 'edge-length',
        operands: [candidate.operand],
        distance: {
          method: 'segment-length',
          unit: 'mm',
          value: 0.000001,
          start: [0, 0, 0],
          end: [0.000001, 0, 0],
        },
      },
      [candidate],
      () => 'detail#1 edge',
    );
    expect(contextual.evidence).toMatchObject({
      display: { text: '1E-6 mm', primary: 'distance' },
      summary: 'Length 1E-6 mm of detail#1 edge.',
    });
  });
});
