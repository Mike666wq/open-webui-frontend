import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url)); // .../workspace/Models
const read = (p: string) => readFileSync(join(dir, p), 'utf8');

// P-007: the backend gates knowledge WRITE tools behind its own
// `info.meta.builtinTools.knowledge_manage` category so an administrator can
// grant read-only access without granting write. That category has to be
// visible in the model settings UI, or nobody can turn it off.
describe('P-007: knowledge_manage builtin-tool category', () => {
	const component = read('BuiltinTools.svelte');

	it('declares a knowledge_manage entry next to knowledge', () => {
		expect(component).toContain('knowledge_manage: {');

		const knowledgeIdx = component.indexOf('\t\tknowledge: {');
		const manageIdx = component.indexOf('\t\tknowledge_manage: {');
		const filesIdx = component.indexOf('\t\tfiles: {');

		expect(knowledgeIdx).toBeGreaterThan(-1);
		expect(manageIdx).toBeGreaterThan(knowledgeIdx);
		expect(filesIdx).toBeGreaterThan(manageIdx);
	});

	it('reads its copy from the shared builtinTools namespace', () => {
		expect(component).toContain(
			"$i18n.t('settings.admin.models.builtinTools.knowledgeManage.label')"
		);
		expect(component).toContain(
			"$i18n.t('settings.admin.models.builtinTools.knowledgeManage.description')"
		);
	});

	it('keeps the "unspecified means enabled" convention', () => {
		// The component stores `false` to disable and deletes the key to enable;
		// an absent key must therefore read as enabled, which is what the backend
		// does too.
		expect(component).toContain('builtinTools[key] !== false');
		expect(component).toContain('delete builtinTools[tool];');
	});

	it('both locales carry the new keys', () => {
		const root = join(dir, '../../../i18n/locales');
		const zh = JSON.parse(readFileSync(join(root, 'zh-CN/translation.json'), 'utf8'));
		const en = JSON.parse(readFileSync(join(root, 'en-US/translation.json'), 'utf8'));

		const labelKey = 'settings.admin.models.builtinTools.knowledgeManage.label';
		const descriptionKey = 'settings.admin.models.builtinTools.knowledgeManage.description';

		expect(zh[labelKey], 'zh-CN missing label').toBe('知识库写入');
		expect(zh[descriptionKey], 'zh-CN missing description').toBeTruthy();
		expect(en[labelKey], 'en-US missing label').toBe('Knowledge write');
		expect(en[descriptionKey], 'en-US missing description').toBeTruthy();

		// Parity with the neighbours: the read category keeps its own keys.
		expect(zh['settings.admin.models.builtinTools.knowledge.label']).toBeTruthy();
		expect(en['settings.admin.models.builtinTools.knowledge.label']).toBeTruthy();
	});

	it('the description does not promise writes without read access', () => {
		const root = join(dir, '../../../i18n/locales');
		const en = JSON.parse(readFileSync(join(root, 'en-US/translation.json'), 'utf8'));
		const zh = JSON.parse(readFileSync(join(root, 'zh-CN/translation.json'), 'utf8'));

		// The backend withholds write tools when `knowledge` (read) is off, so the
		// copy must not claim independent write capability.
		expect(en['settings.admin.models.builtinTools.knowledgeManage.description']).not.toMatch(
			/independent|on its own|without read/i
		);
		expect(zh['settings.admin.models.builtinTools.knowledgeManage.description']).not.toMatch(
			/独立于|不依赖/
		);
	});
});
