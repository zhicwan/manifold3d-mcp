import { describe, expect, it } from 'vitest';

import {
  ANNOTATIONS_PROTOCOL_VERSION,
  createAnnotationsMessage,
  MAX_ANNOTATIONS,
  MAX_ANNOTATION_NOTE_LENGTH,
  parseAnnotationsMessage,
  parseWireAnnotation,
} from '../packages/protocol/src/wire/annotations.js';
import {
  createHostActionsManifest,
  HOST_ACTION_PROTOCOL_VERSION,
  parseHostActionsManifest,
} from '../packages/protocol/src/wire/host-actions.js';
import {
  parseMeasurementEvidence,
  measureEdgeCorner,
  type MeasurementEvidence,
  type MeasurementEdge,
  type MeasurementOperand,
} from '../packages/protocol/src/wire/measurements.js';

const edge = { kind: 'edge', edgeId: 'edge-1', start: [0, 0, 0], end: [10, 0, 0] } as const;

function length(): Extract<MeasurementEvidence, { kind: 'edge-length' }> {
  return {
    kind: 'edge-length',
    operands: [{ ...edge, start: [...edge.start], end: [...edge.end] }],
    distance: { method: 'segment-length', unit: 'mm', value: 10, start: [0, 0, 0], end: [10, 0, 0] },
  };
}

function relation(a: MeasurementOperand, b: MeasurementOperand): MeasurementEvidence {
  return { kind: 'relation', operands: [a, b] };
}

describe('measurement wire evidence', () => {
  it('validates 120-degree endpoint corners and preserves legacy smaller-angle semantics', () => {
    const first: MeasurementEdge = { ...edge, start: [0, 0, 0], end: [10, 0, 0] };
    const second: MeasurementEdge = { kind: 'edge', edgeId: 'b', start: [0, 0, 0], end: [-5, 5 * Math.sqrt(3), 0] };
    const evidence = {
      kind: 'relation',
      operands: [first, second],
      distance: { method: 'segment-segment', unit: 'mm', value: 0, start: [0, 0, 0], end: [0, 0, 0] },
      angle: { method: 'edge-corner', unit: 'deg', value: 120 },
    };
    for (const a of [first, { ...first, start: first.end, end: first.start }]) {
      for (const b of [second, { ...second, start: second.end, end: second.start }]) {
        expect(measureEdgeCorner(a, b)?.value).toBeCloseTo(120);
        expect(parseMeasurementEvidence({ ...evidence, operands: [a, b] })).toMatchObject({ angle: { value: 120 } });
        expect(parseMeasurementEvidence({ ...evidence, operands: [b, a] })).toMatchObject({ angle: { value: 120 } });
      }
    }
    expect(
      parseMeasurementEvidence({ ...evidence, angle: { method: 'line-line', unit: 'deg', value: 60 } }),
    ).toMatchObject({ angle: { method: 'line-line', value: 60 } });
    for (const value of [60, 90, 181, -1, Infinity]) {
      expect(() => parseMeasurementEvidence({ ...evidence, angle: { ...evidence.angle, value } })).toThrow();
    }
    expect(() =>
      parseMeasurementEvidence({ ...evidence, angle: { ...evidence.angle, method: 'line-line' } }),
    ).toThrow();
    expect(() =>
      parseMeasurementEvidence({
        ...evidence,
        operands: [first, { ...second, start: [0, 0, 1e-7] }],
      }),
    ).toThrow(/shared endpoint/);
    expect(measureEdgeCorner(first, { ...first, edgeId: 'duplicate' })).toBeUndefined();
    expect(() => parseMeasurementEvidence({ ...evidence, operands: [first, first] })).toThrow(/shared endpoint/);
  });

  it('preserves detached face-center reference semantics, including centers outside the actual surface', () => {
    const evidence: MeasurementEvidence = {
      kind: 'relation',
      operands: [
        { kind: 'point', position: [0, 0, 0], faceCenter: { patchId: 3, onSurface: false } },
        { kind: 'point', position: [0, 0, 5], vertexId: 2 },
      ],
      distance: { method: 'point-point', unit: 'mm', value: 5, start: [0, 0, 0], end: [0, 0, 5] },
    };
    const parsed = parseMeasurementEvidence(evidence);
    expect(parsed).toEqual(evidence);
    if (evidence.operands[0].kind === 'point') {
      evidence.operands[0].faceCenter!.patchId = 99;
    }
    expect(parsed.operands[0]).toMatchObject({ faceCenter: { patchId: 3, onSurface: false } });
    for (const invalid of [
      { patchId: -1, onSurface: false },
      { patchId: 0, onSurface: 'yes' },
      { patchId: 0, onSurface: true, extra: 1 },
    ]) {
      expect(() =>
        parseMeasurementEvidence({
          ...evidence,
          operands: [{ kind: 'point', position: [0, 0, 0], faceCenter: invalid }, evidence.operands[1]],
        }),
      ).toThrow();
    }
    expect(() =>
      parseMeasurementEvidence({
        ...evidence,
        operands: [
          { kind: 'point', position: [0, 0, 0], vertexId: 0, faceCenter: { patchId: 0, onSurface: true } },
          evidence.operands[1],
        ],
      }),
    ).toThrow(/cannot also/);
  });

  it('parses detached length evidence and strictly versions annotation and host-action contracts', () => {
    const input = length();
    const parsed = parseMeasurementEvidence(input);
    input.distance!.end[0] = 99;
    expect(parsed.distance?.end).toEqual([10, 0, 0]);
    const annotation = {
      id: 'measure-1',
      modelVersion: 'v1',
      kind: 'measurement',
      partLabel: 'Measurement',
      note: '',
      worldCoord: [5, 0, 0],
      measurement: parsed,
    };
    expect(parseWireAnnotation(annotation).measurement).toEqual(parsed);
    const message = createAnnotationsMessage('v1', 1, [parseWireAnnotation(annotation)]);
    expect(message.protocolVersion).toBe(ANNOTATIONS_PROTOCOL_VERSION);
    expect(() => parseAnnotationsMessage({ ...message, protocolVersion: 1 })).toThrow(/protocolVersion/);
    expect(() => parseAnnotationsMessage({ ...message, protocolVersion: 2 })).toThrow(/protocolVersion/);
    expect(() => parseAnnotationsMessage({ ...message, modelVersion: 'v2' })).toThrow(/match/);
    expect(() => parseWireAnnotation({ ...annotation, measurement: undefined })).toThrow();
    expect(() => parseWireAnnotation({ ...annotation, kind: 'point' })).toThrow(/measurement/);
    expect(() => parseWireAnnotation({ ...annotation, triCount: 1 })).toThrow(/region/);
    for (const field of ['commentBase', 'attachedNote', 'sentNote', 'pendingDelivery']) {
      expect(() => parseWireAnnotation({ ...annotation, [field]: 'local-only' })).toThrow(/unsupported field/);
    }
    const manifest = createHostActionsManifest([
      {
        id: 'attach-measurement',
        label: 'Attach measurement',
        icon: 'message',
        slot: 'measurement-result',
        tone: 'default',
        requires: ['model', 'annotations'],
      },
    ]);
    expect(manifest.protocolVersion).toBe(HOST_ACTION_PROTOCOL_VERSION);
    expect(() => parseHostActionsManifest({ ...manifest, protocolVersion: 2 })).toThrow(/protocolVersion/);
  });

  it('bounds measurement snapshot counts, note length and aggregate UTF-8 bytes', () => {
    const annotation = parseWireAnnotation({
      id: 'measure-1',
      modelVersion: 'v1',
      kind: 'measurement',
      partLabel: 'Measurement',
      note: 'x'.repeat(MAX_ANNOTATION_NOTE_LENGTH),
      worldCoord: [5, 0, 0],
      measurement: length(),
    });
    expect(createAnnotationsMessage('v1', 0, [annotation]).items[0]).toEqual(annotation);
    expect(() => parseWireAnnotation({ ...annotation, note: `${annotation.note}x` })).toThrow(/note/);
    expect(() =>
      createAnnotationsMessage(
        'v1',
        0,
        Array.from({ length: MAX_ANNOTATIONS + 1 }, (_, index) => ({
          ...annotation,
          id: `measure-${index}`,
          note: '',
        })),
      ),
    ).toThrow(/at most/);
    expect(() =>
      createAnnotationsMessage(
        'v1',
        0,
        Array.from({ length: 24 }, (_, index) => ({
          ...annotation,
          id: `measure-${index}`,
          note: '测'.repeat(MAX_ANNOTATION_NOTE_LENGTH),
        })),
      ),
    ).toThrow(/bytes/);
  });

  it.each([
    [
      'unknown field',
      (value: MutableLength) => {
        value.extra = true;
      },
    ],
    [
      'operand count',
      (value: MutableLength) => {
        value.operands.push(value.operands[0]!);
      },
    ],
    [
      'unsafe edge id',
      (value: MutableLength) => {
        value.operands[0]!.edgeId = '../edge';
      },
    ],
    [
      'long edge id',
      (value: MutableLength) => {
        value.operands[0]!.edgeId = 'a'.repeat(129);
      },
    ],
    [
      'degenerate edge',
      (value: MutableLength) => {
        value.operands[0]!.end = [0, 0, 0];
      },
    ],
    [
      'nonfinite coordinate',
      (value: MutableLength) => {
        value.operands[0]!.end = [Infinity, 0, 0];
      },
    ],
    [
      'wrong units',
      (value: MutableLength) => {
        value.distance.unit = 'cm';
      },
    ],
    [
      'negative value',
      (value: MutableLength) => {
        value.distance.value = -10;
      },
    ],
    [
      'nonfinite value',
      (value: MutableLength) => {
        value.distance.value = NaN;
      },
    ],
    [
      'inconsistent length',
      (value: MutableLength) => {
        value.distance.value = 11;
      },
    ],
    [
      'wrong method',
      (value: MutableLength) => {
        value.distance.method = 'point-point';
      },
    ],
    [
      'unrelated witnesses',
      (value: MutableLength) => {
        value.distance.start[1] = 1;
        value.distance.end[1] = 1;
      },
    ],
    [
      'plane extension on edge',
      (value: MutableLength) => {
        value.distance.extended = true;
      },
    ],
    [
      'extra angle',
      (value: MutableLength) => {
        value.angle = { method: 'line-line', unit: 'deg', value: 0 };
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const value = length();
    mutate(value);
    expect(() => parseMeasurementEvidence(value)).toThrow();
  });

  it('validates point-plane supporting witnesses, normalized normals, bounded indices and nonempty relations', () => {
    const evidence = {
      ...relation(
        { kind: 'point', position: [2, 3, 5], vertexId: 1, triangleId: 2 },
        { kind: 'plane', origin: [0, 0, 0], normal: [0, 0, 1], patchId: 0, triangleId: 0 },
      ),
      distance: { method: 'point-plane', unit: 'mm', value: 5, start: [2, 3, 5], end: [2, 3, 0], extended: true },
    };
    expect(parseMeasurementEvidence(evidence)).toEqual(evidence);
    for (const bad of [
      { ...evidence, distance: undefined },
      { ...evidence, operands: [{ ...evidence.operands[0], vertexId: 2 ** 32 }, evidence.operands[1]] },
      { ...evidence, operands: [evidence.operands[0], { ...evidence.operands[1], normal: [0, 0, 2] }] },
      { ...evidence, distance: { ...evidence.distance, value: Math.sqrt(26), end: [3, 3, 0] } },
      { ...evidence, distance: { ...evidence.distance, method: 'point-segment' } },
    ]) {
      expect(() => parseMeasurementEvidence(bad)).toThrow();
    }
  });

  interface MutableLength {
    operands: Array<{ edgeId: string; start: number[]; end: number[] }>;
    distance: { method: string; unit: string; value: number; start: number[]; end: number[]; extended?: boolean };
    extra?: unknown;
    angle?: unknown;
  }

  it('checks smaller angles against operand directions and rejects nonparallel gaps', () => {
    const plane = { kind: 'plane', origin: [0, 0, 0], normal: [0, 0, 1], patchId: 0, triangleId: 0 } as const;
    const evidence = {
      kind: 'relation',
      operands: [{ ...edge, start: [0, 0, 2], end: [10, 0, 2] }, plane],
      angle: { method: 'line-plane', unit: 'deg', value: 0 },
      distance: { method: 'parallel-gap', unit: 'mm', value: 2, start: [0, 0, 2], end: [0, 0, 0] },
    };
    expect(parseMeasurementEvidence(evidence)).toEqual(evidence);
    for (const value of [-1, 45, 91, Infinity]) {
      expect(() => parseMeasurementEvidence({ ...evidence, angle: { ...evidence.angle, value } })).toThrow();
    }
    const tilted = { ...edge, start: [0, 0, 2], end: [0, 0, 12] };
    const perpendicular = {
      ...evidence,
      operands: [tilted, plane],
      angle: { ...evidence.angle, value: 90 },
      distance: undefined,
    };
    expect(parseMeasurementEvidence(perpendicular)).toMatchObject({ angle: { value: 90 } });
    expect(() => parseMeasurementEvidence({ ...perpendicular, distance: evidence.distance })).toThrow(/parallel/);
  });

  it('rejects nonminimum finite-segment witnesses even when their stated length is consistent', () => {
    const pointSegment = {
      kind: 'relation',
      operands: [{ kind: 'point', position: [5, 3, 0] }, edge],
      distance: { method: 'point-segment', unit: 'mm', value: 3, start: [5, 3, 0], end: [5, 0, 0] },
    };
    expect(parseMeasurementEvidence(pointSegment)).toEqual(pointSegment);
    expect(() =>
      parseMeasurementEvidence({
        ...pointSegment,
        distance: { ...pointSegment.distance, value: Math.sqrt(34), end: [0, 0, 0] },
      }),
    ).toThrow(/closest/);

    const skew = {
      kind: 'relation',
      operands: [edge, { kind: 'edge', edgeId: 'edge-2', start: [5, -5, 3], end: [5, 5, 3] }],
      distance: { method: 'segment-segment', unit: 'mm', value: 3, start: [5, 0, 0], end: [5, 0, 3] },
      angle: { method: 'line-line', unit: 'deg', value: 90 },
    };
    expect(parseMeasurementEvidence(skew)).toEqual(skew);
    expect(
      parseMeasurementEvidence({
        ...skew,
        operands: [...skew.operands].reverse(),
        distance: { ...skew.distance, start: skew.distance.end, end: skew.distance.start },
      }),
    ).toMatchObject({ distance: { value: 3 }, angle: { value: 90 } });
    expect(() =>
      parseMeasurementEvidence({
        ...skew,
        distance: { ...skew.distance, value: Math.sqrt(34), start: [0, 0, 0] },
      }),
    ).toThrow(/closest/);
  });

  it('accepts supporting-plane gaps and normal sign invariance within normalization tolerance', () => {
    const evidence = {
      kind: 'relation',
      operands: [
        { kind: 'plane', patchId: 0, triangleId: 0, origin: [0, 0, 0], normal: [0, 0, 1] },
        { kind: 'plane', patchId: 1, triangleId: 1, origin: [1, 2, 3], normal: [0, 0, -0.99999999] },
      ],
      distance: { method: 'parallel-gap', unit: 'mm', value: 3, start: [1, 2, 0], end: [1, 2, 3], extended: true },
      angle: { method: 'plane-plane', unit: 'deg', value: 0 },
    };
    expect(parseMeasurementEvidence(evidence)).toEqual(evidence);
  });

  it('rejects near-parallel gaps even when the direction dot product rounds to one', () => {
    const plane = { kind: 'plane', patchId: 0, triangleId: 0, origin: [0, 0, 0], normal: [0, 0, 1] };
    const distance = { method: 'parallel-gap', unit: 'mm', value: 2, start: [0, 0, 2], end: [0, 0, 0] };
    expect(() =>
      parseMeasurementEvidence({
        kind: 'relation',
        operands: [{ ...edge, start: [0, 0, 2], end: [10, 0, 2 + 1e-7] }, plane],
        angle: { method: 'line-plane', unit: 'deg', value: 0 },
        distance,
      }),
    ).toThrow(/parallel/);
    expect(() =>
      parseMeasurementEvidence({
        kind: 'relation',
        operands: [{ ...plane, patchId: 1, origin: [0, 0, 2], normal: [1e-8, 0, 1] }, plane],
        angle: { method: 'plane-plane', unit: 'deg', value: 0 },
        distance,
      }),
    ).toThrow(/parallel/);
  });
});
