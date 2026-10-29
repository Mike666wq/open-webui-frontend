// P-006 S2/S3 — pure planning helpers for the Markdown note import modal.
// No DOM and no network: the modal (ImportNotesModal.svelte) does the file
// collection, upload and note creation. Keeping the planning pure keeps it
// unit-testable (see notes-import-plan.test.ts).

import {
	noteTitleFromPath,
	normalizeRelativePath,
	isImagePath,
	isMarkdownPath,
	type PreviewTreeNode
} from '../markdown-import';

export type ImportEntry = {
	/** Path relative to the import root, as collected from the picker. */
	relativePath: string;
	file: File;
};

export type PlannedMarkdown = {
	/** Root-relative path of the Markdown file. */
	mdPath: string;
	/** Note title: filename without extension, optionally path-prefixed. */
	title: string;
};

export type PlannedOtherDoc = {
	/** Root-relative path of the document file. */
	docPath: string;
	title: string;
};

export type BatchPlan = {
	invalidPaths: { relativePath: string; reason: string }[];
	markdown: PlannedMarkdown[];
	images: { path: string; filename: string }[];
	/** Non-image, non-markdown files, imported only when the user opts in. */
	otherDocs: PlannedOtherDoc[];
	otherIgnored: { path: string; filename: string }[];
};

/**
 * Note title for a Markdown file: flat mode keeps only the file name without
 * extension (the idempotency key of interface_decisions #9); hierarchical
 * mode prefixes the directory so `a/README.md` and `b/README.md` stay
 * distinct.
 */
export function titleForNote(mdPath: string, flat: boolean): string {
	if (flat) return noteTitleFromPath(mdPath);
	return mdPath.replace(/\.[^./]+$/, '');
}

/**
 * Classify the collected files into Markdown notes, image assets, optional
 * other-document notes and ignored leftovers. Structurally invalid paths
 * (K14) are reported and excluded from every list.
 */
export function buildBatchPlan(entries: readonly ImportEntry[], flat: boolean): BatchPlan {
	const plan: BatchPlan = {
		invalidPaths: [],
		markdown: [],
		images: [],
		otherDocs: [],
		otherIgnored: []
	};

	for (const entry of entries) {
		const res = normalizeRelativePath(entry.relativePath);
		if (!res.ok) {
			plan.invalidPaths.push({ relativePath: entry.relativePath, reason: res.rejection.reason });
			continue;
		}
		const path = res.path;
		const filename = path.slice(path.lastIndexOf('/') + 1);
		if (isMarkdownPath(path)) {
			plan.markdown.push({ mdPath: path, title: titleForNote(path, flat) });
		} else if (isImagePath(path)) {
			plan.images.push({ path, filename });
		} else {
			plan.otherDocs.push({ docPath: path, title: titleForNote(path, flat) });
		}
	}

	return plan;
}

/**
 * Render the preview tree as an indented plain-text listing, capped at
 * `maxLines` entries (directories first, as produced by S1's tree builder).
 */
export function renderTreeLines(nodes: readonly PreviewTreeNode[], maxLines = 200): string[] {
	const lines: string[] = [];
	const walk = (list: readonly PreviewTreeNode[], depth: number) => {
		if (lines.length >= maxLines) return;
		for (const node of list) {
			if (lines.length >= maxLines) return;
			lines.push(`${'  '.repeat(depth)}${node.name}${node.type === 'directory' ? '/' : ''}`);
			if (node.children) walk(node.children, depth + 1);
		}
	};
	walk(nodes, 0);
	return lines;
}

/** Uniqueness suffix for the "create a copy" conflict strategy. */
export function copyTitle(title: string, taken: ReadonlySet<string>): string {
	let n = 2;
	let candidate = `${title} (${n})`;
	while (taken.has(candidate)) {
		n += 1;
		candidate = `${title} (${n})`;
	}
	return candidate;
}
