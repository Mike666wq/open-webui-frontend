import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	assertAssetPath,
	createManifest,
	mimeType,
	pagePattern,
	pagePatterns
} from './frontend-bundle.mjs';

const provenance = {
	upstreamVersion: '0.12.2',
	upstreamCommit: '6a18585ff4c2e5f6805f682222cfbc46dc669ef8',
	sourceRepository: 'Mike666wq/open-webui-frontend',
	sourceCommit: '1234567890abcdef1234567890abcdef12345678'
};

test('only declared frontend pages match and backend URLs never become SPA fallbacks', async () => {
	const patterns = await pagePatterns(new URL('../src/routes', import.meta.url));
	const matches = (pathname) => patterns.some((pattern) => new RegExp(pattern).test(pathname));
	for (const pathname of [
		'/',
		'/auth',
		'/c/abc',
		'/s/shared',
		'/admin/settings/general',
		'/workspace/models'
	]) {
		assert.equal(matches(pathname), true, pathname);
	}
	for (const pathname of [
		'/api/config',
		'/ws/socket.io',
		'/oauth/google/login',
		'/cache/file.png',
		'/c/id/extra',
		'/unknown',
		'/_app/missing.js'
	]) {
		assert.equal(matches(pathname), false, pathname);
	}
	assert.equal(pagePattern('(app)/c/[id]'), '^/c/[^/]+/?$');
	assert.throws(() => pagePattern('api/config'), /shadow/);
	assert.throws(() => pagePattern('c/[[id]]'), /Review/);
});

test('asset names and executable MIME types are strict', () => {
	for (const value of ['', '/absolute', '../secret', 'a/../b', 'a\\b', 'a//b', 'a?b', 'a#b']) {
		assert.throws(() => assertAssetPath(value), /Unsafe/);
	}
	assert.equal(assertAssetPath('_app/immutable/app.js'), '_app/immutable/app.js');
	assert.equal(mimeType('module.js'), 'text/javascript');
	assert.equal(mimeType('worker.wasm'), 'application/wasm');
	assert.equal(mimeType('font.woff2'), 'font/woff2');
});

test('manifest records byte sizes and hashes, preserves official PWA manifest, rejects missing entry', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'frontend-manifest-'));
	try {
		await assert.rejects(createManifest(root, ['^/$'], provenance), /index.html/);
		await writeFile(path.join(root, 'index.html'), '<html>基线</html>');
		await writeFile(path.join(root, 'manifest.json'), '{}');
		const manifest = await createManifest(root, ['^/$'], provenance);
		assert.equal(manifest.schema, 1);
		assert.equal(manifest.sourceCommit, provenance.sourceCommit);
		assert.equal(manifest.entry, 'index.html');
		assert.equal(manifest.files.find((file) => file.path === 'index.html').size, 19);
		assert.equal(
			manifest.files.find((file) => file.path === 'manifest.json').sha256,
			'44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
		);
		assert.equal(
			manifest.files.some((file) => file.path === 'frontend-manifest.json'),
			false
		);
		await assert.rejects(
			createManifest(root, ['^/$'], { ...provenance, sourceCommit: 'main' }),
			/provenance/
		);
		await assert.rejects(createManifest(root, ['.*'], provenance), /anchored/);
		await mkdir(path.join(root, 'assets'));
		await symlink('../index.html', path.join(root, 'assets/link.html'));
		await assert.rejects(createManifest(root, ['^/$'], provenance), /Symlinks/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
