#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function existingFile(path) {
  if (!path) {
    return undefined;
  }

  const resolved = resolve(path);
  try {
    return existsSync(resolved) && statSync(resolved).isFile() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

const localEntry =
  existingFile(process.env.MANIFOLD_MCP_LOCAL_ENTRY) ??
  existingFile(resolve(process.cwd(), 'dist/server/index.js')) ??
  existingFile(resolve(pluginRoot, '../dist/server/index.js'));

const command = localEntry ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = localEntry ? [localEntry] : ['-y', '@zhicwan/manifold-mcp'];

const child = spawn(command, args, {
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on('error', error => {
  process.stderr.write(`[manifold-mcp] failed to start MCP server: ${error.message}\n`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (typeof code === 'number') {
    process.exit(code);
  }
  process.stderr.write(`[manifold-mcp] MCP server exited after signal ${signal ?? 'unknown'}\n`);
  process.exit(1);
});
