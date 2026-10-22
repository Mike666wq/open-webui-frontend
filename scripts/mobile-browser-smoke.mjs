#!/usr/bin/env node
/**
 * Exercise the built Svelte app in a real Chromium layout engine.
 *
 * The API-only fixture serves this package's build output and deterministic
 * chat data. No route substitutes or handwritten application HTML are used.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const origin = process.env.MOBILE_SMOKE_ORIGIN || 'http://127.0.0.1:8765';
const chatUrl = `${origin}/c/layout-fixture`;
const outputDirectory = path.resolve(
	process.env.MOBILE_SMOKE_OUTPUT || 'artifacts/mobile-browser-smoke'
);
const viewports = [
	{ name: '375x812', width: 375, height: 812 },
	{ name: '393x852', width: 393, height: 852 },
	{ name: '430x932', width: 430, height: 932 }
];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function chromeExecutable() {
	const candidates = [
		process.env.CHROME_BIN,
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium'
	].filter(Boolean);
	const executable = candidates.find((candidate) => existsSync(candidate));
	if (!executable) {
		throw new Error('Chromium/Chrome is unavailable; set CHROME_BIN before running this check');
	}
	return executable;
}

async function waitForHttp(url, timeout = 45_000) {
	const deadline = Date.now() + timeout;
	let lastError;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) return await response.json();
		} catch (error) {
			lastError = error;
		}
		await sleep(250);
	}
	throw new Error(`Timed out waiting for ${url}: ${lastError || 'no response'}`);
}

async function waitForValue(read, predicate, label, timeout = 45_000) {
	const deadline = Date.now() + timeout;
	let latest;
	while (Date.now() < deadline) {
		try {
			latest = await read();
			if (predicate(latest)) return latest;
		} catch (error) {
			latest = String(error);
		}
		await sleep(150);
	}
	throw new Error(`Timed out waiting for ${label}; latest=${JSON.stringify(latest)}`);
}

class CdpClient {
	constructor(webSocketUrl) {
		this.webSocketUrl = webSocketUrl;
		this.nextId = 1;
		this.pending = new Map();
	}

	async connect() {
		this.socket = new WebSocket(this.webSocketUrl);
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('CDP connection timed out')), 15_000);
			this.socket.addEventListener(
				'open',
				() => {
					clearTimeout(timeout);
					resolve();
				},
				{ once: true }
			);
			this.socket.addEventListener(
				'error',
				(event) => {
					clearTimeout(timeout);
					reject(event.error || new Error('CDP connection failed'));
				},
				{ once: true }
			);
		});
		this.socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data));
			if (!message.id) return;
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timeout);
			if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
			else pending.resolve(message.result || {});
		});
	}

	send(method, params = {}, timeout = 30_000) {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out`));
			}, timeout);
			this.pending.set(id, { method, resolve, reject, timeout: timer });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	async evaluate(expression) {
		const response = await this.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true
		});
		if (response.exceptionDetails) {
			throw new Error(
				`Page evaluation failed: ${
					response.exceptionDetails.exception?.description ||
					response.exceptionDetails.text
				}`
			);
		}
		return response.result?.value;
	}

	async waitForExpression(expression, label, timeout = 45_000) {
		return waitForValue(
			() => this.evaluate(expression),
			(value) => Boolean(value),
			label,
			timeout
		);
	}

	async navigate(url, readyExpression = "document.readyState === 'complete'") {
		await this.send('Page.navigate', { url });
		await this.waitForExpression(readyExpression, `document at ${url}`, 60_000);
	}

	async click(expression, label) {
		const rect = await this.evaluate(`
			(() => {
				const element = ${expression};
				if (!element) return null;
				element.scrollIntoView({ block: 'center', inline: 'nearest' });
				const bounds = element.getBoundingClientRect();
				if (bounds.width < 1 || bounds.height < 1) return null;
				return {
					x: bounds.left + bounds.width / 2,
					y: bounds.top + bounds.height / 2
				};
			})()
		`);
		assert.ok(rect, `Missing clickable control: ${label}`);
		await this.send('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			x: rect.x,
			y: rect.y,
			button: 'left',
			clickCount: 1
		});
		await this.send('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			x: rect.x,
			y: rect.y,
			button: 'left',
			clickCount: 1
		});
	}

	async touchSwipe(fromX, toX, y) {
		const point = (x) => ({ x, y, radiusX: 1, radiusY: 1, force: 1 });
		await this.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [point(fromX)]
		});
		await this.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [point((fromX + toX) / 2)]
		});
		await this.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [point(toX)]
		});
		await this.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: []
		});
	}

	async screenshot(filename) {
		await mkdir(outputDirectory, { recursive: true });
		const capture = await this.send('Page.captureScreenshot', {
			format: 'png',
			fromSurface: true
		});
		await writeFile(path.join(outputDirectory, filename), Buffer.from(capture.data, 'base64'));
	}

	close() {
		this.socket?.close();
	}
}

function assertHorizontalBounds(label, rect, width) {
	assert.ok(rect, `${label} is missing`);
	assert.ok(rect.left >= -0.5, `${label} crosses the left viewport edge: ${JSON.stringify(rect)}`);
	assert.ok(
		rect.right <= width + 0.5,
		`${label} crosses the right viewport edge: ${JSON.stringify(rect)}`
	);
}

async function chatGeometry(cdp, width) {
	await cdp.waitForExpression(
		`Boolean(
			document.querySelector('.owui-assistant-message .owui-assistant-card') &&
			document.querySelector('.owui-assistant-card .markdown-prose') &&
			document.querySelector('#message-input-container')
		)`,
		'real chat layout',
		15_000
	);
	const geometry = await cdp.evaluate(`
		(() => {
			const capture = (element) => {
				const rect = element.getBoundingClientRect();
				return {
					left: rect.left,
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom,
					width: rect.width,
					height: rect.height
				};
			};
			const card = document.querySelector('.owui-assistant-message .owui-assistant-card');
			const body = document.querySelector('.owui-assistant-card .markdown-prose');
			const composer = document.querySelector('#message-input-container');
			return {
				viewport: { width: innerWidth, height: innerHeight },
				page: {
					scrollWidth: document.documentElement.scrollWidth,
					clientWidth: document.documentElement.clientWidth
				},
				card: capture(card),
				body: capture(body),
				composer: capture(composer),
				actions: [...document.querySelectorAll('.owui-assistant-card .buttons button')]
					.map(capture)
			};
		})()
	`);
	assert.equal(geometry.viewport.width, width);
	assert.ok(
		geometry.page.scrollWidth <= geometry.page.clientWidth + 1,
		`${width}px page has horizontal overflow: ${JSON.stringify(geometry.page)}`
	);
	for (const [label, rect] of Object.entries({
		'assistant card': geometry.card,
		'assistant body': geometry.body,
		composer: geometry.composer
	})) {
		assertHorizontalBounds(`${width}px ${label}`, rect, width);
	}
	for (const [index, action] of geometry.actions.entries()) {
		assertHorizontalBounds(`${width}px message action ${index}`, action, width);
	}
	assert.ok(
		geometry.composer.top < geometry.viewport.height + 0.5,
		`${width}px composer is below the viewport`
	);
	return geometry;
}

async function openSettings(cdp) {
	const userMenuVisible = await cdp.evaluate(`
		Boolean(
			document.querySelector('button[aria-label="User menu"]') ||
			document.querySelector('button[aria-label="用户菜单"]')
		)
	`);
	if (!userMenuVisible) {
		await cdp.click(
			`document.querySelector('button[aria-label="Open Sidebar"]') ||
			 document.querySelector('button[aria-label="展开侧边栏"]')`,
			'open sidebar'
		);
		await cdp.waitForExpression(
			`Boolean(
				document.querySelector('button[aria-label="User menu"]') ||
				document.querySelector('button[aria-label="用户菜单"]')
			)`,
			'user menu after opening sidebar'
		);
		await sleep(350);
	}
	await cdp.click(
		`document.querySelector('button[aria-label="User menu"]') ||
		 document.querySelector('button[aria-label="用户菜单"]')`,
		'user menu'
	);
	await sleep(350);
	const menuOpened = await cdp.evaluate(`
		[...document.querySelectorAll('button')]
			.some((button) => ['Settings', '设置'].includes(button.textContent.trim()))
	`);
	if (!menuOpened) {
		await cdp.evaluate(`
			(() => {
				const button =
					document.querySelector('button[aria-label="User menu"]') ||
					document.querySelector('button[aria-label="用户菜单"]');
				button?.click();
			})()
		`);
		await sleep(350);
	}
	await cdp.waitForExpression(
		`[...document.querySelectorAll('button')]
			.some((button) => ['Settings', '设置'].includes(button.textContent.trim()))`,
		'settings action'
	);
	await cdp.click(
		`[...document.querySelectorAll('button')]
			.find((button) => ['Settings', '设置'].includes(button.textContent.trim()))`,
		'settings'
	);
	await cdp.waitForExpression(
		`Boolean(
			document.querySelector('.settings-content-scroll') &&
			document.querySelector('button[aria-controls="tab-appearance"]')
		)`,
		'settings dialog'
	);
	await cdp.click(
		`document.querySelector('button[aria-controls="tab-appearance"]')`,
		'appearance tab'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('#open-mist-appearance-editor'))`,
		'appearance editor entry'
	);
}

async function dismissUpdateDialog(cdp) {
	const visible = await cdp.evaluate(`
		Boolean([...document.querySelectorAll('button')]
			.find((button) => button.textContent.includes('确认，开始使用')))
	`);
	if (!visible) return;
	await cdp.click(
		`[...document.querySelectorAll('button')]
			.find((button) => button.textContent.includes('确认，开始使用'))`,
		'update acknowledgements'
	);
	await sleep(500);
	const stillVisible = await cdp.evaluate(`
		(() => {
			const button = [...document.querySelectorAll('button')]
				.find((candidate) => candidate.textContent.includes('确认，开始使用'));
			return Boolean(button && button.getBoundingClientRect().height > 0);
		})()
	`);
	if (stillVisible) {
		await cdp.evaluate(`
			[...document.querySelectorAll('button')]
				.find((button) => button.textContent.includes('确认，开始使用'))
				?.click()
		`);
		await sleep(500);
	}
}

async function settingsGeometry(cdp, width, height) {
	const before = await cdp.evaluate(`
		(() => {
			const area = document.querySelector('.settings-content-scroll');
			const editor = document.querySelector('#open-mist-appearance-editor');
			if (!area || !editor) return null;
			const areaRect = area.getBoundingClientRect();
			const editorRect = editor.getBoundingClientRect();
			return {
				clientHeight: area.clientHeight,
				scrollHeight: area.scrollHeight,
				scrollTop: area.scrollTop,
				area: {
					left: areaRect.left,
					top: areaRect.top,
					right: areaRect.right,
					bottom: areaRect.bottom
				},
				editor: {
					left: editorRect.left,
					top: editorRect.top,
					right: editorRect.right,
					bottom: editorRect.bottom
				}
			};
		})()
	`);
	assert.ok(before, 'Appearance settings or editor entry is missing');
	assert.ok(
		before.scrollHeight > before.clientHeight + 1,
		`Appearance settings has no independent scroll area: ${JSON.stringify(before)}`
	);
	await cdp.evaluate(`
		(() => {
			const area = document.querySelector('.settings-content-scroll');
			area.scrollTop = area.scrollHeight;
			area.dispatchEvent(new Event('scroll', { bubbles: true }));
		})()
	`);
	const reachable = await cdp.evaluate(`
		(() => {
			const area = document.querySelector('.settings-content-scroll');
			const editor = document.querySelector('#open-mist-appearance-editor');
			const areaRect = area.getBoundingClientRect();
			const editorRect = editor.getBoundingClientRect();
			return {
				scrollTop: area.scrollTop,
				visible:
					editorRect.top >= areaRect.top - 0.5 &&
					editorRect.bottom <= areaRect.bottom + 0.5 &&
					editorRect.left >= areaRect.left - 0.5 &&
					editorRect.right <= areaRect.right + 0.5 &&
					editorRect.top >= -0.5 &&
					editorRect.bottom <= ${height} + 0.5 &&
					editorRect.left >= -0.5 &&
					editorRect.right <= ${width} + 0.5,
				editor: {
					left: editorRect.left,
					top: editorRect.top,
					right: editorRect.right,
					bottom: editorRect.bottom
				}
			};
		})()
	`);
	assert.ok(reachable.scrollTop > before.scrollTop, 'The settings page did not scroll');
	assert.ok(
		reachable.visible,
		`The appearance editor entry is outside the ${width}x${height} viewport: ${JSON.stringify(reachable)}`
	);
	await cdp.click(
		`document.querySelector('#open-mist-appearance-editor')`,
		'appearance editor entry'
	);
	await cdp.waitForExpression(
		`Boolean(
			document.querySelector('.mist-panel__body') &&
			document.querySelector('.mist-panel__footer')
		)`,
		'appearance editor'
	);
	await sleep(500);
	const editor = await cdp.evaluate(`
		(() => {
			const body = document.querySelector('.mist-panel__body');
			const footer = document.querySelector('.mist-panel__footer');
			body.scrollTop = body.scrollHeight;
			const footerRect = footer.getBoundingClientRect();
			return {
				clientHeight: body.clientHeight,
				scrollHeight: body.scrollHeight,
				scrollTop: body.scrollTop,
				footer: {
					left: footerRect.left,
					top: footerRect.top,
					right: footerRect.right,
					bottom: footerRect.bottom
				},
				actions: [...footer.querySelectorAll('button')].map((button) => {
					const rect = button.getBoundingClientRect();
					return {
						label: button.textContent.trim(),
						left: rect.left,
						top: rect.top,
						right: rect.right,
						bottom: rect.bottom
					};
				})
			};
		})()
	`);
	assert.ok(
		editor.scrollHeight > editor.clientHeight + 1,
		`Appearance editor has no scrollable body: ${JSON.stringify(editor)}`
	);
	assert.ok(editor.scrollTop > 0, 'Appearance editor body did not scroll to the last group');
	assert.ok(
		editor.footer.top >= -0.5 && editor.footer.bottom <= height + 0.5,
		`Appearance editor actions are outside the viewport: ${JSON.stringify(editor.footer)}`
	);
	for (const action of editor.actions) {
		assertHorizontalBounds(`${action.label || 'editor'} action`, action, width);
	}
	return { before, reachable, editor };
}

async function wallpaperPanning(cdp) {
	const appearance = {
		version: 6,
		enabled: true,
		directoryEnabled: true,
		preset: 'mist-blue',
		theme: 'light',
		modes: {
			light: {
				background: {
					kind: 'official-video',
					video: 'welcome',
					focus: { portrait: 0.5, landscape: 0.5 },
					mask: 22,
					blur: 8
				}
			},
			dark: {
				background: {
					kind: 'official-video',
					video: 'welcome',
					focus: { portrait: 0.5, landscape: 0.5 },
					mask: 22,
					blur: 8
				}
			}
		},
		motion: 'gentle'
	};
	await cdp.evaluate(
		`localStorage.setItem(
			'owui-appearance:v3:' + location.origin,
			${JSON.stringify(JSON.stringify(appearance))}
		)`
	);
	await cdp.navigate(
		chatUrl,
		"document.readyState === 'complete' && document.querySelector('.mist-backdrop__wallpaper')"
	);
	await dismissUpdateDialog(cdp);
	await cdp.waitForExpression(
		`(() => {
			const media = document.querySelector('.mist-backdrop__wallpaper');
			if (!media || media.tagName !== 'VIDEO') return false;
			const rect = media.getBoundingClientRect();
			return rect.width > innerWidth + 8 && rect.height > 0;
		})()`,
		'pannable official motion wallpaper',
		20_000
	);

	const readLeft = () =>
		cdp.evaluate(
			`document.querySelector('.mist-backdrop__wallpaper').getBoundingClientRect().left`
		);
	const swipes = [
		{ from: 340, to: 110 },
		{ from: 110, to: 340 },
		{ from: 340, to: 110 }
	];
	const leftPositions = [await readLeft()];
	for (const [index, swipe] of swipes.entries()) {
		await cdp.touchSwipe(swipe.from, swipe.to, 360);
		await sleep(180);
		const left = await readLeft();
		assert.ok(
			Math.abs(left - leftPositions[index]) > 20,
			`Wallpaper swipe ${index + 1} did not move the background: ${JSON.stringify({
				before: leftPositions[index],
				after: left
			})}`
		);
		leftPositions.push(left);
	}
	return { swipes: swipes.length, leftPositions };
}

async function main() {
	const fixture = await waitForHttp(`${origin}/__fixture_provenance`);
	assert.equal(fixture.schema, 1);
	assert.match(fixture.sourceCommit, /^[0-9a-f]{40}$/);
	await mkdir(outputDirectory, { recursive: true });

	const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'mobile-browser-smoke-'));
	const debugPort = 9300 + Math.floor(Math.random() * 400);
	const chrome = spawn(
		chromeExecutable(),
		[
			'--headless=new',
			'--disable-background-networking',
			'--disable-component-update',
			'--disable-default-apps',
			'--disable-dev-shm-usage',
			'--disable-extensions',
			'--disable-gpu',
			'--hide-scrollbars',
			'--no-first-run',
			'--no-sandbox',
			`--remote-debugging-port=${debugPort}`,
			`--user-data-dir=${userDataDirectory}`,
			'about:blank'
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);
	let chromeError = '';
	chrome.stderr.on('data', (chunk) => {
		chromeError = `${chromeError}${chunk}`.slice(-20_000);
	});

	let client;
	try {
		await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
		const targets = await waitForHttp(`http://127.0.0.1:${debugPort}/json/list`);
		const target = targets.find((candidate) => candidate.type === 'page');
		assert.ok(target?.webSocketDebuggerUrl, 'Chromium did not expose a page target');
		client = new CdpClient(target.webSocketDebuggerUrl);
		await client.connect();
		await Promise.all([
			client.send('Page.enable'),
			client.send('Runtime.enable'),
			client.send('Network.enable')
		]);
		await client.send('Page.addScriptToEvaluateOnNewDocument', {
			source: `
				window.__mobileSmokeErrors = [];
				addEventListener('error', (event) => {
					window.__mobileSmokeErrors.push(String(event.error?.stack || event.message));
				});
				addEventListener('unhandledrejection', (event) => {
					window.__mobileSmokeErrors.push(String(event.reason?.stack || event.reason));
				});
			`
		});
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: viewports[0].width,
			height: viewports[0].height,
			deviceScaleFactor: 2,
			mobile: true
		});
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 5
		});

		await client.navigate(origin);
		await client.evaluate("localStorage.setItem('token', 'fixture-token')");
		await client.navigate(
			chatUrl,
			"document.readyState === 'complete' && document.querySelector('.owui-mist-app')"
		);
		await dismissUpdateDialog(client);

		const results = { sourceCommit: fixture.sourceCommit, viewports: {} };
		for (const viewport of viewports) {
			await client.send('Emulation.setDeviceMetricsOverride', {
				width: viewport.width,
				height: viewport.height,
				deviceScaleFactor: 2,
				mobile: true
			});
			await client.send('Emulation.setTouchEmulationEnabled', {
				enabled: true,
				maxTouchPoints: 5
			});
			await sleep(250);
			results.viewports[viewport.name] = {
				chat: await chatGeometry(client, viewport.width)
			};
			await client.screenshot(`chat-${viewport.name}.png`);
			await dismissUpdateDialog(client);
		}

		await client.send('Emulation.setDeviceMetricsOverride', {
			width: 393,
			height: 852,
			deviceScaleFactor: 2,
			mobile: true
		});
		results.wallpaperPan = await wallpaperPanning(client);
		await openSettings(client);
		results.settings = await settingsGeometry(client, 393, 852);
		await client.screenshot('appearance-editor-393x852.png');

		await writeFile(
			path.join(outputDirectory, 'geometry.json'),
			`${JSON.stringify(results, null, 2)}\n`
		);
		console.log(
			JSON.stringify({
				status: 'pass',
				sourceCommit: fixture.sourceCommit,
				viewports: viewports.map(({ name }) => name),
				wallpaperPan: results.wallpaperPan.swipes,
				settingsScrollable: true,
				editorActionsReachable: true
			})
		);
	} catch (error) {
		let pageState = null;
		try {
			await client?.screenshot('failure.png');
			pageState = await client?.evaluate(`
				(() => ({
					href: location.href,
					title: document.title,
					text: document.body.innerText.slice(0, 2000),
					app: Boolean(document.querySelector('.owui-mist-app')),
					cards: document.querySelectorAll('.owui-assistant-message .owui-assistant-card').length,
					composers: document.querySelectorAll('#message-input-container').length,
					errors: window.__mobileSmokeErrors || [],
					inputs: [...document.querySelectorAll(
						'#chat-input-container, textarea, [contenteditable="true"]'
					)].map((element) => ({
						tag: element.tagName,
						id: element.id,
						className: element.className,
						visible: element.getBoundingClientRect().height > 0
					}))
				}))()
			`);
		} catch {
			// Preserve the original failure if the page target is already gone.
		}
		await writeFile(
			path.join(outputDirectory, 'chrome.log'),
			`${JSON.stringify(
				{ error: error.stack || String(error), pageState, chrome: chromeError },
				null,
				2
			)}\n`
		);
		throw error;
	} finally {
		client?.close();
		chrome.kill('SIGTERM');
		await new Promise((resolve) => {
			const timer = setTimeout(resolve, 2_000);
			chrome.once('exit', () => {
				clearTimeout(timer);
				resolve();
			});
		});
		// Chromium can outlive SIGTERM long enough to keep writing its profile
		// (the `Default` dir), which makes a single rmdir fail with ENOTEMPTY.
		// Retry briefly so a slow shutdown does not fail an otherwise-passing run.
		let removeError = null;
		for (let attempt = 0; attempt < 6; attempt += 1) {
			try {
				await rm(userDataDirectory, { recursive: true, force: true });
				removeError = null;
				break;
			} catch (error) {
				removeError = error;
				await sleep(400);
			}
		}
		if (removeError) {
			// A leftover temp profile must never fail a run whose checks passed.
			console.warn(`Could not remove Chromium profile ${userDataDirectory}: ${removeError.message}`);
		}
	}
}

await main();
