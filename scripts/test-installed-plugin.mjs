import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'manifold-installed-plugin-')));
const plugin = join(scratch, 'installed plugin');
const workspace = join(scratch, 'unrelated workspace');
const output = join(scratch, 'runtime output');
const client = new Client({ name: 'installed-plugin-smoke', version: '1.0.0' });

try {
  await cp(join(root, 'plugins/manifold'), plugin, { recursive: true });
  await mkdir(workspace);
  await mkdir(output);
  const manifest = JSON.parse(await readFile(join(plugin, '.claude-plugin/plugin.json'), 'utf8'));
  const config = JSON.parse(await readFile(join(plugin, '.mcp.json'), 'utf8'));
  const product = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.version, product.version);
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.deepEqual(config.mcpServers['manifold3d-mcp'], {
    command: 'node',
    args: ['${CLAUDE_PLUGIN_ROOT}/bin/manifold.mjs'],
  });
  const entry = join(plugin, 'bin/manifold.mjs');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--permission',
      '--allow-worker',
      `--allow-fs-read=${entry}`,
      `--allow-fs-read=${workspace}`,
      `--allow-fs-write=${workspace}`,
      `--allow-fs-read=${output}`,
      `--allow-fs-write=${output}`,
      entry,
    ],
    cwd: workspace,
    env: {
      PATH: process.env.PATH ?? '',
      MANIFOLD_MCP_NO_OPEN: '1',
      TMPDIR: output,
      TMP: output,
      TEMP: output,
    },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, product.version);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
      'capture_view',
      'execute_script',
      'get_annotations',
      'validate_script',
    ]);
    const execution = await client.callTool({
      name: 'execute_script',
      arguments: { code: 'result = Manifold.cube([2, 3, 4], true);', description: 'Installed plugin cube' },
    });
    assert.equal(execution.isError, false, JSON.stringify(execution));
    const report = textReport(execution);
    assert.equal(report.ok, true);
    assert.equal(report.stats.triangles, 12);
    const viewerRoot = join(root, 'apps/manifold3d-mcp/build/viewer');
    const assets = await readdir(viewerRoot, { recursive: true, withFileTypes: true });
    for (const asset of assets.filter(item => item.isFile())) {
      const source = join(asset.parentPath, asset.name);
      const path = relative(viewerRoot, source).split('\\').join('/');
      const response = await globalThis.fetch(new URL(path, report.previewUrl));
      assert.equal(response.status, 200, path);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(source), path);
    }
    const capture = await client.callTool({
      name: 'capture_view',
      arguments: { view: 'front', width: 128, height: 256 },
    });
    assert.equal(capture.isError, false, JSON.stringify(capture));
    const captured = textReport(capture);
    assert.equal(captured.width, 128);
    assert.equal(captured.height, 256);
    const capturePath = relative(output, captured.filePath);
    assert(capturePath && !capturePath.startsWith('..') && !isAbsolute(capturePath));
    const png = await readFile(captured.filePath);
    assert.equal(png.readUInt32BE(16), 128);
    assert.equal(png.readUInt32BE(20), 256);

    const failure = textReport(
      await client.callTool({
        name: 'validate_script',
        arguments: {
          code: [
            'const value: { nested?: { size: number } } = {};',
            'const missing = value.nested as { size: number };',
            '// Mapping must work with no external resources.',
            'result = Manifold.cube(missing.size);',
          ].join('\n'),
        },
      }),
    );
    assert.equal(failure.ok, false);
    assert(failure.errors.some(issue => issue.code === 'RUNTIME_ERROR' && issue.line === 4));

    const filePath = join(workspace, 'example.ts');
    await writeFile(filePath, 'result = Manifold.cube(1);\n');
    assert.equal(textReport(await client.callTool({ name: 'validate_script', arguments: { filePath } })).ok, true);
    const annotations = await client.callTool({ name: 'get_annotations', arguments: {} });
    assert.notEqual(annotations.isError, true);
    assert.equal(textReport(annotations).count, 0);
  } catch (error) {
    throw new Error(`Installed MCP plugin failed.\n${stderr}`, { cause: error });
  }

  await testInstalledDshBundle(join(scratch, 'installed dsh bundle'), join(scratch, 'dsh workspace'));

  for (const [name, skill] of [
    ['manifold', 'use-manifold'],
    ['manifold-extension', 'use-manifold-canvas'],
    ['manifold-dsh', 'use-manifold-dsh'],
  ]) {
    const skillRoot = join(root, 'plugins', name, 'skills', skill);
    const entryText = await readFile(join(skillRoot, 'SKILL.md'), 'utf8');
    assert(entryText.includes(`name: ${skill}`));
    for (const file of await readdir(join(root, 'skills/shared/references'))) {
      assert.deepEqual(
        await readFile(join(skillRoot, 'references', file)),
        await readFile(join(root, 'skills/shared/references', file)),
      );
    }
  }
  process.stdout.write(
    'Installed plugin smoke passed: standalone MCP, DeepSeek Harness bundle, embedded Viewer, capture, error mapping and skills.\n',
  );
} finally {
  try {
    await client.close();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Load the copied DSH bundle the way the Harness does — an ES module whose
 * `apply(ctx)` registers tools, routes and the skill — against a minimal
 * Cordis-shaped context, and drive it with the real embedded Worker and Viewer.
 */
async function testInstalledDshBundle(bundle, dshWorkspace) {
  await cp(join(root, 'plugins/manifold-dsh'), bundle, { recursive: true });
  await mkdir(dshWorkspace);
  const product = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(bundle, 'package.json'), 'utf8'));
  assert.equal(manifest.version, product.version);
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  for (const file of ['client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json']) {
    await readFile(join(bundle, file));
  }

  const disposers = [];
  const tools = new Map();
  const routes = new Map();
  const skills = [];
  const listeners = new Map();
  const agent = { session: { id: 'installed-session' }, followup: () => undefined };
  const ctx = {
    get: name =>
      ({
        webServer: { getOrigin: () => 'http://127.0.0.1:9' },
        skills: {
          register: skill => {
            skills.push(skill);
            return () => undefined;
          },
        },
      })[name],
    on: (event, listener) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    effect: execute => {
      disposers.push(execute());
    },
    tools: {
      register: tool => {
        tools.set(tool.name, tool);
        return () => tools.delete(tool.name);
      },
    },
    connection: {
      allowsRemoteAuthorities: false,
      fetch: {
        register: route => {
          routes.set(route.path, route);
          return () => routes.delete(route.path);
        },
      },
    },
    agents: { get: id => (id === agent.session.id ? agent : undefined) },
    workingDirectory: { get: () => dshWorkspace },
  };
  const bundleModule = await import(pathToFileURL(join(bundle, 'index.js')).href);
  try {
    bundleModule.apply(ctx);
    assert.deepEqual([...tools.keys()].sort(), [
      'manifold_capture_view',
      'manifold_execute_script',
      'manifold_validate_script',
    ]);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'use-manifold-dsh');
    assert.equal(skills[0].resourceBase.path, join(bundle, 'skills/use-manifold-dsh'));
    const exec = { agent, signal: new AbortController().signal };
    const executed = await tools
      .get('manifold_execute_script')
      .execute({ code: 'result = Manifold.cube([2, 3, 4], true);', description: 'DSH cube' }, exec);
    assert.equal(executed.ok, true);
    assert.equal(executed.stats.triangles, 12);
    await assert.rejects(
      tools.get('manifold_validate_script').execute(
        {
          code: [
            'const value: { nested?: { size: number } } = {};',
            'const missing = value.nested as { size: number };',
            '// Mapping must work with no external resources.',
            'result = Manifold.cube(missing.size);',
          ].join('\n'),
        },
        exec,
      ),
      error => {
        const body = JSON.parse(error.message);
        assert(body.errors.some(issue => issue.code === 'RUNTIME_ERROR' && issue.line === 4));
        return true;
      },
    );
    const captured = await tools.get('manifold_capture_view').execute({ view: 'front', width: 128, height: 256 }, exec);
    assert.equal(captured.image, 'file');
    const png = await readFile(captured.filePath);
    assert.equal(png.readUInt32BE(16), 128);

    const response = await routes.get('/api/manifold3d/rooms').fetch(
      new Request('http://127.0.0.1/api/manifold3d/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: agent.session.id, tabId: 'tab-1' }),
      }),
    );
    assert.equal(response.status, 200);
    const { url } = await response.json();
    const page = await globalThis.fetch(url);
    assert.equal(page.status, 200);
    assert.match(
      page.headers.get('content-security-policy'),
      /frame-ancestors dsh-app:\/\/app http:\/\/127\.0\.0\.1:9/,
    );
  } finally {
    for (const dispose of disposers.reverse()) {
      await dispose?.();
    }
  }
}

function textReport(result) {
  const text = result.content.find(item => item.type === 'text')?.text;
  assert.equal(typeof text, 'string', JSON.stringify(result));
  return parseYaml(text);
}
