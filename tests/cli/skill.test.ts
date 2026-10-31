import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { command } from '../../src/domain/commands';

const skill = readFileSync('skills/anchorline/SKILL.md', 'utf8');

describe('Claude skill and plugin files', () => {
  it('has spec-correct frontmatter (Agent Skills: name matches folder, description ≤ 1024)', () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
    const field = (k: string) => new RegExp(`^${k}: (.*)$`, 'm').exec(fm)?.[1];
    expect(field('name')).toBe('anchorline');
    expect(field('name')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const description = field('description')!;
    expect(description.length).toBeGreaterThan(50);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(field('compatibility')!.length).toBeLessThanOrEqual(500);
    const keys = [...fm.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
    for (const k of keys) expect(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']).toContain(k);
    expect(skill.split('\n').length).toBeLessThan(500);
  });

  it('every command example in the reference is a valid Anchorline command', () => {
    const ref = readFileSync('skills/anchorline/references/commands.md', 'utf8');
    const lines = [...ref.matchAll(/```json\n([\s\S]*?)```/g)].flatMap((m) => m[1]!.split('\n').filter((l) => l.trim().startsWith('{')));
    expect(lines.length).toBeGreaterThan(15);
    for (const line of lines) {
      const parsed = command.safeParse(JSON.parse(line));
      expect(parsed.success, `${line}\n${parsed.success ? '' : parsed.error.message}`).toBe(true);
    }
  });

  it('plugin and marketplace manifests point at the bundled server and the same name', () => {
    const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
    const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(plugin.name).toBe('anchorline');
    expect(market.plugins[0].name).toBe(plugin.name);
    expect(market.plugins[0].source).toBe('./');
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.mcpServers.anchorline.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/skills/anchorline/scripts/anchorline.mjs', 'mcp']);
    expect(pkg.bin.anchorline).toBe('skills/anchorline/scripts/anchorline.mjs');
  });
});
