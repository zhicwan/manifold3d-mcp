import { ControlPanel } from './components/ControlPanel';
import { EmptyState } from './components/EmptyState';
import { MarksSidebar } from './components/MarksSidebar';
import { ViewerCanvas } from './components/ViewerCanvas';

export function App() {
  // App is now a thin shell: subsystems live in the store (VIE-6) so
  // the rare cross-component lookups don't require prop drilling.
  return (
    <>
      <ViewerCanvas />
      <EmptyState />
      <ControlPanel />
      <MarksSidebar />
    </>
  );
}
