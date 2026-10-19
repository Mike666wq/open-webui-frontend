import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const METADATA_FILE = 'frontend-manifest.json';
export const ARCHIVE_FILE = 'open-webui-frontend.zip';

const mimeTypes = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.map': 'application/json',
	'.wasm': 'application/wasm',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
	'.ico': 'image/x-icon',
	'.avif': 'image/avif',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.txt': 'text/plain',
	'.xml': 'application/xml',
	'.webmanifest': 'application/manifest+json'
};

const backendRoots = new Set(['api', 'ws', 'oauth', 'ollama', 'openai', 'cache']);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function assertAssetPath(value) {
	if (
		typeof value !== 'string' ||
		!value ||
		/[\\\0\r\n?#]/.test(value) ||
		value.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new Error(`Unsafe asset path: ${JSON.stringify(value)}`);
	}
	return value;
}

export function mimeType(file) {
	return mimeTypes[path.posix.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

async function walk(directory, prefix = '') {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		assertAssetPath(relative);
		if (entry.isSymbolicLink()) throw new Error(`Symlinks are not packaged: ${relative}`);
		if (entry.isDirectory())
			files.push(...(await walk(path.join(directory, entry.name), relative)));
		else if (entry.isFile()) files.push(relative);
		else throw new Error(`Unsupported file type: ${relative}`);
	}
	return files.sort();
}

/** Only actual Svelte pages become SPA fallbacks; backend paths never do. */
export function pagePattern(routeDirectory) {
	const segments = routeDirectory.split('/').filter((part) => part && !/^\([^/]+\)$/.test(part));
	if (backendRoots.has(segments[0])) {
		throw new Error(`A page would shadow a backend route: ${routeDirectory}`);
	}
	const parts = segments.map((part) => {
		if (/^\[[A-Za-z_][A-Za-z0-9_]*\]$/.test(part)) return '[^/]+';
		if (/[\[\]]/.test(part)) {
			throw new Error(`Review the new Svelte route syntax before packaging: ${routeDirectory}`);
		}
		return escapeRegex(part);
	});
	return parts.length ? `^/${parts.join('/')}/?$` : '^/$';
}

export async function pagePatterns(routesDirectory) {
	const sources = await walk(
		routesDirectory instanceof URL ? fileURLToPath(routesDirectory) : routesDirectory
	);
	return [
		...new Set(
			sources
				.filter((file) => /(^|\/)\+page\.svelte$/.test(file))
				.map((file) =>
					pagePattern(path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file))
				)
		)
	].sort();
}

export async function createManifest(buildDirectory, routes, provenance) {
	if (
		!/^[0-9a-f]{40}$/.test(provenance.sourceCommit) ||
		!/^[0-9a-f]{40}$/.test(provenance.upstreamCommit) ||
		provenance.sourceRepository !== 'Mike666wq/open-webui-frontend' ||
		provenance.upstreamVersion !== '0.12.2'
	) {
		throw new Error('Invalid or unsupported frontend provenance');
	}
	if (!routes.length || routes.some((route) => !route.startsWith('^') || !route.endsWith('$'))) {
		throw new Error('Page routes must be nonempty anchored patterns');
	}
	for (const route of routes) new RegExp(route);
	const files = [];
	for (const file of await walk(buildDirectory)) {
		if (file === METADATA_FILE)
			throw new Error('Build directory already contains frontend metadata');
		const bytes = await readFile(path.join(buildDirectory, file));
		files.push({ path: file, sha256: sha256(bytes), size: bytes.length, mime: mimeType(file) });
	}
	if (!files.some((file) => file.path === 'index.html' && file.size > 0)) {
		throw new Error('The static build has no nonempty index.html entry');
	}
	return { schema: 1, ...provenance, entry: 'index.html', pageRoutes: routes, files };
}

const zipScript = `
import hashlib, json, pathlib, sys, zipfile
build, metadata, output = map(pathlib.Path, sys.argv[1:])
manifest_bytes = metadata.read_bytes()
manifest = json.loads(manifest_bytes)
def add(archive, name, data):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
with zipfile.ZipFile(output, 'w', allowZip64=True) as archive:
    add(archive, 'frontend-manifest.json', manifest_bytes)
    for item in manifest['files']:
        data = (build / item['path']).read_bytes()
        if len(data) != item['size'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise RuntimeError('Asset changed while packaging: ' + item['path'])
        add(archive, item['path'], data)
with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('ZIP integrity verification failed')
`;

export async function bundleFrontend(rootDirectory) {
	const buildDirectory = path.join(rootDirectory, 'build');
	const outputDirectory = path.join(rootDirectory, 'dist');
	const provenance = JSON.parse(await readFile(path.join(rootDirectory, 'frontend.upstream.json')));
	const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: rootDirectory,
		encoding: 'utf8'
	}).trim();
	const manifest = await createManifest(
		buildDirectory,
		await pagePatterns(path.join(rootDirectory, 'src/routes')),
		{ ...provenance, sourceCommit }
	);
	await mkdir(outputDirectory, { recursive: true });
	const metadata = path.join(outputDirectory, METADATA_FILE);
	const archive = path.join(outputDirectory, ARCHIVE_FILE);
	await writeFile(metadata, JSON.stringify(manifest, null, 2) + '\n');
	execFileSync('python3', ['-c', zipScript, buildDirectory, metadata, archive], {
		stdio: 'inherit'
	});
	const archiveBytes = await readFile(archive);
	const metadataBytes = await readFile(metadata);
	await writeFile(
		path.join(outputDirectory, 'SHA256SUMS'),
		`${sha256(archiveBytes)}  ${ARCHIVE_FILE}\n${sha256(metadataBytes)}  ${METADATA_FILE}\n`
	);
	console.log(
		JSON.stringify({
			archive,
			sha256: sha256(archiveBytes),
			bytes: archiveBytes.length,
			sourceCommit,
			pageRoutes: manifest.pageRoutes.length,
			files: manifest.files.length
		})
	);
	return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await bundleFrontend(path.resolve(fileURLToPath(new URL('..', import.meta.url))));
}
