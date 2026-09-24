import type { MeasurementEvidence, MeasurementOperand } from '@manifold3d/protocol/wire/measurements.js';
import { createViewerI18n } from '../i18n/index.js';
import type { MeasurementCandidate } from './geometry.js';
import { formatMeasurementReading } from './presentation.js';

const detachedDisplayI18n = createViewerI18n('en');

export function contextualizeMeasurement(
  evidence: MeasurementEvidence,
  candidates: readonly MeasurementCandidate[],
  featureFor: (candidate: MeasurementCandidate) => string | null,
): { evidence: MeasurementEvidence; partLabel: string } {
  const features = candidates.map(featureFor);
  const operands = evidence.operands.map((operand, index) => ({
    ...operand,
    ...(features[index] ? { feature: features[index]! } : {}),
  }));
  const display = measurementDisplay(evidence);
  const names = operands.map(describeOperand);
  const subject = evidence.kind === 'edge-length' ? names[0]! : `${names[0]} and ${names[1]}`;
  const qualifier = evidence.distance?.method === 'parallel-gap' ? ' using supporting planes' : '';
  const summary = `${display.primary === 'angle' ? 'Angle' : evidence.kind === 'edge-length' ? 'Length' : 'Distance'} ${display.text} ${evidence.kind === 'edge-length' ? 'of' : 'between'} ${subject}${qualifier}.`;
  const partLabel = [...new Set(features.filter((feature): feature is string => feature !== null))].join(' to ');
  return {
    evidence:
      evidence.kind === 'edge-length'
        ? { ...evidence, operands: [operands[0]!] as [(typeof evidence.operands)[0]], display, summary }
        : {
            ...evidence,
            operands: [operands[0]!, operands[1]!] as [(typeof evidence.operands)[0], (typeof evidence.operands)[1]],
            display,
            summary,
          },
    partLabel: partLabel || 'Measurement',
  };
}

function measurementDisplay(evidence: MeasurementEvidence) {
  const angle = evidence.kind === 'relation' ? evidence.angle : undefined;
  const showDistance = evidence.distance && !(evidence.distance.value === 0 && angle && angle.value > 0);
  return {
    text: formatMeasurementReading(evidence, detachedDisplayI18n),
    primary: showDistance ? ('distance' as const) : ('angle' as const),
  };
}

function describeOperand(operand: MeasurementOperand): string {
  if (operand.feature) {
    return operand.feature;
  }
  return operand.kind === 'point' ? 'point' : operand.kind === 'edge' ? 'straight edge' : 'planar patch';
}
