import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(dir, p), 'utf8');

describe('workspace picker errors and account context', () => {
	const files = ['InputMenu/Knowledge.svelte', 'InputMenu/Notes.svelte', 'Commands/Knowledge.svelte'];
	for (const file of files) {
		it(`${file} shows readable errors with retry and resets on account change`, () => {
			const src = read(file);
			expect(src).toContain('describeApiError');
			expect(src).toContain("$i18n.t('Retry')");
			expect(src).toContain('role="alert"');
			expect(src).toContain('$user?.id');
			expect(src).toContain('accountKey');
			expect(src).toContain('error = describeApiError(e)');
			expect(src).not.toContain('.catch(() => null)');
			expect(src).not.toContain('.catch(() => [])');
		});
	}
});
