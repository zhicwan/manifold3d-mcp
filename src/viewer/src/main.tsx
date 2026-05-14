import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './tailwind.css';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Missing #root element in index.html');
}

createRoot(rootEl).render(<App />);
