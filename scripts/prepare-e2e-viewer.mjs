import { resolve } from 'node:path';

import { completeViewerLicenses } from './bundle-application.mjs';

await completeViewerLicenses(resolve(import.meta.dirname, '../apps/copilot-extension/build/viewer'));
