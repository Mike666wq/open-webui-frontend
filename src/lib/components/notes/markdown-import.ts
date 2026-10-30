import sha256 from 'js-sha256';

// P-006 S1 — pure Markdown import core: image reference parsing, path safety,
// same-name directory rule (K17), reference rewrite, dedup/idempotency keys
// and import preview building. No DOM, no network: these functions never
// upload anything; upload and report wiring belongs to S2/S3/S4. See the
// interface_decisions #2/#4/#5/#7/#9/#14 of the P-006 plan.
//
// Path safety model (K14): the browser File list has already resolved any
// filesystem symlinks, so a symlink escaping the root cannot be expressed
// here; absolute paths, Windows drive letters, `..` traversal and
// percent-encoded traversal are all rejected structurally, before any
// consumer can act on a path.

export type PathRejectionKind = 'empty' | 'absolute' | 'drive' | 'escape';

export interface PathRejection {
	kind: PathRejectionKind;
	/** The raw input path that was rejected. */
	path: string;
	reason: string;
}

export type PathResolution = { ok: true; path: string } | { ok: false; rejection: PathRejection };

const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'svg',
	'bmp',
	'avif',
	'ico',
	'tiff',
	'tif',
	'heic',
	'heif'
]);

/** Standard image extension check used for same-name directory image listing. */
export function isImagePath(path: string): boolean {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return false;
	return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

export function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown|txt)$/i.test(path);
}

/** Note idempotency title (interface_decisions #9): file name without extension. */
export function noteTitleFromPath(mdPath: string): string {
	const name = mdPath.slice(mdPath.lastIndexOf('/') + 1);
	return name.replace(/\.[^./]+$/, '');
}

const posixDirname = (path: string): string => {
	const i = path.lastIndexOf('/');
	return i === -1 ? '' : path.slice(0, i);
};

const posixBasename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

// ── Percent decoding ─────────────────────────────────────────────────────────

/**
 * Tolerant percent-decoding: valid escapes (`a%20b.png`, `%E4%B8%AD`) decode;
 * stray or invalid `%` sequences survive unchanged instead of throwing.
 */
export function decodePercentPath(raw: string): string {
	if (!raw.includes('%')) return raw;
	const padded = raw.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
	try {
		return decodeURIComponent(padded);
	} catch {
		return raw;
	}
}

// ── Path normalization and safety (interface_decisions #2, K14) ─────────────

/**
 * Normalize a reference target against the import root.
 *
 * Order matters and is pinned by tests: percent-decoding happens BEFORE
 * `..` collapsing, so encoded traversal like `..%2f..%2fetc` is caught by the
 * same escape check as its literal form. Backslashes are treated as Windows
 * separators; drive letters (`C:\x`, `C:/x`) and absolute paths are rejected.
 * Chinese characters, spaces, `#` and `?` that survive decoding are kept as-is.
 */
export function normalizeRelativePath(raw: string): PathResolution {
	const reject = (kind: PathRejectionKind, reason: string): PathResolution => ({
		ok: false,
		rejection: { kind, path: raw, reason }
	});

	if (!raw || raw.trim() === '') return reject('empty', '路径为空');
	if (/^[A-Za-z]:/.test(raw)) return reject('drive', 'Windows 盘符路径');

	const unified = raw.replace(/\\/g, '/');
	// Decode before collapsing: `..%2f..%2fetc` must fail like `../../etc`.
	const decoded = decodePercentPath(unified);
	if (decoded.trim() === '') return reject('empty', '路径为空');
	if (decoded.startsWith('/')) return reject('absolute', '绝对路径');

	const stack: string[] = [];
	for (const segment of decoded.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			if (stack.length === 0) return reject('escape', '路径越出导入根目录');
			stack.pop();
			continue;
		}
		stack.push(segment);
	}
	if (stack.length === 0) return reject('empty', '路径未指向任何文件');
	return { ok: true, path: stack.join('/') };
}

/**
 * Resolve an image reference target relative to the directory of its Markdown
 * file, then normalize against the import root. `mdDir` is a root-relative
 * directory ('' for the root itself).
 */
export function resolveRefPath(mdDir: string, rawDest: string): PathResolution {
	const base = mdDir.replace(/\/+$/, '');
	const joined = base ? `${base}/${rawDest}` : rawDest;
	return normalizeRelativePath(joined);
}

// ── Image reference parsing (K1) ─────────────────────────────────────────────

export interface ParsedImageRef {
	/** Full original reference text, e.g. `![alt](19.Zabbix/a.png "t")`. */
	raw: string;
	alt: string;
	title: string | null;
	/** Reference target after fragment stripping, before percent-decoding. */
	dest: string;
	/** Percent-decoded target (fragment already stripped). */
	decodedPath: string;
	/** http(s):// external reference — kept as-is by the importer (#6). */
	external: boolean;
	/** Source form. HTML tags are rewritten at the `src` attribute only. */
	syntax: 'markdown' | 'html';
	/** Zero-based source offsets used for source-preserving rewrites. */
	start: number;
	end: number;
}

export type UnsupportedImageKind = 'reference-style' | 'html' | 'malformed';

export interface UnsupportedImageRef {
	raw: string;
	start: number;
	end: number;
	kind: UnsupportedImageKind;
	reason: string;
}

export interface MarkdownImageScan {
	refs: ParsedImageRef[];
	unsupported: UnsupportedImageRef[];
}

interface MarkdownLine {
	line: string;
	start: number;
	fenced: boolean;
	inlineCode: Array<[number, number]>;
}

// CommonMark code spans protect their content from image rewriting.
function inlineCodeRanges(line: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const runs = [...line.matchAll(/`+/g)];
	for (let i = 0; i < runs.length; i++) {
		const start = runs[i].index!;
		if (start > 0 && line[start - 1] === '\\') continue;
		const end = runs.findIndex(
			(run, j) =>
				j > i &&
				run[0].length === runs[i][0].length &&
				!(run.index! > 0 && line[run.index! - 1] === '\\')
		);
		if (end >= 0) {
			ranges.push([start, runs[end].index! + runs[end][0].length]);
			i = end;
		}
	}
	return ranges;
}

interface FenceMarker {
	char: '`' | '~';
	length: number;
	info: string;
}

/**
 * Recognize a fence even when it is the first child of a list item. Typora
 * commonly writes `- ```bash`; treating that as ordinary text leaves the fence
 * parser inverted for every later image in the document.
 */
function fenceMarker(line: string): FenceMarker | null {
	let i = 0;
	while (i < line.length) {
		while (line[i] === ' ' || line[i] === '\t') i++;
		if (line[i] !== '>') break;
		i++;
		if (line[i] === ' ' || line[i] === '\t') i++;
	}

	while (i < line.length) {
		while (line[i] === ' ' || line[i] === '\t') i++;
		const marker = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(line.slice(i));
		if (!marker) break;
		i += marker[0].length;
	}
	while (line[i] === ' ' || line[i] === '\t') i++;

	const char = line[i];
	if (char !== '`' && char !== '~') return null;
	let length = 0;
	while (line[i + length] === char) length++;
	if (length < 3) return null;
	const info = line.slice(i + length).replace(/\r$/, '');
	if (char === '`' && info.includes('`')) return null;
	return { char, length, info };
}

function protectedMarkdownLines(markdown: string): MarkdownLine[] {
	const lines: MarkdownLine[] = [];
	let fence: { char: '`' | '~'; length: number } | null = null;
	let offset = 0;
	for (const rawLine of markdown.split('\n')) {
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		const marker = fenceMarker(line);
		let fenced = false;
		if (fence) {
			fenced = true;
			if (
				marker &&
				marker.char === fence.char &&
				marker.length >= fence.length &&
				marker.info.trim() === ''
			) {
				fence = null;
			}
		} else if (marker) {
			fenced = true;
			fence = { char: marker.char, length: marker.length };
		}
		lines.push({
			line,
			start: offset,
			fenced,
			inlineCode: fenced ? [] : inlineCodeRanges(line)
		});
		offset += rawLine.length + 1;
	}
	return lines;
}

function normalizeReferenceLabel(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isEscaped(text: string, index: number): boolean {
	let slashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
	return slashes % 2 === 1;
}

/**
 * Strip the fragment/query part of a reference target. Raw `#` and `?` in a
 * bare destination start the fragment and are removed; inside `<...>` they are
 * literal filename characters (Typora style `<a#b.png>`). Decoding happens
 * afterwards, so `%23`/`%3F` survive as filename characters.
 */
function stripDestFragment(dest: string, wrapped: boolean): string {
	if (wrapped) return dest;
	const cut = dest.search(/[?#]/);
	return cut === -1 ? dest : dest.slice(0, cut);
}

function toImageRef(
	raw: string,
	alt: string,
	wrapped: string | undefined,
	bare: string | undefined,
	doubleQuoted: string | undefined,
	singleQuoted: string | undefined,
	syntax: ParsedImageRef['syntax'],
	start: number,
	end: number
): ParsedImageRef {
	const destRaw = (wrapped ?? bare ?? '').trim();
	const stripped = stripDestFragment(destRaw, wrapped !== undefined);
	const title =
		doubleQuoted !== undefined || singleQuoted !== undefined
			? (doubleQuoted ?? singleQuoted ?? null)
			: null;
	return {
		raw,
		alt,
		title,
		dest: stripped,
		decodedPath: decodePercentPath(stripped),
		external: /^https?:\/\//i.test(stripped),
		syntax,
		start,
		end
	};
}

interface ParsedImageLocation {
	ref?: ParsedImageRef;
	unsupported?: UnsupportedImageRef;
	/** Local line offset after the recognized construct. */
	end: number;
}

function findClosingParen(line: string, open: number): number {
	let depth = 1;
	let quote: '"' | "'" | null = null;
	for (let i = open + 1; i < line.length; i++) {
		const char = line[i];
		if (char === '\\') {
			i++;
			continue;
		}
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if ((char === '"' || char === "'") && i > 0 && /\s/.test(line[i - 1])) {
			quote = char;
			continue;
		}
		if (char === '(') depth++;
		else if (char === ')' && --depth === 0) return i;
		if (char === '\r') break;
	}
	return -1;
}

function splitBareDestination(value: string): {
	dest: string;
	doubleQuoted?: string;
	singleQuoted?: string;
} {
	const trimmed = value.trim();
	const title = /^(.*?)\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*$/.exec(trimmed);
	if (!title || !title[1].trim()) return { dest: trimmed };
	return {
		dest: title[1].trim(),
		...(title[2] !== undefined ? { doubleQuoted: title[2] } : {}),
		...(title[3] !== undefined ? { singleQuoted: title[3] } : {})
	};
}

function parseMarkdownImage(
	line: string,
	start: number,
	lineStart: number,
	references: ReadonlySet<string>
): ParsedImageLocation | null {
	if (line[start] !== '!' || line[start + 1] !== '[' || isEscaped(line, start)) return null;

	let closeAlt = -1;
	for (let i = start + 2; i < line.length; i++) {
		if (line[i] === '\\') {
			i++;
			continue;
		}
		if (line[i] === ']') {
			closeAlt = i;
			break;
		}
	}
	if (closeAlt === -1) return null;
	const alt = line.slice(start + 2, closeAlt);
	const next = closeAlt + 1;

	if (line[next] === '[') {
		let closeReference = -1;
		for (let i = next + 1; i < line.length; i++) {
			if (line[i] === '\\') {
				i++;
				continue;
			}
			if (line[i] === ']') {
				closeReference = i;
				break;
			}
		}
		const end = closeReference === -1 ? line.length : closeReference + 1;
		const raw = line.slice(start, end);
		return {
			unsupported: {
				raw,
				start: lineStart + start,
				end: lineStart + end,
				kind: 'reference-style',
				reason: '引用式图片暂不支持'
			},
			end
		};
	}

	if (line[next] !== '(') {
		if (references.has(normalizeReferenceLabel(alt))) {
			const end = closeAlt + 1;
			return {
				unsupported: {
					raw: line.slice(start, end),
					start: lineStart + start,
					end: lineStart + end,
					kind: 'reference-style',
					reason: '引用式图片暂不支持'
				},
				end
			};
		}
		return null;
	}

	let targetStart = next + 1;
	while (line[targetStart] === ' ' || line[targetStart] === '\t') targetStart++;

	let end: number;
	let wrapped: string | undefined;
	let bare: string | undefined;
	let doubleQuoted: string | undefined;
	let singleQuoted: string | undefined;

	if (line[targetStart] === '<') {
		let closeAngle = -1;
		for (let i = targetStart + 1; i < line.length; i++) {
			if (line[i] === '\\') {
				i++;
				continue;
			}
			if (line[i] === '>') {
				closeAngle = i;
				break;
			}
		}
		if (closeAngle !== -1) {
			const tail = line.slice(closeAngle + 1);
			const close = /^[ \t]*(?:(?:"([^"\n]*)"|'([^'\n]*)')[ \t]*)?\)/.exec(tail);
			if (close) {
				wrapped = line.slice(targetStart + 1, closeAngle);
				doubleQuoted = close[1];
				singleQuoted = close[2];
				end = closeAngle + 1 + close[0].length;
			} else end = -1;
		} else end = -1;
	} else {
		const closeParen = findClosingParen(line, next);
		if (closeParen !== -1) {
			const parts = splitBareDestination(line.slice(next + 1, closeParen));
			bare = parts.dest;
			doubleQuoted = parts.doubleQuoted;
			singleQuoted = parts.singleQuoted;
			end = closeParen + 1;
		} else end = -1;
	}

	if (end === -1 || (!wrapped && !bare)) {
		const raw = line.slice(start);
		return {
			unsupported: {
				raw,
				start: lineStart + start,
				end: lineStart + line.length,
				kind: 'malformed',
				reason: '图片语法不完整'
			},
			end: line.length
		};
	}

	const raw = line.slice(start, end);
	return {
		ref: toImageRef(
			raw,
			alt,
			wrapped,
			bare,
			doubleQuoted,
			singleQuoted,
			'markdown',
			lineStart + start,
			lineStart + end
		),
		end
	};
}

function htmlAttribute(tag: string, name: string): string | null {
	const body = tag.slice(4, -1);
	const attributes =
		/(?:^|\s)([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
	for (const match of body.matchAll(attributes)) {
		if (match[1].toLowerCase() === name) return match[2] ?? match[3] ?? match[4] ?? null;
	}
	return null;
}

function parseHtmlImage(line: string, start: number, lineStart: number): ParsedImageLocation | null {
	if (
		line.slice(start, start + 4).toLowerCase() !== '<img' ||
		!/[\s/>]/.test(line[start + 4] ?? '') ||
		isEscaped(line, start)
	)
		return null;

	let quote: '"' | "'" | null = null;
	let close = -1;
	for (let i = start + 4; i < line.length; i++) {
		const char = line[i];
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === '>') {
			close = i;
			break;
		}
	}
	const end = close === -1 ? line.length : close + 1;
	const raw = line.slice(start, end);
	if (close === -1) {
		return {
			unsupported: {
				raw,
				start: lineStart + start,
				end: lineStart + end,
				kind: 'html',
				reason: '<img> 标签不完整'
			},
			end
		};
	}
	const src = htmlAttribute(raw, 'src');
	if (src === null || src.trim() === '') {
		return {
			unsupported: {
				raw,
				start: lineStart + start,
				end: lineStart + end,
				kind: 'html',
				reason: '<img> 标签缺少静态 src'
			},
			end
		};
	}
	return {
		ref: toImageRef(
			raw,
			htmlAttribute(raw, 'alt') ?? '',
			undefined,
			src,
			undefined,
			undefined,
			'html',
			lineStart + start,
			lineStart + end
		),
		end
	};
}

/**
 * Scan Markdown and inline HTML images while preserving source offsets. Code
 * spans, fenced code blocks and escaped markers are excluded. Unsupported
 * reference-style images are reported separately rather than silently dropped.
 */
export function scanMarkdownImages(markdown: string): MarkdownImageScan {
	const lines = protectedMarkdownLines(markdown);
	const references = new Set<string>();
	for (const item of lines) {
		if (item.fenced) continue;
		const definition = /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(?:<[^>\n]*>|\S)/.exec(item.line);
		if (definition) references.add(normalizeReferenceLabel(definition[1]));
	}

	const refs: ParsedImageRef[] = [];
	const unsupported: UnsupportedImageRef[] = [];
	for (const item of lines) {
		if (item.fenced) continue;
		for (let i = 0; i < item.line.length; ) {
			const codeRange = item.inlineCode.find(([start, end]) => i >= start && i < end);
			if (codeRange) {
				i = codeRange[1];
				continue;
			}
			const parsed =
				item.line[i] === '!'
					? parseMarkdownImage(item.line, i, item.start, references)
					: item.line[i] === '<'
						? parseHtmlImage(item.line, i, item.start)
						: null;
			if (parsed) {
				if (parsed.ref) refs.push(parsed.ref);
				if (parsed.unsupported) unsupported.push(parsed.unsupported);
				i = parsed.end;
				continue;
			}
			i++;
		}
	}
	refs.sort((a, b) => a.start - b.start);
	unsupported.sort((a, b) => a.start - b.start);
	return { refs, unsupported };
}

/** Backwards-compatible supported-reference accessor. */
export function parseImageRefs(markdown: string): ParsedImageRef[] {
	return scanMarkdownImages(markdown).refs;
}

// ── Same-name directory rule (K17, interface_decisions #14) ─────────────────

export interface MarkdownNoteAnalysis {
	/** Root-relative path of the Markdown file. */
	mdPath: string;
	/** Root-relative directory containing the Markdown file ('' at the root). */
	mdDir: string;
	/** File name without extension — the note idempotency title (#9). */
	title: string;
	/** Same-name image directory (root-relative, no trailing slash), or null. */
	imageDir: string | null;
	/** All images directly inside the same-name directory. */
	dirImages: string[];
	/** Subset of dirImages referenced by the note body. */
	referencedDirImages: string[];
	/** dirImages never referenced by the note body. */
	orphanImages: string[];
	/** References resolving to files that do not exist in the selected tree. */
	missingRefs: { raw: string; path: string }[];
	/** References resolving to existing files outside the same-name directory. */
	outsideDirRefs: { raw: string; path: string }[];
	externalRefs: ParsedImageRef[];
	rejectedRefs: { raw: string; kind: PathRejectionKind; reason: string }[];
	unsupportedRefs: UnsupportedImageRef[];
}

/**
 * Analyze one Markdown file against the selected file tree: resolve every
 * image reference, detect the same-name image directory, and split the
 * directory's images into referenced vs. orphan subsets (K17). When no
 * same-name directory exists, per-reference resolution still applies.
 */
export function analyzeMarkdownNote(
	mdPath: string,
	markdown: string,
	allFilePaths: readonly string[],
	options?: { isImageFile?: (path: string) => boolean }
): MarkdownNoteAnalysis {
	const isImage = options?.isImageFile ?? isImagePath;
	const scan = scanMarkdownImages(markdown);
	const refs = scan.refs;
	const existing = new Set(allFilePaths);
	const mdDir = posixDirname(mdPath);
	const title = noteTitleFromPath(mdPath);
	const imageDirCandidate = mdDir ? `${mdDir}/${title}` : title;
	const dirPrefix = `${imageDirCandidate}/`;
	const imageDir = allFilePaths.some((p) => p.startsWith(dirPrefix)) ? imageDirCandidate : null;
	const dirImages = imageDir
		? allFilePaths.filter(
				(p) => p.startsWith(dirPrefix) && !p.slice(dirPrefix.length).includes('/') && isImage(p)
			)
		: [];

	const referenced = new Set<string>();
	const missingRefs: MarkdownNoteAnalysis['missingRefs'] = [];
	const outsideDirRefs: MarkdownNoteAnalysis['outsideDirRefs'] = [];
	const externalRefs: ParsedImageRef[] = [];
	const rejectedRefs: MarkdownNoteAnalysis['rejectedRefs'] = [];

	for (const ref of refs) {
		if (ref.external) {
			externalRefs.push(ref);
			continue;
		}
		const res = resolveRefPath(mdDir, ref.dest);
		if (!res.ok) {
			rejectedRefs.push({
				raw: ref.raw,
				kind: res.rejection.kind,
				reason: res.rejection.reason
			});
			continue;
		}
		if (!existing.has(res.path)) {
			missingRefs.push({ raw: ref.raw, path: res.path });
			continue;
		}
		if (imageDir && res.path.startsWith(dirPrefix)) {
			referenced.add(res.path);
		} else {
			outsideDirRefs.push({ raw: ref.raw, path: res.path });
		}
	}

	return {
		mdPath,
		mdDir,
		title,
		imageDir,
		dirImages,
		referencedDirImages: dirImages.filter((p) => referenced.has(p)),
		orphanImages: dirImages.filter((p) => !referenced.has(p)),
		missingRefs,
		outsideDirRefs,
		externalRefs,
		rejectedRefs,
		unsupportedRefs: scan.unsupported
	};
}

// ── Reference rewrite (interface_decisions #3/#5/#7) ─────────────────────────

/**
 * How a resolved reference is written back:
 * - `{ form: 'url', url }` rebuilds `![alt](url "title")`, preserving alt and
 *   title and swapping only the URL (note side: `data://<fileId>`).
 * - `{ form: 'text', text }` replaces the whole reference with readable text
 *   (knowledge base side: `[图片 a.png]` marker, #7).
 */
export type ResolvedImageTarget = { form: 'url'; url: string } | { form: 'text'; text: string };

export type RewriteOutcomeStatus =
	| 'rewritten'
	| 'unresolved'
	| 'external'
	| 'rejected'
	| 'unsupported';

export interface RewriteOutcome {
	raw: string;
	status: RewriteOutcomeStatus;
	alt: string;
	title: string | null;
	/** Normalized root-relative path, when the reference resolved to one. */
	path: string | null;
	from: string | null;
	to: string | null;
	reason?: string;
}

/** Readable replacement marker used by the knowledge import (#7). */
export const knowledgeImageMarker = (normalizedPath: string): string =>
	`[图片 ${posixBasename(normalizedPath)}]`;

/**
 * Rewrite image references in the Markdown body. `resolve` maps a reference
 * (plus its normalized path, null for external references) to its new form;
 * returning null keeps the original text in the content and records the
 * outcome for the import report. Fenced code blocks are never rewritten.
 */
export function rewriteImageRefs(
	markdown: string,
	resolve: (ref: ParsedImageRef, normalizedPath: string | null) => ResolvedImageTarget | null,
	options?: { mdDir?: string }
): { content: string; outcomes: RewriteOutcome[] } {
	const mdDir = options?.mdDir ?? '';
	const scan = scanMarkdownImages(markdown);
	const events: Array<{
		start: number;
		end: number;
		replacement: string;
		outcome: RewriteOutcome;
	}> = [];

	for (const ref of scan.refs) {
		if (ref.external) {
			const target = resolve(ref, null);
			if (target) {
				events.push({
					start: ref.start,
					end: ref.end,
					replacement: rewriteTarget(ref, target),
					outcome: {
						raw: ref.raw,
						status: 'rewritten',
						alt: ref.alt,
						title: ref.title,
						path: null,
						from: ref.dest,
						to: target.form === 'url' ? target.url : target.text
					}
				});
			} else {
				events.push({
					start: ref.start,
					end: ref.end,
					replacement: ref.raw,
					outcome: {
						raw: ref.raw,
						status: 'external',
						alt: ref.alt,
						title: ref.title,
						path: null,
						from: ref.dest,
						to: null
					}
				});
			}
			continue;
		}

		const res = resolveRefPath(mdDir, ref.dest);
		const path = res.ok ? res.path : null;
		const target = resolve(ref, path);
		if (target) {
			events.push({
				start: ref.start,
				end: ref.end,
				replacement: rewriteTarget(ref, target),
				outcome: {
					raw: ref.raw,
					status: 'rewritten',
					alt: ref.alt,
					title: ref.title,
					path,
					from: ref.dest,
					to: target.form === 'url' ? target.url : target.text
				}
			});
		} else {
			events.push({
				start: ref.start,
				end: ref.end,
				replacement: ref.raw,
				outcome: {
					raw: ref.raw,
					status: res.ok ? 'unresolved' : 'rejected',
					alt: ref.alt,
					title: ref.title,
					path,
					from: ref.dest,
					to: null,
					reason: res.ok ? undefined : res.rejection.reason
				}
			});
		}
	}

	for (const ref of scan.unsupported) {
		events.push({
			start: ref.start,
			end: ref.end,
			replacement: ref.raw,
			outcome: {
				raw: ref.raw,
				status: 'unsupported',
				alt: '',
				title: null,
				path: null,
				from: null,
				to: null,
				reason: ref.reason
			}
		});
	}

	events.sort((a, b) => a.start - b.start);
	let content = markdown;
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		content = `${content.slice(0, event.start)}${event.replacement}${content.slice(event.end)}`;
	}
	return { content, outcomes: events.map((event) => event.outcome) };
}

/** Rebuild `![alt](url "title")` keeping alt/title, swapping only the URL. */
function buildUrlRef(ref: ParsedImageRef, url: string): string {
	return ref.title !== null ? `![${ref.alt}](${url} "${ref.title}")` : `![${ref.alt}](${url})`;
}

function replaceHtmlImageSrc(raw: string, url: string): string {
	return raw.replace(
		/(\s+src\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
		(_match, prefix: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
			if (doubleQuoted !== undefined)
				return `${prefix}"${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
			if (singleQuoted !== undefined)
				return `${prefix}'${url.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}'`;
			if (!bare || /["'\s]/.test(url))
				return `${prefix}"${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
			return `${prefix}${url}`;
		}
	);
}

function rewriteTarget(ref: ParsedImageRef, target: ResolvedImageTarget): string {
	if (target.form === 'text') return target.text;
	return ref.syntax === 'html'
		? replaceHtmlImageSrc(ref.raw, target.url)
		: buildUrlRef(ref, target.url);
}

// ── Dedup and idempotency keys (interface_decisions #4/#9) ───────────────────

/**
 * Batch dedup cache: normalized relative path → fileId. All references to the
 * same normalized path within one import share a single upload.
 */
export type BatchAssetCache = Map<string, string>;

export const createBatchAssetCache = (): BatchAssetCache => new Map();

/**
 * Cross-batch asset key (#4): (file name, byte length, sha256 first 32 hex
 * chars). The sha256 hex is computed by the caller from the file bytes (see
 * `computeFileHash` in `$lib/utils/hash`).
 */
export const crossBatchAssetKey = (
	filename: string,
	sizeBytes: number,
	sha256Hex: string
): string => `${filename}:${sizeBytes}:${sha256Hex.slice(0, 32)}`;

/** Note metadata block recorded on import for idempotent re-imports (#9/#10). */
export interface MarkdownImportMeta {
	markdown_import: {
		source_path: string;
		content_hash: string;
		imported_at?: number;
	};
}

export const markdownImportMeta = (
	sourcePath: string,
	contentSha256Hex: string,
	importedAt?: number
): MarkdownImportMeta => ({
	markdown_import: {
		source_path: sourcePath,
		content_hash: contentSha256Hex,
		...(importedAt !== undefined ? { imported_at: importedAt } : {})
	}
});

/** Content hash of the Markdown body (sha256 hex). */
export const noteContentHash = (content: string): string => sha256(content);

// ── Import preview (consumed by the S2/S3/S4 modals) ─────────────────────────

export interface PreviewInputFile {
	/** webkitRelativePath-style path relative to the selected root. */
	relativePath: string;
	size?: number;
}

export interface PreviewTreeNode {
	name: string;
	/** Directory path for directories, full relative path for files. */
	path: string;
	type: 'directory' | 'markdown' | 'image' | 'file';
	children?: PreviewTreeNode[];
	conflict?: boolean;
}

export interface ImportPreviewConflict {
	relativePath: string;
	key: string;
}

export interface ImportPreview {
	tree: PreviewTreeNode[];
	/** Directory paths (parents first, then lexicographic). */
	directories: string[];
	markdownCount: number;
	imageCount: number;
	otherCount: number;
	orphanImageCount: number;
	conflicts: ImportPreviewConflict[];
	invalidPaths: { relativePath: string; reason: string }[];
}

export interface ImportPreviewOptions {
	/** Conflict keys already present at the import target (#9). */
	existingKeys?: ReadonlySet<string>;
	/** Conflict key function; defaults to the normalized relative path. */
	conflictKeyOf?: (file: {
		relativePath: string;
		path: string;
		dir: string;
		filename: string;
	}) => string;
	/**
	 * Markdown bodies keyed by relative path. When provided, orphan images in
	 * same-name directories are counted (K17); without it orphanImageCount is 0.
	 */
	markdownContents?: ReadonlyMap<string, string>;
}

const nodeType = (path: string): PreviewTreeNode['type'] =>
	isMarkdownPath(path) ? 'markdown' : isImagePath(path) ? 'image' : 'file';

const compareNodes = (a: PreviewTreeNode, b: PreviewTreeNode): number => {
	const rank = (n: PreviewTreeNode) => (n.type === 'directory' ? 0 : 1);
	return rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
};

/**
 * Build the import preview: directory tree, file counts, orphan image count,
 * conflict list and structurally invalid paths. Invalid paths are excluded
 * from the tree and counts and reported for K14.
 */
export function buildImportPreview(
	files: readonly PreviewInputFile[],
	options: ImportPreviewOptions = {}
): ImportPreview {
	const keyOf = options.conflictKeyOf ?? ((file: { relativePath: string }) => file.relativePath);
	const existingKeys = options.existingKeys;

	const valid: { relativePath: string; path: string; dir: string; filename: string }[] = [];
	const invalidPaths: ImportPreview['invalidPaths'] = [];
	for (const file of files) {
		const res = normalizeRelativePath(file.relativePath);
		if (!res.ok) {
			invalidPaths.push({ relativePath: file.relativePath, reason: res.rejection.reason });
			continue;
		}
		valid.push({
			relativePath: file.relativePath,
			path: res.path,
			dir: posixDirname(res.path),
			filename: posixBasename(res.path)
		});
	}

	const tree: PreviewTreeNode[] = [];
	const dirNodes = new Map<string, PreviewTreeNode>();
	const ensureDirList = (dirPath: string): PreviewTreeNode[] => {
		if (dirPath === '') return tree;
		const segments = dirPath.split('/');
		const parentList = ensureDirList(segments.slice(0, -1).join('/'));
		let node = dirNodes.get(dirPath);
		if (!node) {
			node = {
				name: segments[segments.length - 1],
				path: dirPath,
				type: 'directory',
				children: []
			};
			dirNodes.set(dirPath, node);
			parentList.push(node);
		}
		return node.children as PreviewTreeNode[];
	};

	const conflicts: ImportPreviewConflict[] = [];
	let markdownCount = 0;
	let imageCount = 0;
	let otherCount = 0;

	for (const entry of valid) {
		ensureDirList(entry.dir).push({
			name: entry.filename,
			path: entry.path,
			type: nodeType(entry.path)
		});
		if (
			entry.path.endsWith('.md') ||
			entry.path.endsWith('.markdown') ||
			entry.path.endsWith('.txt')
		) {
			markdownCount++;
		} else if (isImagePath(entry.path)) {
			imageCount++;
		} else {
			otherCount++;
		}
		const key = keyOf(entry);
		if (existingKeys?.has(key)) conflicts.push({ relativePath: entry.relativePath, key });
	}

	const sortChildren = (nodes: PreviewTreeNode[]): void => {
		nodes.sort(compareNodes);
		for (const node of nodes) {
			if (node.children) sortChildren(node.children);
		}
	};
	sortChildren(tree);

	const directories = Array.from(dirNodes.keys()).sort((a, b) => {
		const depth = a.split('/').length - b.split('/').length;
		return depth || (a < b ? -1 : a > b ? 1 : 0);
	});

	let orphanImageCount = 0;
	if (options.markdownContents) {
		const normalizedContents = new Map<string, string>();
		for (const [key, value] of options.markdownContents) {
			const res = normalizeRelativePath(key);
			if (res.ok) normalizedContents.set(res.path, value);
		}
		const paths = valid.map((v) => v.path);
		for (const entry of valid) {
			if (!isMarkdownPath(entry.path)) continue;
			const content = normalizedContents.get(entry.path);
			if (content === undefined) continue;
			orphanImageCount += analyzeMarkdownNote(entry.path, content, paths).orphanImages.length;
		}
	}

	return {
		tree,
		directories,
		markdownCount,
		imageCount,
		otherCount,
		orphanImageCount,
		conflicts,
		invalidPaths
	};
}

/** Resolve only protected same-origin v2 image URLs for an authenticated preview.
 * Data URLs are ephemeral render values; the stored Markdown is never modified. */
export async function renderAuthenticatedImportImages(
	markdown: string,
	load: (fileId: string) => Promise<string>
): Promise<string> {
	const pattern =
		/^\/api\/v1\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/content$/i;
	const resolved = new Map<string, string>();
	for (const ref of parseImageRefs(markdown)) {
		const match = ref.dest.match(pattern);
		if (match && !resolved.has(match[1])) {
			const image = await load(match[1]);
			if (!/^data:image\//i.test(image)) throw new Error('Invalid authenticated image');
			resolved.set(match[1], image);
		}
	}
	return rewriteImageRefs(markdown, (ref) => {
		const match = ref.dest.match(pattern);
		const image = match && resolved.get(match[1]);
		return image ? { form: 'url', url: image } : null;
	}).content;
}

export function blobToImageDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () =>
			typeof reader.result === 'string'
				? resolve(reader.result)
				: reject(new Error('Invalid image'));
		reader.onerror = () => reject(new Error('Unable to read image'));
		reader.readAsDataURL(blob);
	});
}
