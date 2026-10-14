import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('commit attribution opt-in', () => {
  it('defaults to off in full and lightweight prompts, and follows persisted changes', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'tokenbird-co-author-'));
    const preferences = pathToFileURL(join(import.meta.dir, '..', 'preferences.ts')).href;
    const prompts = pathToFileURL(join(import.meta.dir, '../../prompts/system.ts')).href;
    try {
      const script = `
        import { getCoAuthorPreference, updatePreferences } from '${preferences}';
        import { getTokenBirdAssistantPrompt, getLightweightModelSystemPrompt } from '${prompts}';
        const snapshot = () => ({ enabled: getCoAuthorPreference(), full: getTokenBirdAssistantPrompt(), light: getLightweightModelSystemPrompt() });
        const initial = snapshot();
        updatePreferences({ includeCoAuthoredBy: true });
        const enabled = snapshot();
        updatePreferences({ includeCoAuthoredBy: false });
        console.log(JSON.stringify({ initial, enabled, disabled: snapshot() }));
      `;
      const result = Bun.spawnSync([process.execPath, '--eval', script], {
        env: { ...process.env, TOKENBIRD_CONFIG_DIR: configDir }, stdout: 'pipe', stderr: 'pipe',
      });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      const { initial, enabled, disabled } = JSON.parse(result.stdout.toString());
      for (const state of [initial, disabled]) {
        expect(state.enabled).toBe(false);
        for (const prompt of [state.full, state.light]) {
          expect(prompt).not.toContain('Co-Authored-By:');
          expect(prompt.toLowerCase()).toContain('do not add ai co-author');
        }
      }
      expect(enabled.enabled).toBe(true);
      for (const prompt of [enabled.full, enabled.light]) {
        expect(prompt).toContain('Co-Authored-By: TokenBird <agents-noreply@tokenbird.invalid>');
        expect(prompt).not.toContain('agents-noreply@craft.do');
      }
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  }, 60000);
});
