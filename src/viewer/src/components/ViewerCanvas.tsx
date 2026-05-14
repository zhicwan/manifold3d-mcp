import { useEffect, useRef } from 'react';

import { installMarks } from '@/marks';
import { installAnnotationsUplink } from '@/marks/ws-uplink';
import { Viewer, type RenderMode } from '@/scene/viewer';
import { connectMeshFeed, type MeshFeedHandle } from '@/transport/ws-client';
import type { PreviewPayload } from '@/types';
import { viewerStore } from '@/store';

// Re-export for back-compat with any external imports; the runtime
// types now live in @/store (VIE-6).
export type { MarksRuntime, ViewerApi } from '@/store';

export function ViewerCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) {
      throw new Error('ViewerCanvas mounted without canvas/overlay refs');
    }

    const viewer = new Viewer(canvas);
    let lastPayload: PreviewPayload | null = null;

    const marks = installMarks({
      scene: viewer.scene,
      camera: viewer.camera,
      controls: viewer.controls,
      canvas,
      overlayHost: overlay,
      getMesh: () => viewer.getMesh(),
      requestRender: () => viewer.requestRender(),
    });
    const removeMarksFrameHook = viewer.addPerFrameHook(() => marks.frame());

    let feedHandle: MeshFeedHandle | null = null;
    const uplink = installAnnotationsUplink(marks.store, {
      send(msg) {
        feedHandle?.send(msg);
      },
      isOpen() {
        return feedHandle?.isOpen() ?? false;
      },
    });

    feedHandle = connectMeshFeed({
      onMesh: payload => {
        lastPayload = payload;
        viewerStore.setPayload(payload);
        viewer.setMesh(payload);
        marks.setPayload(payload);
      },
      onModelVersion: version => {
        viewerStore.setModelVersion(version);
        marks.setModelVersion(version);
      },
      onOpen: () => uplink.flushNow(),
      onStatusChange: status => viewerStore.setStatus(status),
    });

    viewerStore.setMarksRuntime({ store: marks.store, flyouts: marks.flyouts });
    viewerStore.setViewerApi({
      setRenderMode(mode: RenderMode): void {
        viewerStore.setRenderMode(mode);
        viewer.setRenderMode(mode);
      },
      // VIE-4: dynamic-import the exporter modules. They pull in
      // @jscadui/3mf-export, fflate, and three's STLExporter — together
      // ~85 KB minified. The first export click incurs a brief module
      // load; subsequent clicks reuse the now-resident chunk.
      async export3mf(): Promise<void> {
        if (!lastPayload) {
          return;
        }
        const { export3mf } = await import('@/exporters/three-mf');
        download(export3mf(lastPayload), filename(lastPayload, '3mf'));
      },
      async exportStl(): Promise<void> {
        const mesh = viewer.getMesh();
        if (!mesh) {
          return;
        }
        const { exportStl } = await import('@/exporters/stl');
        download(exportStl(mesh), filename(lastPayload, 'stl'));
      },
    });

    return () => {
      viewerStore.setViewerApi(null);
      viewerStore.setMarksRuntime(null);
      feedHandle?.close();
      uplink.dispose();
      removeMarksFrameHook();
      marks.dispose();
      viewer.dispose();
      viewerStore.setPayload(null);
      viewerStore.setStatus('disconnected');
    };
  }, []);

  return (
    <>
      {/*
        VIE-8 a11y: the canvas is graphical content; assistive tech can't
        read its pixels. role="img" plus a descriptive label gives screen
        readers something to announce. The label is intentionally generic
        because the rendered content changes per-mesh; ControlPanel's
        ModelInfo block carries the structured metadata.
      */}
      <canvas id="view" ref={canvasRef} role="img" aria-label="3D model preview" />
      <div id="marks-overlay" ref={overlayRef} />
    </>
  );
}

function filename(payload: PreviewPayload | null, ext: string): string {
  const slug =
    (payload?.description || 'model')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'model';
  return `${slug}.${ext}`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
