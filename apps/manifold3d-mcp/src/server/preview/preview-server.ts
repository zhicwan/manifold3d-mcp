import type { ViewerModelFrame } from '@manifold3d/protocol/wire/model.js';
import { createManifoldCadShareLink } from '@manifold3d/modeling/manifoldcad-link.js';

import {
  startViewerHost,
  type ViewerAnnotationSnapshot,
  type ViewerHostOptions,
} from '@manifold3d/viewer-host/viewer-host.js';

export const OPEN_IN_MANIFOLDCAD_ACTION_ID = 'open-in-manifoldcad';

export interface PublishedModelSource {
  code: string;
  description?: string;
}

export interface PreviewServerHandle {
  url: string;
  pushModel(model: ViewerModelFrame, source?: PublishedModelSource): void;
  getAnnotations(): ViewerAnnotationSnapshot;
  close(): Promise<void>;
}

export type PreviewServerOptions = ViewerHostOptions & {
  openExternalUrl?(url: string): Promise<void>;
};

export async function startPreviewServer(options: PreviewServerOptions): Promise<PreviewServerHandle> {
  const { openExternalUrl } = options;
  const viewerHost = await startViewerHost(options);
  const room = viewerHost.createRoom();
  let currentSource: PublishedModelSource | undefined;
  room.registerAction(
    {
      id: OPEN_IN_MANIFOLDCAD_ACTION_ID,
      label: 'Open in ManifoldCAD',
      icon: 'external-link',
      slot: 'toolbar',
      tone: 'default',
      requires: ['model'],
    },
    async () => {
      if (!currentSource) {
        throw new Error('No source is available for the displayed model.');
      }
      if (!openExternalUrl) {
        throw new Error('Opening external URLs is not available in this host.');
      }
      const link = createManifoldCadShareLink({
        code: currentSource.code,
        ...(currentSource.description !== undefined ? { name: currentSource.description } : {}),
      });
      await openExternalUrl(link.url);
      return { status: 'succeeded', message: 'Opened in the system browser.' };
    },
  );
  return {
    url: room.url,
    pushModel(model, source): void {
      room.pushModel(model);
      currentSource = source;
    },
    getAnnotations(): ViewerAnnotationSnapshot {
      return room.getAnnotations();
    },
    close(): Promise<void> {
      return viewerHost.close();
    },
  };
}
