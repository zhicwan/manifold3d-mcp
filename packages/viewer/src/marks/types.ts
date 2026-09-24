/**
 * Annotation domain types shared across the viewer's marks subsystem.
 *
 * Spatial annotations are either comments authored in draft batches or
 * selections attached to a single interaction. Their transaction metadata
 * is browser-local and is deliberately omitted by the wire serializer.
 *
 * The partLabel falls back to a generic sequence name (point#1, region#2)
 * when the feature resolver cannot provide a semantic label.
 */
import type { MeasurementEvidence } from '@manifold3d/protocol/wire/measurements.js';

export type AnnotationKind = 'point' | 'region' | 'measurement';
/** Annotate collects a comment batch; select attaches one location per gesture. */
export type MarkMode = 'orbit' | 'annotate' | 'select' | 'measure';

interface SpatialAnnotation {
  id: string;
  createdAt: number;
  /** Viewer-local presentation number for this model. Zero means an unannotated measurement has not entered the stream. */
  displayNumber: number;
  /** Identifies the model version this annotation was made against. */
  modelVersion: string;
  kind: AnnotationKind;
  /** Browser-local transaction grouping. Never serialized to WireAnnotation. */
  batchId: string;

  /** World-space anchor for the marker and flyout. */
  anchorWorld: [number, number, number];

  /**
   * Original picked surface point (for kind=point). For region this is
   * the same as anchorWorld (the centroid of selected triangles).
   */
  worldCoord: [number, number, number];

  /** Triangle indices selected (for kind=region). Empty for kind=point. */
  triIds: number[];

  /**
   * Display label: generic point#N / region#N or a semantic feature label.
   * Always present so the UI never has to handle a missing label.
   */
  partLabel: string;
}

export interface CommentAnnotation extends SpatialAnnotation {
  kind: 'point' | 'region';
  intent: 'comment';
  state: 'draft' | 'pending' | 'committed';
  /** User's free-form note. Empty string means "not yet written". */
  note: string;
}

export interface SelectionAnnotation extends SpatialAnnotation {
  kind: 'point' | 'region';
  intent: 'selection';
  state: 'pending' | 'committed';
  /** Selections are geometry-only and never own editable note text. */
  note: '';
}

export interface MeasurementAnnotation extends SpatialAnnotation {
  kind: 'measurement';
  intent: 'measurement';
  state: 'draft' | 'pending' | 'committed';
  note: string;
  measurement: MeasurementEvidence;
  /** Local delivery receipts; previously delivered host snapshots never change. */
  attachedNote?: string;
  sentNote?: string;
  /** The pending operation's owner; direct delivery cannot be settled by a note batch. */
  pendingDelivery?: 'direct' | 'batch';
  /** Previous saved note restored when its shared comment batch is cancelled. */
  commentBase?: {
    note: string;
    state: 'draft' | 'committed';
    batchId: string;
    displayNumber: number;
  };
}

export type Annotation = CommentAnnotation | SelectionAnnotation | MeasurementAnnotation;

export interface AnnotationGeometryInput {
  kind: 'point' | 'region';
  anchorWorld: [number, number, number];
  worldCoord: [number, number, number];
  triIds: number[];
  partLabel?: string;
}

export interface CommentAnnotationInput extends AnnotationGeometryInput {
  note: string;
}

export type SelectionAnnotationInput = AnnotationGeometryInput;

export interface CommentBatchSnapshot {
  batchId: string;
  annotationIds: readonly string[];
}
