import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { parse as parseYaml } from 'yaml';

import { assemblePlugins } from '../scripts/build-plugins.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'manifold-assembly-test-'));
  try {
    const files = {
      'package.json': JSON.stringify({ version: '1.2.3', author: { name: 'Example' }, description: 'Example plugins' }),
      LICENSE: 'license\n',
      NOTICE: 'notice\n',
      'apps/manifold3d-mcp/dist/manifold.mjs': 'export {};\n',
      'apps/copilot-extension/dist/extension.mjs': 'export {};\n',
      'skills/use-manifold/SKILL.md': 'name: use-manifold\n',
      'skills/use-manifold-canvas/SKILL.md': 'name: use-manifold-canvas\n',
      'skills/shared/references/api.md': 'shared reference\n',
      'skills/shared/references/design-workflow.md': '[FDM](printing-fdm.md)\n',
      'skills/shared/references/printing-fdm.md': 'filament design guidance\n',
      'skills/shared/references/printing-resin.md': 'resin design guidance\n',
      'skills/shared/references/printing-sls.md': 'SLS design guidance\n',
      'skills/shared/references/verification-and-handoff.md': 'evidence and trial feedback\n',
    };
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('plugin assembly helpers', () => {
  it('validates release tags through the GitHub Script action before uploading artifacts', async () => {
    const workflow = parseYaml(await readFile('.github/workflows/cd.yml', 'utf8'));
    const steps = workflow.jobs.publish.steps;
    const index = steps.findIndex(step => step.name === 'Verify tag matches product version');
    const validation = steps[index];
    expect(validation.uses).toMatch(/^actions\/github-script@[a-f0-9]{40}$/);
    expect(validation.run).toBeUndefined();
    expect(steps.findIndex(step => step.uses?.startsWith('softprops/action-gh-release@'))).toBeGreaterThan(index);
    const metadata = JSON.parse(await readFile('package.json', 'utf8'));
    for (const [ref, errors] of [
      [`refs/tags/v${metadata.version}`, []],
      ['refs/tags/v0.0.0', [`Tag v0.0.0 does not match product version (v${metadata.version})`]],
    ]) {
      const failures = [];
      runInNewContext(validation.with.script, {
        require: specifier => {
          expect(specifier).toBe('./package.json');
          return metadata;
        },
        context: { ref },
        core: { setFailed: message => failures.push(message) },
      });
      expect(failures).toEqual(errors);
    }
  });

  it('ships browser-only license overrides in both standalone bundles', async () => {
    for (const path of [
      'plugins/manifold/bin/manifold.mjs',
      'plugins/manifold-extension/extensions/manifold/extension.mjs',
    ]) {
      const bundle = await readFile(path, 'utf8');
      expect(bundle).toContain('Copyright (c) 2021 Davor Hrg');
      expect(bundle).toContain('Copyright (c) 2026 Nodable');
    }
  });

  it('extracts tool names from markdown and TypeScript sources', async () => {
    const sync = await import('../scripts/check-sync.mjs');
    const markdown = `
# Example

## Tools

- **\`alpha\`** — first tool
- **\`beta\`** — second tool
`;
    expect(sync.collectMarkdownToolNames(markdown)).toEqual({ tools: ['alpha', 'beta'], error: null });

    const source = `
      export const tools = [
        { name: 'gamma', handler() {} },
        { name: 'delta', handler() {} },
      ];
    `;
    expect(sync.collectSourceToolNames(source, 'fixture.ts')).toEqual({ tools: ['delta', 'gamma'], error: null });
    expect(
      sync.compareToolContracts({
        sourceTools: ['alpha', 'beta'],
        skillTools: ['alpha', 'beta'],
        label: 'fixture',
      }),
    ).toBeNull();
  });

  it('builds plugin manifests from the root version and existing metadata', async () => {
    const build = await import('../scripts/build-plugins.mjs');
    const metadata = {
      author: { name: 'Example Author' },
      homepage: 'https://example.com',
      repository: 'https://example.com/repo',
      license: 'Apache-2.0',
      keywords: ['one', 'two'],
      description: 'MCP description',
      extensionDescription: 'Extension description',
    };

    expect(build.createManifoldPluginManifest({ version: '1.2.3', metadata })).toMatchObject({
      name: 'manifold',
      version: '1.2.3',
      skills: './skills/',
      mcpServers: './.mcp.json',
      author: metadata.author,
    });
    expect(build.createManifoldExtensionManifest({ version: '1.2.3', metadata })).toMatchObject({
      name: 'manifold-extension',
      version: '1.2.3',
      skills: './skills/',
      extensions: './extensions/',
      author: metadata.author,
    });
  });

  it('assembles independent skills and different catalogs without reading prior output', async () => {
    await fixture(async root => {
      await assemblePlugins({ root });
      for (const [plugin, skill] of [
        ['manifold', 'use-manifold'],
        ['manifold-extension', 'use-manifold-canvas'],
      ]) {
        expect(await readFile(join(root, 'plugins', plugin, 'skills', skill, 'references/api.md'), 'utf8')).toBe(
          'shared reference\n',
        );
        for (const name of [
          'design-workflow.md',
          'printing-fdm.md',
          'printing-resin.md',
          'printing-sls.md',
          'verification-and-handoff.md',
        ]) {
          expect(await readFile(join(root, 'plugins', plugin, 'skills', skill, 'references', name), 'utf8')).toBe(
            await readFile(join(root, 'skills/shared/references', name), 'utf8'),
          );
        }
      }
      const github = JSON.parse(await readFile(join(root, '.github/plugin/marketplace.json'), 'utf8'));
      const claude = JSON.parse(await readFile(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
      expect(github.plugins.map(plugin => plugin.name)).toEqual(['manifold', 'manifold-extension']);
      expect(claude.plugins.map(plugin => plugin.name)).toEqual(['manifold']);
      await assemblePlugins({ root, check: true });
    });
  });

  it('reports drift without replacing it, including unexpected generated files', async () => {
    await fixture(async root => {
      await assemblePlugins({ root });
      const changed = join(root, 'plugins/manifold/skills/use-manifold/SKILL.md');
      await writeFile(changed, 'manual change\n');
      await expect(assemblePlugins({ root, check: true })).rejects.toThrow('stale');
      expect(await readFile(changed, 'utf8')).toBe('manual change\n');
      await assemblePlugins({ root });
      await writeFile(join(root, 'plugins/manifold/unexpected.txt'), 'extra\n');
      await expect(assemblePlugins({ root, check: true })).rejects.toThrow('Unexpected');
    });
  });

  it('rejects conflicting sources before deleting the previous installation output', async () => {
    await fixture(async root => {
      await assemblePlugins({ root });
      await mkdir(join(root, 'skills/use-manifold/references'));
      await writeFile(join(root, 'skills/use-manifold/references/api.md'), 'conflict\n');
      await expect(assemblePlugins({ root })).rejects.toThrow('collide');
      expect(await readFile(join(root, 'plugins/manifold/bin/manifold.mjs'), 'utf8')).toBe('export {};\n');
    });
  });
});
