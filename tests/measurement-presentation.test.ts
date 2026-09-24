import { describe, expect, it } from 'vitest';
import type { MeasurementEvidence } from '../packages/protocol/src/wire/measurements.js';
import { createViewerI18n } from '../packages/viewer/src/i18n/index.js';
import { formatMeasurement, measurementHint } from '../packages/viewer/src/measurements/presentation.js';

function relation(value: number, angle: number): MeasurementEvidence {
  return {
    kind: 'relation',
    operands: [
      { kind: 'edge', edgeId: 'a', start: [0, 0, 0], end: [1, 0, 0] },
      { kind: 'edge', edgeId: 'b', start: [0, value, 0], end: [1, value, 0] },
    ],
    distance: { value, unit: 'mm', method: 'segment-segment', start: [0, 0, 0], end: [0, value, 0] },
    angle: { value: angle, unit: 'deg', method: 'line-line' },
  };
}

describe('task-focused measurement readings', () => {
  const i18n = createViewerI18n('en');
  it('shows parallel distance without a redundant zero angle, retaining the full evidence', () => {
    const evidence = relation(16, 0);
    expect(formatMeasurement(evidence, i18n)).toBe('16 mm');
    expect(evidence.kind === 'relation' && evidence.angle?.value).toBe(0);
  });

  it('shows the angle alone at an intersection and both values for separated angled edges', () => {
    expect(formatMeasurement(relation(0, 90), i18n)).toBe('90°');
    expect(formatMeasurement(relation(16, 45), i18n)).toBe('16 mm · 45°');
    expect(formatMeasurement(relation(0, 0), i18n)).toBe('0 mm');
    expect(formatMeasurement(relation(0, 0.000004), i18n)).toBe('0°');
  });

  it('shows obtuse corner angles without calling them smaller angles', () => {
    const evidence = relation(0, 120);
    if (evidence.kind !== 'relation') {
      throw new Error('Expected a relation fixture.');
    }
    evidence.angle = { method: 'edge-corner', unit: 'deg', value: 120 };
    expect(formatMeasurement(evidence, i18n)).toBe('120°');
    expect(measurementHint(evidence, i18n)).toBe('Corner angle');
    expect(measurementHint(evidence, createViewerI18n('zh-CN'))).toBe('顶点夹角');
    expect(measurementHint(relation(0, 60), i18n)).toBe('Smaller angle');
  });

  it('keeps short extended-plane warnings and tiny nonzero values truthful', () => {
    const evidence = relation(0.000001, 0);
    evidence.distance!.extended = true;
    expect(formatMeasurement(evidence, i18n)).not.toMatch(/^0 mm/);
    expect(formatMeasurement(evidence, i18n)).toContain('extended plane');
    expect(formatMeasurement(evidence, createViewerI18n('zh-CN'))).toContain('延伸面');
  });
});
