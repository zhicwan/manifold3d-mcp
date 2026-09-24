import { describe, expect, it } from 'vitest';

import type { WireAnnotation } from '@manifold3d/protocol/wire/annotations.js';
import {
  ANNOTATION_ATTACHMENT_VERSION,
  buildAnnotationAttachment,
  isAnnotationAttachment,
  MAX_ANNOTATION_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_ANNOTATIONS,
  MAX_ATTACHMENT_SKETCH_POINTS,
  parseAnnotationAttachment,
} from '../src/annotation-attachment.js';

describe('AnnotationAttachment', () => {
  it('preserves face-center references in detached measurement attachments', () => {
    const measurement: WireAnnotation = {
      ...annotation({ kind: 'measurement', note: 'Move this center 1 mm upward' }),
      measurement: {
        kind: 'relation',
        operands: [
          { kind: 'point', position: [0, 0, 0], faceCenter: { patchId: 8 } },
          { kind: 'point', position: [0, 0, 5], vertexId: 2 },
        ],
        distance: { method: 'point-point', unit: 'mm', value: 5, start: [0, 0, 0], end: [0, 0, 5] },
      },
    };
    const attachment = buildAnnotationAttachment({
      mode: 'measurement',
      modelVersion: 'model-v1',
      annotationRevision: 1,
      annotations: [measurement],
      markerNumbers: [1],
    });
    expect(attachment.annotations[0].measurement.operands[0]).toMatchObject({
      kind: 'point',
      position: [0, 0, 0],
      faceCenter: { patchId: 8 },
    });
    const source = measurement.measurement!.operands[0];
    if (source.kind !== 'point' || !source.faceCenter) {
      throw new Error('Expected a face center in the test evidence.');
    }
    source.faceCenter.patchId = 99;
    expect(attachment.annotations[0].measurement.operands[0]).toMatchObject({ faceCenter: { patchId: 8 } });
    expect(parseAnnotationAttachment(JSON.parse(JSON.stringify(attachment)))).toEqual(attachment);
  });

  it('builds dedicated measurement evidence with empty or optional notes but rejects location selection', () => {
    const measurement: WireAnnotation = {
      ...annotation({ kind: 'measurement', note: '' }),
      measurement: {
        kind: 'edge-length',
        operands: [{ kind: 'edge', edgeId: 'edge-1', start: [0, 0, 0], end: [10, 0, 0] }],
        distance: { method: 'segment-length', unit: 'mm', value: 10, start: [0, 0, 0], end: [10, 0, 0] },
      },
    };
    const input = {
      modelVersion: 'model-v1',
      annotationRevision: 1,
      annotations: [measurement],
      markerNumbers: [1],
    };
    const attachment = buildAnnotationAttachment({ ...input, mode: 'measurement' });
    expect(attachment).toMatchObject({
      version: 5,
      mode: 'measurement',
      annotations: [{ note: '', measurement: measurement.measurement }],
    });
    const { note: _note, ...withoutNote } = attachment.annotations[0];
    expect(parseAnnotationAttachment({ ...attachment, annotations: [withoutNote] }).annotations[0]).not.toHaveProperty(
      'note',
    );
    expect(() => parseAnnotationAttachment({ ...attachment, version: 3 })).toThrow(/version/);
    expect(() => parseAnnotationAttachment({ ...attachment, batchId: 'batch' })).toThrow(/batchId/);
    expect(() => buildAnnotationAttachment({ ...input, mode: 'measurement', modelVersion: 'other' })).toThrow(/model/);
    expect(() =>
      buildAnnotationAttachment({ ...input, mode: 'measurement', annotations: [], markerNumbers: [] }),
    ).toThrow(/exactly one/);
    expect(() =>
      buildAnnotationAttachment({
        ...input,
        mode: 'measurement',
        annotations: [measurement, { ...measurement, id: 'second' }],
        markerNumbers: [1, 2],
      }),
    ).toThrow(/exactly one/);
    expect(() => buildAnnotationAttachment({ ...input, mode: 'location-selection' })).toThrow(/point or region/);
    expect(() =>
      buildAnnotationAttachment({
        ...input,
        mode: 'annotation-batch',
        batchId: 'batch',
        annotations: [measurement],
      }),
    ).toThrow(/note/);
    expect(() =>
      buildAnnotationAttachment({
        ...input,
        mode: 'measurement',
        annotations: [{ ...measurement, note: 'x'.repeat(4097) }],
      }),
    ).toThrow(/bounded/);
    expect(() =>
      parseAnnotationAttachment({
        ...attachment,
        annotations: [{ ...attachment.annotations[0], note: 'x'.repeat(MAX_ANNOTATION_ATTACHMENT_BYTES) }],
      }),
    ).toThrow(/bytes/);
    measurement.measurement!.distance!.end[0] = 99;
    expect(attachment.annotations[0].measurement.distance!.end).toEqual([10, 0, 0]);
  });

  it('builds a version 4 annotation batch with notes and semantic selection data', () => {
    const attachment = buildAnnotationAttachment({
      mode: 'annotation-batch',
      batchId: 'batch-7',
      modelVersion: 'model-v1',
      annotationRevision: 7,
      annotations: [
        annotation({ kind: 'point', clientId: 'transport-client' }),
        annotation({ id: 'region', kind: 'region', triCount: 12 }),
        annotation({
          id: 'sketch',
          kind: 'sketch',
          note: 'round this edge',
          viewPlane: 'front',
          planeOrigin: [0, 0, 0],
          strokes: [
            [
              [0, 0],
              [1, 1],
            ],
          ],
        }),
      ],
      markerNumbers: [1, 2, 3],
    });

    expect(attachment).toEqual({
      version: ANNOTATION_ATTACHMENT_VERSION,
      source: 'manifold3d-viewer',
      mode: 'annotation-batch',
      batchId: 'batch-7',
      modelVersion: 'model-v1',
      annotationRevision: 7,
      annotations: [
        {
          id: 'point',
          displayNumber: 1,
          partLabel: 'part#1',
          note: 'note',
          selection: { kind: 'point', worldCoord: [1, 2, 3] },
        },
        {
          id: 'region',
          displayNumber: 2,
          partLabel: 'part#1',
          note: 'note',
          selection: { kind: 'region', worldCoord: [1, 2, 3], triangleCount: 12 },
        },
        {
          id: 'sketch',
          displayNumber: 3,
          partLabel: 'part#1',
          note: 'round this edge',
          selection: {
            kind: 'sketch',
            worldCoord: [1, 2, 3],
            viewPlane: 'front',
            planeOrigin: [0, 0, 0],
            strokes: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          },
        },
      ],
    });
    const json = JSON.stringify(attachment);
    expect(json).not.toContain('clientId');
    expect(parseAnnotationAttachment(JSON.parse(json))).toEqual(attachment);
  });

  it('roundtrips a detached mixed point, region and measurement comment batch with its original markers', () => {
    const measurement = Object.assign(measurementAnnotation(), {
      commentBase: { note: 'before edit', state: 'committed' },
      attachedNote: 'old attachment',
      sentNote: 'old instruction',
      pendingDelivery: 'batch',
    });
    const attachment = buildAnnotationAttachment({
      mode: 'annotation-batch',
      batchId: 'mixed-batch',
      modelVersion: 'model-v1',
      annotationRevision: 8,
      annotations: [annotation(), annotation({ id: 'region', kind: 'region', triCount: 12 }), measurement],
      markerNumbers: [2, 6, 9],
    });
    const expected = {
      version: 5,
      source: 'manifold3d-viewer',
      mode: 'annotation-batch',
      batchId: 'mixed-batch',
      modelVersion: 'model-v1',
      annotationRevision: 8,
      annotations: [
        {
          id: 'point',
          displayNumber: 2,
          partLabel: 'part#1',
          note: 'note',
          selection: { kind: 'point', worldCoord: [1, 2, 3] },
        },
        {
          id: 'region',
          displayNumber: 6,
          partLabel: 'part#1',
          note: 'note',
          selection: { kind: 'region', worldCoord: [1, 2, 3], triangleCount: 12 },
        },
        {
          id: 'measurement',
          displayNumber: 9,
          partLabel: 'part#1',
          note: 'Move this center 1 mm upward',
          selection: {
            kind: 'measurement',
            worldCoord: [1, 2, 3],
            measurement: {
              kind: 'relation',
              operands: [
                { kind: 'point', position: [0, 0, 0], faceCenter: { patchId: 8 } },
                { kind: 'point', position: [0, 0, 5], vertexId: 2 },
              ],
              distance: { method: 'point-point', unit: 'mm', value: 5, start: [0, 0, 0], end: [0, 0, 5] },
            },
          },
        },
      ],
    };
    expect(attachment).toEqual(expected);
    const parsed = parseAnnotationAttachment(attachment);
    expect(parseAnnotationAttachment(JSON.parse(JSON.stringify(attachment)))).toEqual(expected);
    measurement.note = 'edited later';
    measurement.worldCoord[0] = 99;
    measurement.measurement!.distance!.end[2] = 99;
    const operand = measurement.measurement!.operands[0];
    if (operand.kind !== 'point' || !operand.faceCenter) {
      throw new Error('Expected a face center.');
    }
    operand.position[0] = 99;
    operand.faceCenter.patchId = 99;
    expect(attachment).toEqual(expected);
    attachment.annotations[2]!.selection.worldCoord[0] = 88;
    const selection = attachment.annotations[2]!.selection;
    if (selection.kind !== 'measurement') {
      throw new Error('Expected a measurement selection.');
    }
    selection.measurement.distance!.end[2] = 88;
    expect(parsed).toEqual(expected);
  });

  it('strictly validates measurement batch notes, anchors and evidence while keeping locations separate', () => {
    const input = {
      mode: 'annotation-batch' as const,
      batchId: 'measurement-batch',
      modelVersion: 'model-v1',
      annotationRevision: 1,
      annotations: [measurementAnnotation()],
      markerNumbers: [7],
    };
    const attachment = buildAnnotationAttachment(input);
    const item = attachment.annotations[0]!;
    for (const note of ['', ' \n ', 'x'.repeat(4097)]) {
      expect(() =>
        buildAnnotationAttachment({ ...input, annotations: [{ ...measurementAnnotation(), note }] }),
      ).toThrow(/note/);
      expect(() => parseAnnotationAttachment({ ...attachment, annotations: [{ ...item, note }] })).toThrow(/note/);
    }
    for (const selection of [
      { ...item.selection, extra: true },
      { ...item.selection, worldCoord: [0, 1] },
      { ...item.selection, measurement: undefined },
      { ...item.selection, measurement: { ...measurementAnnotation().measurement, extra: true } },
      {
        ...item.selection,
        measurement: {
          ...measurementAnnotation().measurement,
          distance: { method: 'point-point', unit: 'mm', value: 99, start: [0, 0, 0], end: [0, 0, 5] },
        },
      },
    ]) {
      expect(() => parseAnnotationAttachment({ ...attachment, annotations: [{ ...item, selection }] })).toThrow();
    }
    const { batchId: _batchId, ...withoutBatchId } = attachment;
    const { note: _note, ...withoutNote } = item;
    expect(() =>
      parseAnnotationAttachment({ ...withoutBatchId, mode: 'location-selection', annotations: [withoutNote] }),
    ).toThrow(/unsupported/);
    expect(() =>
      parseAnnotationAttachment({
        ...attachment,
        annotations: [{ ...item, note: 'x'.repeat(MAX_ANNOTATION_ATTACHMENT_BYTES) }],
      }),
    ).toThrow(/bytes/);
  });

  it('rejects mixed model versions before serializing a batch or location snapshot', () => {
    const input = {
      modelVersion: 'model-v1',
      annotationRevision: 1,
      markerNumbers: [1, 2],
      annotations: [annotation(), { ...measurementAnnotation(), modelVersion: 'previous-model' }],
    };
    expect(() => buildAnnotationAttachment({ ...input, mode: 'annotation-batch', batchId: 'mixed' })).toThrow(
      /current model/,
    );
    expect(() =>
      buildAnnotationAttachment({
        ...input,
        mode: 'location-selection',
        annotations: [annotation({ modelVersion: 'previous-model', note: '' })],
        markerNumbers: [1],
      }),
    ).toThrow(/current model/);
  });

  it('requires valid annotation identities, marker numbers and revisions in measurement batches', () => {
    const input = {
      mode: 'annotation-batch' as const,
      batchId: 'measurements',
      modelVersion: 'model-v1',
      annotationRevision: 1,
      annotations: [measurementAnnotation()],
      markerNumbers: [7],
    };
    for (const marker of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildAnnotationAttachment({ ...input, markerNumbers: [marker] })).toThrow(/positive safe integer/);
    }
    for (const annotationRevision of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildAnnotationAttachment({ ...input, annotationRevision })).toThrow(/revision/);
    }
    for (const id of ['', '../unsafe', 'a'.repeat(65)]) {
      expect(() => buildAnnotationAttachment({ ...input, annotations: [{ ...measurementAnnotation(), id }] })).toThrow(
        /id/,
      );
    }
    expect(() =>
      buildAnnotationAttachment({
        ...input,
        annotations: [measurementAnnotation(), annotation({ id: 'measurement' })],
        markerNumbers: [7, 8],
      }),
    ).toThrow(/unique/);
  });

  it('builds exactly one point or region location without comment text or batchId', () => {
    const point = buildAnnotationAttachment({
      mode: 'location-selection',
      modelVersion: 'model-v2',
      annotationRevision: 3,
      annotations: [annotation({ modelVersion: 'model-v2', note: '' })],
      markerNumbers: [1],
    });
    expect(point).toEqual({
      version: ANNOTATION_ATTACHMENT_VERSION,
      source: 'manifold3d-viewer',
      mode: 'location-selection',
      modelVersion: 'model-v2',
      annotationRevision: 3,
      annotations: [
        {
          id: 'point',
          displayNumber: 1,
          partLabel: 'part#1',
          selection: { kind: 'point', worldCoord: [1, 2, 3] },
        },
      ],
    });
    const json = JSON.stringify(point);
    expect(json).not.toContain('"note"');
    expect(json).not.toContain('batchId');

    expect(
      buildAnnotationAttachment({
        mode: 'location-selection',
        modelVersion: 'model-v2',
        annotationRevision: 3,
        annotations: [annotation({ id: 'region', modelVersion: 'model-v2', kind: 'region', triCount: 4, note: '' })],
        markerNumbers: [1],
      }).annotations[0],
    ).toMatchObject({ selection: { kind: 'region', triangleCount: 4 } });
  });

  it('strictly rejects invalid modes, fields, batch ids, selection counts, notes, and kinds', () => {
    const validBatch = buildAnnotationAttachment({
      mode: 'annotation-batch',
      batchId: 'valid-batch',
      modelVersion: 'model-v1',
      annotationRevision: 1,
      annotations: [annotation()],
      markerNumbers: [1],
    });
    expect(isAnnotationAttachment(validBatch)).toBe(true);
    expect(isAnnotationAttachment({ ...validBatch, version: 2 })).toBe(false);
    expect(isAnnotationAttachment({ ...validBatch, extra: true })).toBe(false);
    expect(isAnnotationAttachment({ ...validBatch, batchId: 'not safe!' })).toBe(false);
    expect(() =>
      buildAnnotationAttachment({
        mode: 'annotation-batch',
        batchId: 'empty-note',
        modelVersion: 'model-v1',
        annotationRevision: 1,
        annotations: [annotation({ note: '   ' })],
        markerNumbers: [1],
      }),
    ).toThrow(/bounded plain text/);

    expect(() =>
      buildAnnotationAttachment({
        mode: 'location-selection',
        modelVersion: 'model-v1',
        annotationRevision: 1,
        annotations: [annotation({ note: 'comment' })],
        markerNumbers: [1],
      }),
    ).toThrow(/note must be empty/);
    expect(() =>
      buildAnnotationAttachment({
        mode: 'location-selection',
        modelVersion: 'model-v1',
        annotationRevision: 1,
        annotations: [annotation({ note: '' }), annotation({ id: 'second', note: '' })],
        markerNumbers: [1, 2],
      }),
    ).toThrow(/exactly one/);
    expect(() =>
      buildAnnotationAttachment({
        mode: 'location-selection',
        modelVersion: 'model-v1',
        annotationRevision: 1,
        annotations: [
          annotation({
            kind: 'sketch',
            note: '',
            viewPlane: 'top',
            planeOrigin: [0, 0, 0],
            strokes: [
              [
                [0, 0],
                [1, 1],
              ],
            ],
          }),
        ],
        markerNumbers: [1],
      }),
    ).toThrow(/point or region/);
  });

  it('enforces annotation count, aggregate sketch-point, and serialized byte bounds', () => {
    expect(() =>
      buildAnnotationAttachment({
        mode: 'annotation-batch',
        batchId: 'too-many',
        modelVersion: 'model-v1',
        annotationRevision: 1,
        annotations: Array.from({ length: MAX_ATTACHMENT_ANNOTATIONS + 1 }, (_, index) =>
          annotation({ id: `point-${index}` }),
        ),
        markerNumbers: Array.from({ length: MAX_ATTACHMENT_ANNOTATIONS + 1 }, (_, index) => index + 1),
      }),
    ).toThrow(/between/);

    expect(() =>
      buildAnnotationAttachment({
        mode: 'annotation-batch',
        batchId: 'too-many-points',
        modelVersion: 'model-v1',
        annotationRevision: 1,
        annotations: [
          sketchAnnotation('sketch-a', Math.floor(MAX_ATTACHMENT_SKETCH_POINTS / 2) + 1),
          sketchAnnotation('sketch-b', Math.floor(MAX_ATTACHMENT_SKETCH_POINTS / 2) + 1),
        ],
        markerNumbers: [1, 2],
      }),
    ).toThrow(/sketches exceed/);

    expect(() =>
      parseAnnotationAttachment({
        ...buildAnnotationAttachment({
          mode: 'annotation-batch',
          batchId: 'oversized',
          modelVersion: 'model-v1',
          annotationRevision: 1,
          annotations: [annotation()],
          markerNumbers: [1],
        }),
        annotations: [
          {
            id: 'point',
            partLabel: 'x'.repeat(MAX_ANNOTATION_ATTACHMENT_BYTES),
            note: '',
            selection: { kind: 'point', worldCoord: [0, 0, 0] },
          },
        ],
      }),
    ).toThrow(/exceeds/);
  });
});

function annotation(overrides: Partial<WireAnnotation> = {}): WireAnnotation {
  return {
    id: 'point',
    modelVersion: 'model-v1',
    kind: 'point',
    partLabel: 'part#1',
    note: 'note',
    worldCoord: [1, 2, 3],
    ...overrides,
  };
}

function measurementAnnotation(): WireAnnotation {
  return annotation({
    id: 'measurement',
    kind: 'measurement',
    note: 'Move this center 1 mm upward',
    measurement: {
      kind: 'relation',
      operands: [
        { kind: 'point', position: [0, 0, 0], faceCenter: { patchId: 8 } },
        { kind: 'point', position: [0, 0, 5], vertexId: 2 },
      ],
      distance: { method: 'point-point', unit: 'mm', value: 5, start: [0, 0, 0], end: [0, 0, 5] },
    },
  });
}

function sketchAnnotation(id: string, points: number): WireAnnotation {
  const firstStrokeLength = Math.ceil(points / 2);
  const secondStrokeLength = points - firstStrokeLength;
  return annotation({
    id,
    kind: 'sketch',
    viewPlane: 'front',
    planeOrigin: [0, 0, 0],
    strokes: [
      Array.from({ length: firstStrokeLength }, (_point, index) => [index, index] as [number, number]),
      Array.from({ length: secondStrokeLength }, (_point, index) => [index, index] as [number, number]),
    ],
  });
}
