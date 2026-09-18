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
  it('builds a version 2 annotation batch with notes and semantic selection data', () => {
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

  it('builds exactly one point or region location without comment text or batchId', () => {
    const point = buildAnnotationAttachment({
      mode: 'location-selection',
      modelVersion: 'model-v2',
      annotationRevision: 3,
      annotations: [annotation({ note: '' })],
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
        annotations: [annotation({ id: 'region', kind: 'region', triCount: 4, note: '' })],
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
