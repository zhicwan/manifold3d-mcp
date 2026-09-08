import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';

export function stlFilename(payload: ViewerModel, revision?: number): string {
  const slug =
    (payload.description || 'model')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'model';
  const revisionSuffix = revision === undefined ? '' : `-r${revision}`;
  return `${slug}${revisionSuffix}.stl`;
}
