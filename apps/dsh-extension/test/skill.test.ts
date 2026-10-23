import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSkillDocument } from '../src/skill.js';

describe('DSH skill registration document', () => {
  it('parses the shipped use-manifold-dsh entry', async () => {
    const skill = parseSkillDocument(await readFile(resolve('skills/use-manifold-dsh/SKILL.md'), 'utf8'));
    expect(skill.name).toBe('use-manifold-dsh');
    expect(skill.description).toMatch(/DeepSeek Harness/);
    expect(skill.content.startsWith('# use-manifold-dsh')).toBe(true);
  });

  it('rejects documents without required frontmatter', () => {
    expect(() => parseSkillDocument('# no frontmatter')).toThrow(/frontmatter/);
    expect(() => parseSkillDocument('---\nname: x\n---\nbody')).toThrow(/description/);
  });
});
