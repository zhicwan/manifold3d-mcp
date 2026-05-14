#!/usr/bin/env node
/**
 * Entrypoint: starts the MCP server on stdio immediately. The preview
 * HTTP/WebSocket server (and the browser open) is deferred until the first
 * successful `execute_script` — until then the user sees nothing on disk
 * or in their browser, which is the polite behaviour for a server an MCP
 * client may have spawned eagerly.
 *
 * Logs only to stderr — stdout is reserved for MCP protocol frames.
 */
import open from 'open';
import { startPreviewServer, type PreviewServerHandle } from './preview/preview-server.js';
import { startMcpServer } from './mcp/mcp-server.js';

async function main(): Promise<void> {
  let previewPromise: Promise<PreviewServerHandle> | undefined;
  let preview: PreviewServerHandle | undefined;

  const getPreview = (): Promise<PreviewServerHandle> => {
    if (!previewPromise) {
      previewPromise = (async () => {
        const handle = await startPreviewServer();
        preview = handle;
        process.stderr.write(`[manifold-mcp] preview ready at ${handle.url}\n`);
        // Best-effort browser open; ignore failure (headless / no default browser).
        // Skip entirely when MANIFOLD_MCP_NO_OPEN is set — used by tests and headless
        // CI runs to avoid spawning a browser that would 404 once the server
        // shuts down.
        if (!process.env.MANIFOLD_MCP_NO_OPEN) {
          open(handle.url).catch(() => undefined);
        }
        return handle;
      })().catch(err => {
        // Reset so the next call can retry.
        previewPromise = undefined;
        throw err;
      });
    }
    return previewPromise;
  };

  await startMcpServer({ getPreview, peekPreview: () => preview });

  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`[manifold-mcp] received ${signal}, shutting down\n`);
    if (preview) {
      await preview.close();
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[manifold-mcp] fatal: ${msg}\n`);
  process.exit(1);
});
