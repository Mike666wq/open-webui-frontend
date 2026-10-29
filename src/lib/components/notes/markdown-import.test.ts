import { describe, expect, it } from 'vitest';
import sha256 from 'js-sha256';

import {
	analyzeMarkdownNote,
	buildImportPreview,
	crossBatchAssetKey,
	decodePercentPath,
	isImagePath,
	isMarkdownPath,
	knowledgeImageMarker,
	markdownImportMeta,
	noteContentHash,
	noteTitleFromPath,
	parseImageRefs,
	normalizeRelativePath,
	resolveRefPath,
	rewriteImageRefs
} from './markdown-import';

// P-006 S1 — tests for the pure Markdown import core (K1/K2/K14/K17/K18).
// The percent-decode-before-collapse order, the K14 rejection kinds and the
// same-name directory rule (K17) are pinned explicitly below.

const destsOf = (markdown: string) => parseImageRefs(markdown).map((r) => r.dest);

describe('parseImageRefs (K1)', () => {
	it('parses bare destinations with alt and no title', () => {
		const refs = parseImageRefs('![alt](img/a.png)');
		expect(refs).toHaveLength(1);
		expect(refs[0]).toEqual({
			raw: '![alt](img/a.png)',
			alt: 'alt',
			title: null,
			dest: 'img/a.png',
			decodedPath: 'img/a.png',
			external: false
		});
	});

	it('parses <...> wrapped destinations with spaces in the file name', () => {
		expect(destsOf('![alt](<a b.png>)')).toEqual(['a b.png']);
		expect(destsOf('![alt](<中文 目 录/图 片.png>)')).toEqual(['中文 目 录/图 片.png']);
	});

	it('parses optional double and single quoted titles', () => {
		const refs = parseImageRefs('![a](img/a.png "标题")\n![b](img/b.png \'t\')');
		expect(refs.map((r) => r.title)).toEqual(['标题', 't']);
	});

	it('strips fragments and queries from bare destinations', () => {
		expect(destsOf('![alt](img/a.png#frag)')).toEqual(['img/a.png']);
		expect(destsOf('![alt](img/a.png?v=2)')).toEqual(['img/a.png']);
	});

	it('keeps # and ? literal inside <...> (Typora style)', () => {
		expect(destsOf('![alt](<a#b.png>)')).toEqual(['a#b.png']);
		expect(destsOf('![alt](<a?b.png>)')).toEqual(['a?b.png']);
	});

	it('strips # and ? in bare destinations but keeps %23/%3F as filename characters after decoding', () => {
		// Everything from the first bare `#`/`?` on is treated as the fragment.
		expect(destsOf('![alt](a#b.png)')).toEqual(['a']);
		expect(destsOf('![alt](img/a.png#frag)')).toEqual(['img/a.png']);
		const refs = parseImageRefs('![alt](a%23b.png)');
		expect(refs[0].dest).toBe('a%23b.png');
		expect(refs[0].decodedPath).toBe('a#b.png');
	});

	it('decodes percent escapes into decodedPath while keeping dest raw', () => {
		const refs = parseImageRefs('![alt](a%20b.png)');
		expect(refs[0].dest).toBe('a%20b.png');
		expect(refs[0].decodedPath).toBe('a b.png');
	});

	it('marks http(s) references as external', () => {
		const refs = parseImageRefs('![a](https://example.com/x.png) ![b](http://e.com/y.jpg)');
		expect(refs.map((r) => r.external)).toEqual([true, true]);
		expect(destsOf('![a](ftp://e.com/z.png)')).toEqual(['ftp://e.com/z.png']);
		expect(parseImageRefs('![a](ftp://e.com/z.png)')[0].external).toBe(false);
	});

	it('keeps ./ ../ and sub-directory relative targets as written', () => {
		expect(destsOf('![a](./x.png)')).toEqual(['./x.png']);
		expect(destsOf('![a](../up/x.png)')).toEqual(['../up/x.png']);
		expect(destsOf('![a](sub/dir/x.png)')).toEqual(['sub/dir/x.png']);
	});

	it('allows balanced single-level parentheses in file names', () => {
		expect(destsOf('![a](a(1).png)')).toEqual(['a(1).png']);
	});

	it('ignores references inside fenced code blocks', () => {
		const md = [
			'```text',
			'![in](fence.png)',
			'```',
			'~~~',
			'![in2](fence2.png)',
			'~~~',
			'![out](real.png)'
		].join('\n');
		expect(destsOf(md)).toEqual(['real.png']);
	});

	it('parses the real Typora sample shape (Chinese directory, long digit name)', () => {
		const sample = '![image-20250316143441157](19.Zabbix/image-20250316143441157.png)';
		const refs = parseImageRefs(sample);
		expect(refs[0].alt).toBe('image-20250316143441157');
		expect(refs[0].dest).toBe('19.Zabbix/image-20250316143441157.png');
		expect(refs[0].decodedPath).toBe('19.Zabbix/image-20250316143441157.png');
		expect(refs[0].external).toBe(false);
	});
});

describe('decodePercentPath', () => {
	it('decodes valid escapes including multi-byte UTF-8', () => {
		expect(decodePercentPath('a%20b.png')).toBe('a b.png');
		expect(decodePercentPath('%E4%B8%AD%E6%96%87.png')).toBe('中文.png');
	});

	it('keeps stray or invalid percent sequences unchanged', () => {
		expect(decodePercentPath('100%')).toBe('100%');
		expect(decodePercentPath('a%zz.png')).toBe('a%zz.png');
		expect(decodePercentPath('plain.png')).toBe('plain.png');
	});
});

describe('normalizeRelativePath (K14)', () => {
	const okPath = (raw: string) => {
		const res = normalizeRelativePath(raw);
		expect(res).toEqual({ ok: true, path: expect.any(String) });
		return res.ok ? res.path : '';
	};
	const rejectedKind = (raw: string) => {
		const res = normalizeRelativePath(raw);
		expect(res.ok).toBe(false);
		return res.ok ? null : res.rejection.kind;
	};

	it('accepts and collapses ordinary relative paths', () => {
		expect(okPath('img/a.png')).toBe('img/a.png');
		expect(okPath('./img/a.png')).toBe('img/a.png');
		expect(okPath('a/../b.png')).toBe('b.png');
		expect(okPath('中文目录/图.png')).toBe('中文目录/图.png');
		expect(okPath('a b.png')).toBe('a b.png');
		expect(okPath('sub\\win.png')).toBe('sub/win.png');
	});

	it('rejects ../ traversal with kind "escape"', () => {
		expect(rejectedKind('../../etc/passwd')).toBe('escape');
		expect(rejectedKind('a/../../b.png')).toBe('escape');
	});

	it('rejects absolute POSIX paths with kind "absolute"', () => {
		expect(rejectedKind('/etc/passwd')).toBe('absolute');
	});

	it('rejects Windows drive letters with kind "drive"', () => {
		expect(rejectedKind('C:\\x')).toBe('drive');
		expect(rejectedKind('C:/x')).toBe('drive');
	});

	it('rejects empty, dot and bare ".." paths with kind "empty"/"escape"', () => {
		expect(rejectedKind('')).toBe('empty');
		expect(rejectedKind('   ')).toBe('empty');
		expect(rejectedKind('.')).toBe('empty');
		expect(rejectedKind('./')).toBe('empty');
		expect(rejectedKind('..')).toBe('escape');
	});

	it('decodes percent escapes BEFORE collapsing ".." — encoded traversal cannot bypass K14', () => {
		expect(rejectedKind('..%2f..%2fetc')).toBe('escape');
		expect(rejectedKind('%2e%2e/%2e%2e/etc/passwd')).toBe('escape');
		expect(rejectedKind('%2fetc/passwd')).toBe('absolute');
	});

	it('reports the raw input path in the rejection', () => {
		const res = normalizeRelativePath('../evil.png');
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.rejection.path).toBe('../evil.png');
			expect(typeof res.rejection.reason).toBe('string');
		}
	});
});

describe('resolveRefPath', () => {
	it('joins the target against the Markdown directory', () => {
		expect(resolveRefPath('', 'img/a.png')).toEqual({ ok: true, path: 'img/a.png' });
		expect(resolveRefPath('notes', 'img/a.png')).toEqual({ ok: true, path: 'notes/img/a.png' });
		expect(resolveRefPath('notes/', 'a.png')).toEqual({ ok: true, path: 'notes/a.png' });
	});

	it('resolves .. against the Markdown directory', () => {
		expect(resolveRefPath('notes', '../shared/x.png')).toEqual({ ok: true, path: 'shared/x.png' });
	});

	it('still rejects escaping targets', () => {
		const res = resolveRefPath('notes', '../../x.png');
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.rejection.kind).toBe('escape');
	});
});

describe('analyzeMarkdownNote (K17 same-name directory rule)', () => {
	const files = [
		'other.png',
		'notes/报告.md',
		'notes/报告/a.png',
		'notes/报告/b.png',
		'notes/报告/c.png',
		'notes/报告/d.png',
		'notes/报告/e.png',
		'notes/报告/sub/deep.png'
	];
	const body = [
		'![一](报告/a.png)',
		'![二](报告/b.png)',
		'![三](报告/c.png)',
		'![外](https://example.com/x.png)',
		'![缺](missing.png)',
		'![坏](../../evil.png)',
		'![外目录](../other.png)'
	].join('\n');
	const analysis = analyzeMarkdownNote('notes/报告.md', body, files);

	it('detects the same-name image directory and its direct images only', () => {
		expect(analysis.mdDir).toBe('notes');
		expect(analysis.title).toBe('报告');
		expect(analysis.imageDir).toBe('notes/报告');
		expect(analysis.dirImages).toEqual([
			'notes/报告/a.png',
			'notes/报告/b.png',
			'notes/报告/c.png',
			'notes/报告/d.png',
			'notes/报告/e.png'
		]);
	});

	it('splits referenced vs orphan directory images (3 referenced, 2 orphans)', () => {
		expect(analysis.referencedDirImages).toEqual([
			'notes/报告/a.png',
			'notes/报告/b.png',
			'notes/报告/c.png'
		]);
		expect(analysis.orphanImages).toEqual(['notes/报告/d.png', 'notes/报告/e.png']);
	});

	it('classifies missing, rejected, external and outside-directory references', () => {
		expect(analysis.missingRefs).toEqual([
			{ raw: '![缺](missing.png)', path: 'notes/missing.png' }
		]);
		expect(analysis.rejectedRefs).toEqual([
			{ raw: '![坏](../../evil.png)', kind: 'escape', reason: '路径越出导入根目录' }
		]);
		expect(analysis.externalRefs).toHaveLength(1);
		expect(analysis.externalRefs[0].dest).toBe('https://example.com/x.png');
		expect(analysis.outsideDirRefs).toEqual([
			{ raw: '![外目录](../other.png)', path: 'other.png' }
		]);
	});

	it('resolves per-reference even without a same-name directory', () => {
		const res = analyzeMarkdownNote('solo.md', '![x](pic.png)', ['solo.md', 'pic.png']);
		expect(res.imageDir).toBeNull();
		expect(res.dirImages).toEqual([]);
		expect(res.orphanImages).toEqual([]);
		expect(res.outsideDirRefs).toEqual([{ raw: '![x](pic.png)', path: 'pic.png' }]);
	});

	it('resolves bare references against the Markdown directory, not the same-name directory', () => {
		// From notes/报告.md, `a.png` means notes/a.png — only `报告/a.png`
		// (or ../报告/a.png) reaches the same-name directory.
		const res = analyzeMarkdownNote('notes/报告.md', '![x](a.png)', [
			'notes/报告.md',
			'notes/报告/a.png'
		]);
		expect(res.referencedDirImages).toEqual([]);
		expect(res.orphanImages).toEqual(['notes/报告/a.png']);
		expect(res.missingRefs).toEqual([{ raw: '![x](a.png)', path: 'notes/a.png' }]);
	});

	it('resolves the real Typora sample against its same-name directory', () => {
		const res = analyzeMarkdownNote(
			'19.Zabbix.md',
			'![image-20250316143441157](19.Zabbix/image-20250316143441157.png)',
			['19.Zabbix.md', '19.Zabbix/image-20250316143441157.png']
		);
		expect(res.imageDir).toBe('19.Zabbix');
		expect(res.referencedDirImages).toEqual(['19.Zabbix/image-20250316143441157.png']);
		expect(res.orphanImages).toEqual([]);
	});

	it('honours a custom isImageFile predicate', () => {
		const res = analyzeMarkdownNote('notes/报告.md', body, files, { isImageFile: () => false });
		expect(res.dirImages).toEqual([]);
		expect(res.orphanImages).toEqual([]);
	});
});

describe('rewriteImageRefs', () => {
	it('rewrites mapped references to new URLs preserving alt and title', () => {
		const md = '![alt](img/a.png "标题")\n![b](img/missing.png)';
		const { content, outcomes } = rewriteImageRefs(
			md,
			(ref, path) => (path === 'img/a.png' ? { form: 'url', url: 'data://f1' } : null)
		);
		expect(content).toBe('![alt](data://f1 "标题")\n![b](img/missing.png)');
		expect(outcomes).toHaveLength(2);
		expect(outcomes[0]).toEqual({
			raw: '![alt](img/a.png "标题")',
			status: 'rewritten',
			alt: 'alt',
			title: '标题',
			path: 'img/a.png',
			from: 'img/a.png',
			to: 'data://f1'
		});
		expect(outcomes[1]).toMatchObject({ status: 'unresolved', path: 'img/missing.png', to: null });
	});

	it('keeps unresolved references as raw text in the content', () => {
		const { content } = rewriteImageRefs('![b](img/missing.png)', () => null);
		expect(content).toBe('![b](img/missing.png)');
	});

	it('replaces the whole reference with the text form (knowledge marker)', () => {
		const { content, outcomes } = rewriteImageRefs('![a](img/a.png)', () => ({
			form: 'text',
			text: '[图片 a.png]'
		}));
		expect(content).toBe('[图片 a.png]');
		expect(outcomes[0]).toMatchObject({ status: 'rewritten', to: '[图片 a.png]' });
	});

	it('leaves external references untouched when resolve returns null', () => {
		const { content, outcomes } = rewriteImageRefs(
			'![a](https://example.com/x.png)',
			(ref, path) => (path === null ? { form: 'url', url: 'data://ext' } : null)
		);
		// path === null signals "external"; returning null keeps the original text.
		const kept = rewriteImageRefs('![a](https://example.com/x.png)', () => null);
		expect(kept.content).toBe('![a](https://example.com/x.png)');
		expect(kept.outcomes[0]).toMatchObject({
			status: 'external',
			path: null,
			from: 'https://example.com/x.png',
			to: null
		});
		expect(outcomes[0].status).toBe('rewritten');
		expect(content).toBe('![a](data://ext)');
	});

	it('reports rejected paths with the rejection reason and keeps the raw text', () => {
		const { content, outcomes } = rewriteImageRefs('![x](../evil.png)', () => null);
		expect(content).toBe('![x](../evil.png)');
		expect(outcomes[0]).toMatchObject({
			status: 'rejected',
			path: null,
			reason: '路径越出导入根目录'
		});
	});

	it('resolves against the mdDir option', () => {
		const { content, outcomes } = rewriteImageRefs(
			'![a](../shared/x.png)',
			(ref, path) => (path === 'shared/x.png' ? { form: 'url', url: 'data://f9' } : null),
			{ mdDir: 'notes' }
		);
		expect(content).toBe('![a](data://f9)');
		expect(outcomes[0]).toMatchObject({ status: 'rewritten', path: 'shared/x.png' });
	});

	it('never rewrites references inside fenced code blocks', () => {
		const md = '```\n![x](img/a.png)\n```\n![y](img/a.png)';
		const { content, outcomes } = rewriteImageRefs(md, () => ({ form: 'url', url: 'data://f' }));
		expect(content).toBe('```\n![x](img/a.png)\n```\n![y](data://f)');
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0].alt).toBe('y');
	});

	it('builds the knowledge marker from the normalized path basename', () => {
		expect(knowledgeImageMarker('a/b/中文 图.png')).toBe('[图片 中文 图.png]');
	});
});

describe('idempotency keys and meta (#4/#9)', () => {
	it('noteContentHash is the sha256 hex of the content and is stable', () => {
		expect(noteContentHash('hello')).toBe(sha256('hello'));
		expect(noteContentHash('hello')).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
		);
		expect(noteContentHash('hello')).not.toBe(noteContentHash('hello2'));
	});

	it('markdownImportMeta has the markdown_import block, omitting imported_at when absent', () => {
		expect(markdownImportMeta('a/b.md', 'ff00')).toEqual({
			markdown_import: { source_path: 'a/b.md', content_hash: 'ff00' }
		});
		const withAt = markdownImportMeta('a/b.md', 'ff00', 1700000000000);
		expect(withAt.markdown_import.imported_at).toBe(1700000000000);
		expect('imported_at' in markdownImportMeta('a/b.md', 'ff00')).toBe(false);
	});

	it('crossBatchAssetKey is (filename, size, sha256 first 32 hex chars) and stable', () => {
		const h1 = 'a'.repeat(64);
		expect(crossBatchAssetKey('a.png', 12, h1)).toBe(`a.png:12:${'a'.repeat(32)}`);
		// Hash tail beyond 32 hex chars does not affect the key.
		const h2 = 'a'.repeat(32) + 'b'.repeat(32);
		expect(crossBatchAssetKey('a.png', 12, h1)).toBe(crossBatchAssetKey('a.png', 12, h2));
		// Different name, size or hash prefix produce different keys.
		expect(crossBatchAssetKey('a.png', 12, h1)).not.toBe(crossBatchAssetKey('a.png', 13, h1));
		expect(crossBatchAssetKey('a.png', 12, h1)).not.toBe(crossBatchAssetKey('b.png', 12, h1));
		expect(crossBatchAssetKey('a.png', 12, h1)).not.toBe(crossBatchAssetKey('a.png', 12, 'b'.repeat(64)));
	});
});

describe('buildImportPreview (K18)', () => {
	const files = [
		{ relativePath: 'doc.md' },
		{ relativePath: 'doc/a.png' },
		{ relativePath: 'doc/b.png' },
		{ relativePath: 'sub/readme.txt' },
		{ relativePath: 'data.json' }
	];

	it('builds the directory tree with directories first, files sorted by name', () => {
		const preview = buildImportPreview(files);
		expect(preview.tree.map((n) => [n.name, n.type])).toEqual([
			['doc', 'directory'],
			['sub', 'directory'],
			['data.json', 'file']
		]);
		const doc = preview.tree[0];
		expect(doc.path).toBe('doc');
		expect(doc.children?.map((n) => [n.name, n.type])).toEqual([
			['a.png', 'image'],
			['b.png', 'image']
		]);
		expect(preview.tree[1].children?.[0]).toMatchObject({
			name: 'readme.txt',
			path: 'sub/readme.txt',
			type: 'markdown'
		});
	});

	it('counts markdown, image and other files', () => {
		const preview = buildImportPreview(files);
		expect(preview.markdownCount).toBe(2);
		expect(preview.imageCount).toBe(2);
		expect(preview.otherCount).toBe(1);
	});

	it('lists directories parents-first, then lexicographic', () => {
		expect(buildImportPreview(files).directories).toEqual(['doc', 'sub']);
		expect(buildImportPreview([{ relativePath: 'x/y/z.png' }]).directories).toEqual(['x', 'x/y']);
	});

	it('counts orphan images in same-name directories from markdownContents (K17)', () => {
		const preview = buildImportPreview(files, {
			markdownContents: new Map([['doc.md', '![](doc/a.png)']])
		});
		expect(preview.orphanImageCount).toBe(1);
	});

	it('reports conflicts against existing keys', () => {
		const preview = buildImportPreview(files, { existingKeys: new Set(['doc/a.png']) });
		expect(preview.conflicts).toEqual([{ relativePath: 'doc/a.png', key: 'doc/a.png' }]);
	});

	it('supports a custom conflictKeyOf', () => {
		const preview = buildImportPreview([{ relativePath: 'a/f.png' }, { relativePath: 'b/f.png' }], {
			conflictKeyOf: (file) => file.filename
		});
		expect(preview.conflicts.map((c) => c.key)).toEqual(['f.png', 'f.png']);
	});

	it('excludes structurally invalid paths from tree and counts and reports them (K14)', () => {
		const preview = buildImportPreview([
			{ relativePath: 'ok.png' },
			{ relativePath: '../evil.png' },
			{ relativePath: '/abs.png' }
		]);
		expect(preview.invalidPaths.map((i) => i.relativePath)).toEqual(['../evil.png', '/abs.png']);
		expect(preview.tree.map((n) => n.name)).toEqual(['ok.png']);
		expect(preview.imageCount).toBe(1);
	});
});

describe('path helpers', () => {
	it('noteTitleFromPath strips the extension only', () => {
		expect(noteTitleFromPath('notes/我的笔记.md')).toBe('我的笔记');
		expect(noteTitleFromPath('a.b.c.md')).toBe('a.b.c');
		expect(noteTitleFromPath('noext')).toBe('noext');
	});

	it('isImagePath is extension-based and case-insensitive', () => {
		expect(isImagePath('a/b.PNG')).toBe(true);
		expect(isImagePath('a.webp')).toBe(true);
		expect(isImagePath('a.txt')).toBe(false);
		expect(isImagePath('noext')).toBe(false);
	});

	it('isMarkdownPath covers md/markdown/txt case-insensitively', () => {
		expect(isMarkdownPath('a.MD')).toBe(true);
		expect(isMarkdownPath('a.markdown')).toBe(true);
		expect(isMarkdownPath('a.txt')).toBe(true);
		expect(isMarkdownPath('a.png')).toBe(false);
	});
});
