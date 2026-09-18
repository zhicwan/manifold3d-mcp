import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';
import type { ModelExportFormat } from '@manifold3d/protocol/wire/host-actions.js';

export function modelExportFilename(payload: ViewerModel, format: ModelExportFormat, revision?: number): string {
  const slug =
    (payload.description || 'model')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'model';
  const revisionSuffix = revision === undefined ? '' : `-r${revision}`;
  return `${slug}${revisionSuffix}.${format}`;
}
