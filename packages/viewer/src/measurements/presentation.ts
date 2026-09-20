import type { MeasurementEvidence } from '@manifold3d/protocol/wire/measurements.js';
import type { ViewerI18n } from '../i18n/index.js';
import type { MarkMode, MeasurementAnnotation } from '../marks/types.js';

export function measurementLabelAction(mode: MarkMode): 'manage' | 'comment' | 'attach' | 'inspect' {
  return mode === 'measure' ? 'manage' : mode === 'annotate' ? 'comment' : mode === 'select' ? 'attach' : 'inspect';
}

export function measurementBadges(annotation: MeasurementAnnotation) {
  return {
    commented: annotation.note.trim().length > 0,
    attached: annotation.attachedNote !== undefined,
    attachmentChanged: annotation.attachedNote !== undefined && annotation.attachedNote !== annotation.note,
    sent: annotation.sentNote !== undefined,
    pending: annotation.state === 'pending',
  };
}

export function formatMeasurement(evidence: MeasurementEvidence, i18n: ViewerI18n): string {
  const angle = evidence.kind === 'relation' ? evidence.angle : undefined;
  const values: string[] = [];
  if (evidence.distance && !(evidence.distance.value === 0 && angle && angle.value > 0)) {
    values.push(`${formatQuantity(evidence.distance.value, 2, i18n)} mm`);
  }
  if (angle && (!evidence.distance || angle.value > 0)) {
    values.push(`${formatQuantity(angle.value, 1, i18n)}°`);
  }
  if (evidence.distance?.extended) {
    values.push(i18n.t('measureExtendedShort'));
  }
  return values.join(' · ');
}

export function measurementHint(evidence: MeasurementEvidence, i18n: ViewerI18n): string {
  const angleOnly =
    !evidence.distance ||
    (evidence.distance.value === 0 && evidence.kind === 'relation' && evidence.angle && evidence.angle.value > 0);
  return i18n.t(
    angleOnly
      ? evidence.kind === 'relation' && evidence.angle?.method === 'edge-corner'
        ? 'measureCornerAngle'
        : 'measureAngle'
      : evidence.kind === 'edge-length'
        ? 'measureLength'
        : 'measureDistance',
  );
}

function formatQuantity(value: number, decimals: number, i18n: ViewerI18n): string {
  return i18n.number(
    value,
    value > 0 && value < 10 ** -decimals
      ? { maximumSignificantDigits: 3, notation: value < 0.0001 ? 'scientific' : 'standard' }
      : { maximumFractionDigits: decimals },
  );
}
