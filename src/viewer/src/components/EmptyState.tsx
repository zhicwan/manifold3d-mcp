import { Box, Wifi } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useViewerState } from '@/store';

export function EmptyState() {
  const hasPayload = useViewerState(s => s.payload !== null);
  if (hasPayload) {
    return null;
  }

  return (
    <section className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center p-6">
      <Card className="pointer-events-auto max-w-xl border-white/70 bg-white/85 shadow-2xl backdrop-blur-xl">
        <CardHeader className="items-center text-center">
          <div className="relative mb-2 flex h-20 w-20 items-center justify-center rounded-3xl bg-secondary text-primary shadow-inner">
            <Box className="size-10" />
            <span className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full bg-teal-500 text-white shadow">
              <Wifi className="size-4" />
            </span>
          </div>
          <CardTitle>Waiting for model</CardTitle>
          <p className="max-w-md text-sm text-muted-foreground">
            No 3D model has been received yet. This viewer is listening for models pushed by an MCP client.
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-secondary/60 p-4 text-sm">
            <div className="mb-2 font-semibold">How to use</div>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Connect your AI assistant via MCP.</li>
              <li>Ask the AI to generate or modify a 3D model.</li>
              <li>
                The model appears here automatically once <code className="rounded bg-background px-1">execute_script</code>{' '}
                runs.
              </li>
              <li>Ctrl+click / Ctrl+drag to mark feedback; export to 3MF or STL when done.</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
