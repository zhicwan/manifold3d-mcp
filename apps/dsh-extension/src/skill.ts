/** The fields DSH needs to register an embedded skill from a SKILL.md file. */
export interface SkillDocument {
  name: string;
  description: string;
  content: string;
}

/**
 * Parse the small frontmatter subset used by this repository's shipped skills:
 * single-line `name:` and `description:` values between `---` fences.
 */
export function parseSkillDocument(document: string): SkillDocument {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(document);
  if (!match) {
    throw new Error('Skill document must start with frontmatter.');
  }
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line);
    if (field?.[1] && field[2] !== undefined) {
      fields.set(field[1], field[2].trim());
    }
  }
  const name = fields.get('name');
  const description = fields.get('description');
  if (!name || !description) {
    throw new Error('Skill frontmatter requires name and description.');
  }
  return { name, description, content: (match[2] ?? '').trim() };
}
