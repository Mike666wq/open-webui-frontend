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
					response.exceptionDetails.exception?.description || response.exceptionDetails.text
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
		// Settings tabs sit in a clipped, scrolling rail with overlay arrows.
		const checkHit = expression.includes('aria-controls');
		const rect = await waitForValue(
			() =>
				this.evaluate(`
                (async () => {
                    const element = ${expression};
                    if (!element || element.disabled) return null;
                    element.scrollIntoView({ behavior: 'instant', block: 'center', inline: ${JSON.stringify(checkHit ? 'center' : 'nearest')} });
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    const before = element.getBoundingClientRect();
                    if (${checkHit}) await new Promise(resolve => setTimeout(resolve, 100));
                    const bounds = element.getBoundingClientRect();
                    if (bounds.width < 1 || bounds.height < 1) return null;
                    if (${checkHit} && (Math.abs(before.left - bounds.left) > 0.5 || Math.abs(before.top - bounds.top) > 0.5)) return null;
                    const x = bounds.left + bounds.width / 2;
                    const y = bounds.top + bounds.height / 2;
                    const hit = document.elementFromPoint(x, y);
                    if (${checkHit} && (!hit || (hit !== element && !element.contains(hit)))) return null;
                    return { x, y };
                })()
            `),
			(value) => Boolean(value),
			`visible, unobstructed control: ${label}`,
			15_000
		);
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
                pane: capture(document.querySelector('.owui-messages')),
                message: capture(document.querySelector('.owui-message-listitem')),
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
	const center = (rect) => (rect.left + rect.right) / 2;
	assert.ok(
		Math.abs(center(geometry.composer) - center(geometry.pane)) <= 2,
		`${width}px composer is not centered in chat pane: ${JSON.stringify(geometry)}`
	);
	assert.ok(
		Math.abs(center(geometry.message) - center(geometry.pane)) <= 2,
		`${width}px message is not centered in chat pane`
	);
	return geometry;
}

async function assertKnowledgeImportGeometry(cdp, label) {
	const geometry = await cdp.evaluate(`
		(() => {
			const bounds = (element) => {
				if (!element) return null;
				const rect = element.getBoundingClientRect();
				return {
					left: rect.left,
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom,
					width: rect.width,
					height: rect.height,
					scrollWidth: element.scrollWidth,
					clientWidth: element.clientWidth
				};
			};
			const anchor = document.querySelector('[data-testid="knowledge-import-modal"]');
			const dialog = anchor?.closest('[role="dialog"]');
			const surface = dialog?.querySelector(':scope > div');
			const content = anchor?.nextElementSibling;
			const report = document.querySelector('[data-testid="knowledge-import-report"]');
			return {
				viewport: { width: innerWidth, height: innerHeight },
				page: {
					scrollWidth: document.documentElement.scrollWidth,
					clientWidth: document.documentElement.clientWidth
				},
				dialog: bounds(dialog),
				surface: bounds(surface),
				content: bounds(content),
				report: bounds(report)
			};
		})()
	`);
	assert.ok(geometry.dialog, `${label}: import dialog missing`);
	assert.ok(
		geometry.page.scrollWidth <= geometry.page.clientWidth + 1,
		`${label}: page has horizontal overflow: ${JSON.stringify(geometry.page)}`
	);
	for (const [name, rect] of Object.entries({
		dialog: geometry.dialog,
		surface: geometry.surface,
		content: geometry.content
	})) {
		assert.ok(rect, `${label}: ${name} missing`);
		assert.ok(rect.left >= -0.5, `${label}: ${name} crosses left edge`);
		assert.ok(rect.right <= geometry.viewport.width + 0.5, `${label}: ${name} crosses right edge`);
	}
	if (geometry.report) {
		assert.ok(
			geometry.report.scrollWidth <= geometry.report.clientWidth + 1,
			`${label}: report has horizontal overflow: ${JSON.stringify(geometry.report)}`
		);
	}
	return geometry;
}

async function openKnowledgeImport(cdp) {
	await cdp.click(
		`[...document.querySelectorAll('button')].find(
			(button) => ['Add Content', '添加内容'].includes(button.getAttribute('aria-label'))
		)`,
		'knowledge add content'
	);
	await cdp.waitForExpression(
		`[...document.querySelectorAll('button')].some(
			(button) => ['Import Markdown folder', '导入 Markdown 文件夹'].includes(button.textContent.trim())
		)`,
		'Markdown folder import menu item'
	);
	await cdp.click(
		`[...document.querySelectorAll('button')].find(
			(button) => ['Import Markdown folder', '导入 Markdown 文件夹'].includes(button.textContent.trim())
		)`,
		'Markdown folder import'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="knowledge-import-choose"]'))`,
		'Markdown folder selection screen'
	);
}

async function chooseKnowledgeImportFiles(cdp) {
	await cdp.click(
		`document.querySelector('[data-testid="knowledge-import-choose"]')`,
		'choose import folder'
	);
	await waitForValue(
		() =>
			cdp.evaluate(
				`[...document.querySelectorAll('input[type="file"]')].some(
					(input) => input.webkitdirectory === true
				)`
			),
		Boolean,
		'folder file input'
	);
	await cdp.evaluate(`
		(() => {
			const input = [...document.querySelectorAll('input[type="file"]')].find(
				(candidate) => candidate.webkitdirectory === true
			);
			if (!input) throw new Error('folder file input disappeared');
			const transfer = new DataTransfer();
			const files = [
				{
					name: 'pic.png',
					relativePath: 'fixture-root/a/pic.png',
					type: 'image/png',
					body: 'synthetic-png'
				},
				{
					name: 'doc.md',
					relativePath: 'fixture-root/a/doc.md',
					type: 'text/markdown',
					body: '# 可读正文\\n\\n![示意图](pic.png)'
				},
				{
					name: 'broken.md',
					relativePath: 'fixture-root/b/broken.md',
					type: 'text/markdown',
					body: '# 索引失败夹具'
				}
			];
			for (const spec of files) {
				const file = new File([spec.body], spec.name, { type: spec.type });
				Object.defineProperty(file, 'webkitRelativePath', {
					value: spec.relativePath,
					configurable: true
				});
				transfer.items.add(file);
			}
			input.files = transfer.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		})()
	`);
	await cdp.waitForExpression(
		`Boolean(
			document.querySelector('[data-testid="knowledge-import-start"]') &&
			document.querySelector('[data-testid="knowledge-import-modal"]')?.parentElement?.textContent.includes('3') &&
			document.querySelector('[data-testid="knowledge-import-modal"]')?.parentElement?.textContent.includes('2')
		)`,
		'folder import preview counts'
	);
}

async function startKnowledgeImportWithKeyboard(cdp) {
	await cdp.evaluate(
		`document.querySelector('[data-testid="knowledge-import-start"]')?.focus()`
	);
	await cdp.send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'Enter',
		code: 'Enter',
		windowsVirtualKeyCode: 13,
		nativeVirtualKeyCode: 13,
		text: '\r',
		unmodifiedText: '\r'
	});
	await cdp.send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'Enter',
		code: 'Enter',
		windowsVirtualKeyCode: 13,
		nativeVirtualKeyCode: 13
	});
}

async function closeKnowledgeImport(cdp) {
	await cdp.send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'Escape',
		code: 'Escape',
		windowsVirtualKeyCode: 27
	});
	await cdp.send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'Escape',
		code: 'Escape',
		windowsVirtualKeyCode: 27
	});
	await cdp.waitForExpression(
		`!document.querySelector('[data-testid="knowledge-import-modal"]')`,
		'import dialog closed'
	);
}

async function knowledgeImportFlow(cdp, viewport, { cancel = false, refresh = false } = {}) {
	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: viewport.width,
		height: viewport.height,
		deviceScaleFactor: 2,
		mobile: true
	});
	await cdp.send('Emulation.setTouchEmulationEnabled', {
		enabled: true,
		maxTouchPoints: 5
	});
	await cdp.navigate(
		`${origin}/workspace/knowledge/import-kb`,
		`Boolean(
			document.querySelector('[data-testid="knowledge-import-modal"]') ||
			[...document.querySelectorAll('button')].some(
				(button) => ['Add Content', '添加内容'].includes(button.getAttribute('aria-label'))
			)
		)`
	);
	await openKnowledgeImport(cdp);
	const selection = await assertKnowledgeImportGeometry(
		cdp,
		`${viewport.name} import selection`
	);
	await cdp.screenshot(`knowledge-import-selection-${viewport.name}.png`);
	await chooseKnowledgeImportFiles(cdp);
	const preview = await assertKnowledgeImportGeometry(
		cdp,
		`${viewport.name} import preview`
	);
	await cdp.screenshot(`knowledge-import-preview-${viewport.name}.png`);
	await startKnowledgeImportWithKeyboard(cdp);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="knowledge-import-cancel"]'))`,
		`${viewport.name} import running`
	);
	const running = await assertKnowledgeImportGeometry(
		cdp,
		`${viewport.name} import running`
	);
	await cdp.screenshot(`knowledge-import-running-${viewport.name}.png`);
	if (cancel) {
		await cdp.click(
			`document.querySelector('[data-testid="knowledge-import-cancel"]')`,
			'cancel import'
		);
		await cdp.waitForExpression(
			`document.querySelector('[data-testid="knowledge-import-report"]')?.textContent.includes('导入已取消') ||
			 document.querySelector('[data-testid="knowledge-import-report"]')?.textContent.includes('Import cancelled')`,
			`${viewport.name} cancelled report`
		);
	} else {
		await cdp.waitForExpression(
			`document.querySelector('[data-testid="knowledge-import-report"]')?.textContent.includes('导入完成，但部分项目存在问题') ||
			 document.querySelector('[data-testid="knowledge-import-report"]')?.textContent.includes('Import completed with errors')`,
			`${viewport.name} partial failure report`
		);
		assert.match(
			await cdp.evaluate(
				`document.querySelector('[data-testid="knowledge-import-report"]')?.textContent ?? ''`
			),
			/b\/broken\.md.*index: Synthetic index failure \(pending\)/
		);
		const summary = `document.querySelector('[data-testid="knowledge-import-report"] details[open] summary')`;
		await cdp.evaluate(`(${summary})?.focus()`);
		await cdp.send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			key: 'Enter',
			code: 'Enter',
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
			text: '\r',
			unmodifiedText: '\r'
		});
		await cdp.send('Input.dispatchKeyEvent', {
			type: 'keyUp',
			key: 'Enter',
			code: 'Enter',
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13
		});
		assert.equal(
			await cdp.evaluate(
				`document.querySelector('[data-testid="knowledge-import-report"] details')?.open`
			),
			false,
			`${viewport.name} failure details close by keyboard`
		);
		await cdp.send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			key: 'Enter',
			code: 'Enter',
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
			text: '\r',
			unmodifiedText: '\r'
		});
		await cdp.send('Input.dispatchKeyEvent', {
			type: 'keyUp',
			key: 'Enter',
			code: 'Enter',
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13
		});
		assert.equal(
			await cdp.evaluate(
				`document.querySelector('[data-testid="knowledge-import-report"] details')?.open`
			),
			true,
			`${viewport.name} failure details open by keyboard`
		);
	}
	const report = await assertKnowledgeImportGeometry(cdp, `${viewport.name} import report`);
	await cdp.screenshot(`knowledge-import-report-${viewport.name}.png`);
	const storedStatus = await cdp.evaluate(`
		(() => {
			const key = Object.keys(sessionStorage).find((entry) =>
				entry.startsWith('owui:knowledge-import:v2:fixture-user:import-kb')
			);
			return key ? JSON.parse(sessionStorage.getItem(key)).status : null;
		})()
	`);
	assert.equal(storedStatus, cancel ? 'cancelled' : 'completed_with_errors');
	await closeKnowledgeImport(cdp);

	if (refresh) {
		await cdp.navigate(
			`${origin}/workspace/knowledge/import-kb`,
			`[...document.querySelectorAll('button')].some(
				(button) => ['Add Content', '添加内容'].includes(button.getAttribute('aria-label'))
			)`
		);
		await openKnowledgeImport(cdp);
		await cdp.waitForExpression(
			`[...document.querySelectorAll('button')].some(
				(button) => ['Last import report', '上次导入报告'].includes(button.textContent.trim())
			)`,
			'persisted last import report'
		);
		await cdp.click(
			`[...document.querySelectorAll('button')].find(
				(button) => ['Last import report', '上次导入报告'].includes(button.textContent.trim())
			)`,
			'open persisted import report'
		);
		await cdp.waitForExpression(
			`Boolean(document.querySelector('[data-testid="knowledge-import-report"]'))`,
			'persisted import report details'
		);
		await closeKnowledgeImport(cdp);
	}
	return { selection, preview, running, report, storedStatus };
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

async function providerSettings(cdp) {
	// The fixture intentionally disables browser direct connections. This catches
	// regressions where the server-managed account tab inherits that switch.
	await cdp.waitForExpression(
		`Boolean(document.querySelector('button[aria-controls="tab-connections"]'))`,
		'server provider settings tab'
	);
	await cdp.click(
		`document.querySelector('button[aria-controls="tab-connections"]')`,
		'provider settings tab'
	);
	await cdp.waitForExpression(
		`document.querySelector('[data-testid="provider-add"]')?.disabled === false`,
		'provider account entry'
	);
	await cdp.click(`document.querySelector('[data-testid="provider-add"]')`, 'add provider');
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-template-deepseek"]'))`,
		'provider wizard'
	);
	const choose = async (id) => {
		await cdp.waitForExpression(
			`Boolean(document.querySelector('[data-testid="provider-template-${id}"]'))`,
			`loaded provider option ${id}`
		);
		await cdp.click(
			`document.querySelector('[data-testid="provider-template-${id}"]')`,
			`choose provider ${id}`
		);
	};
	const enterKey = async () => {
		await cdp.evaluate(
			`(() => { const input=document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="password"]'); input.value='synthetic-fixture-key'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`
		);
	};
	const backToTemplates = async () => {
		await cdp.click(
			`document.querySelector('[aria-labelledby="provider-wizard-title"] [data-testid="provider-back"]')`,
			'back to provider templates'
		);
		await cdp.waitForExpression(
			`Boolean(document.querySelector('[data-testid="provider-template-deepseek"]'))`,
			'provider template grid'
		);
	};
	// Provider types that are not implemented are listed but cannot be added.
	assert.equal(
		await cdp.evaluate(
			`document.querySelector('[data-testid="provider-template-anthropic"]')?.disabled === true`
		),
		true
	);
	await choose('deepseek');
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="password"]'))`,
		'provider key input'
	);
	await enterKey();
	// Switching the provider clears the key that was typed for the previous one.
	await backToTemplates();
	await choose('openai');
	await cdp.waitForExpression(
		`document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="password"]')?.value === ''`,
		'key cleared after provider change'
	);
	await backToTemplates();
	await choose('deepseek');
	await enterKey();
	await cdp.waitForExpression(
		`document.querySelector('[data-testid="provider-verify"]')?.disabled === false`,
		'verify enabled'
	);
	await cdp.click(`document.querySelector('[data-testid="provider-verify"]')`, 'verify provider');
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-save"]'))`,
		'provider model choice'
	);
	await cdp.click(
		`document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="checkbox"]')`,
		'unselect provider model'
	);
	await cdp.waitForExpression(
		`document.querySelector('[data-testid="provider-save"]')?.disabled === true`,
		'save disabled without selected models'
	);
	await cdp.click(
		`document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="checkbox"]')`,
		'select provider model'
	);
	await cdp.waitForExpression(
		`document.querySelector('[data-testid="provider-save"]')?.disabled === false`,
		'save re-enabled after model selection'
	);
	await cdp.click(`document.querySelector('[data-testid="provider-save"]')`, 'save provider');
	await cdp.waitForExpression(
		`!document.querySelector('[aria-labelledby="provider-wizard-title"]') && document.querySelector('#tab-connections')?.textContent.includes('DeepSeek')`,
		'saved provider account'
	);
	const provenance = await (await fetch(`${origin}/__fixture_provenance`)).json();
	const saved = provenance.events.find((event) => event.kind === 'provider-saved');
	assert.deepEqual(saved?.model_ids, ['deepseek-fixture']);
	assert.equal(saved?.visibility, 'private');
	const startKimi = async () => {
		await cdp.click(`document.querySelector('[data-testid="provider-add"]')`, 'add Kimi provider');
		await cdp.waitForExpression(
			`Boolean(document.querySelector('[data-testid="provider-template-kimi"]'))`,
			'Kimi provider select'
		);
		await choose('kimi');
		await cdp.waitForExpression(
			`document.querySelector('[data-testid="provider-verify"]')?.disabled === false`,
			'Kimi sign-in enabled without key'
		);
		assert.equal(
			await cdp.evaluate(
				`Boolean(document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="password"]'))`
			),
			false
		);
		await cdp.click(
			`document.querySelector('[data-testid="provider-verify"]')`,
			'start Kimi device sign-in'
		);
		await cdp.waitForExpression(
			`Boolean(document.querySelector('a[href^="https://www.kimi.com/device"]'))`,
			'Kimi verification link'
		);
		assert.match(
			await cdp.evaluate(
				`document.querySelector('[aria-labelledby="provider-wizard-title"]').textContent`
			),
			/TEST-1234/
		);
	};
	await startKimi();
	await cdp.click(
		`document.querySelector('[aria-labelledby="provider-wizard-title"] button[aria-label]')`,
		'cancel Kimi authorization'
	);
	await waitForValue(
		async () =>
			(await (await fetch(`${origin}/__fixture_provenance`)).json()).events.some(
				(event) => event.kind === 'kimi-cancelled'
			),
		Boolean,
		'Kimi cancel request'
	);
	await startKimi();
	await cdp.waitForExpression(
		`/Kimi Code (authorization was denied|授权已被拒绝)/.test(document.querySelector('[aria-labelledby="provider-wizard-title"]')?.textContent ?? '')`,
		'denied Kimi authorization'
	);
	await cdp.click(
		`document.querySelector('[aria-labelledby="provider-wizard-title"] button[aria-label]')`,
		'close denied Kimi authorization'
	);
	await startKimi();
	await cdp.waitForExpression(
		`!document.querySelector('[aria-labelledby="provider-wizard-title"]') && document.querySelector('#tab-connections')?.textContent.includes('Kimi Code')`,
		'connected Kimi account'
	);

	const startChatGPT = async () => {
		await cdp.click(`document.querySelector('[data-testid="provider-add"]')`, 'add ChatGPT');
		await cdp.waitForExpression(
			`Boolean(document.querySelector('[data-testid="provider-template-chatgpt"]'))`,
			'ChatGPT select'
		);
		await choose('chatgpt');
		await cdp.waitForExpression(
			`document.querySelector('[data-testid="provider-verify"]')?.disabled === false`,
			'ChatGPT login enabled'
		);
		await cdp.click(
			`document.querySelector('[data-testid="provider-verify"]')`,
			'start browser login'
		);
		await cdp.waitForExpression(
			`Boolean(document.querySelector('#chatgpt-callback-url'))`,
			'ChatGPT callback form'
		);
		assert.equal(
			await cdp.evaluate(
				`Boolean(document.querySelector('a[href^="https://auth.openai.com/api/accounts/authorize"]'))`
			),
			true
		);
		assert.equal(
			await cdp.evaluate(
				`Boolean(document.querySelector('[aria-labelledby="provider-wizard-title"] pre, a[href$="/helper"]'))`
			),
			false
		);
	};
	await startChatGPT();
	await cdp.screenshot('chatgpt-browser-login-393x852.png');
	await cdp.click(
		`document.querySelector('[aria-labelledby="provider-wizard-title"] button[aria-label]')`,
		'cancel ChatGPT'
	);
	await waitForValue(
		async () =>
			(await (await fetch(`${origin}/__fixture_provenance`)).json()).events.some(
				(event) => event.kind === 'chatgpt-browser-cancelled'
			),
		Boolean,
		'ChatGPT cancelled'
	);
	await startChatGPT();
	const submitCallback = async (value) => {
		await cdp.evaluate(
			`(() => {const input=document.querySelector('#chatgpt-callback-url'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input',{bubbles:true}));})()`
		);
		await cdp.click(
			`document.querySelector('#chatgpt-callback-url').nextElementSibling`,
			'complete ChatGPT login'
		);
	};
	await submitCallback('http://127.0.0.1:1455/auth/callback?state=wrong');
	await cdp.waitForExpression(
		`document.querySelector('[aria-labelledby="provider-wizard-title"]')?.textContent.includes('different sign-in')`,
		'invalid callback feedback'
	);
	await cdp.waitForExpression(
		`document.querySelector('#chatgpt-callback-url')?.value === ''`,
		'callback cleared after submission'
	);
	await submitCallback(
		'http://127.0.0.1:1455/auth/callback?code=fixture-code&state=fixture-state&client_id=oaiapp_fixture'
	);
	await cdp.waitForExpression(
		`!document.querySelector('[aria-labelledby="provider-wizard-title"]') && document.querySelector('#tab-connections')?.textContent.includes('ChatGPT')`,
		'ChatGPT connected without helper'
	);

	// MiniMax per-service wizard: every purpose gets its own service row and model
	// list, and switching one off removes it from the saved connection.
	await cdp.click(`document.querySelector('[data-testid="provider-add"]')`, 'add MiniMax provider');
	await choose('minimax');
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="password"]'))`,
		'MiniMax provider key input'
	);
	await enterKey();
	await cdp.waitForExpression(
		`['transcription','speech','image'].every(p => Boolean(document.querySelector('[data-testid="provider-service-' + p + '"]')))`,
		'MiniMax per-service configuration'
	);
	// Only the chat service starts enabled; every media service is opt-in.
	assert.equal(
		await cdp.evaluate(
			`(() => {const b=document.querySelector('[data-testid="provider-service-image"] input[type="checkbox"]');return b?.checked;})()`
		),
		false
	);
	const toggleService = async (purpose, expected) => {
		await cdp.click(
			`document.querySelector('[data-testid="provider-service-${purpose}"] input[type="checkbox"]')`,
			`toggle ${purpose} service`
		);
		await cdp.waitForExpression(
			`document.querySelector('[data-testid="provider-service-${purpose}"] input[type="checkbox"]')?.checked === ${expected}`,
			`${purpose} service ${expected ? 'enabled' : 'disabled'}`
		);
	};
	await toggleService('transcription', true);
	await toggleService('speech', true);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-service-url-transcription"]')) && Boolean(document.querySelector('[data-testid="provider-service-url-speech"]'))`,
		'per-service addresses shown'
	);
	// Switching a service back off removes its address again.
	await toggleService('image', true);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-service-url-image"]'))`,
		'image address shown while enabled'
	);
	await toggleService('image', false);
	await cdp.waitForExpression(
		`!document.querySelector('[data-testid="provider-service-url-image"]')`,
		'image address hidden once switched off'
	);
	await cdp.click(
		`document.querySelector('[data-testid="provider-verify"]')`,
		'verify MiniMax provider'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-save"]'))`,
		'MiniMax model choice'
	);
	await cdp.waitForExpression(
		`document.querySelector('[data-testid="provider-models-chat"]')?.textContent.includes('minimax-fixture-chat') && document.querySelector('[data-testid="provider-models-chat"] input')?.checked === true`,
		'MiniMax chat model picked'
	);
	await cdp.waitForExpression(
		`document.querySelector('[data-testid="provider-models-transcription"]')?.textContent.includes('asr-1.0') && document.querySelector('[data-testid="provider-models-transcription"] input')?.checked === true`,
		'MiniMax transcription preset picked'
	);
	assert.equal(
		await cdp.evaluate(
			`(() => {const boxes=[...document.querySelectorAll('[data-testid="provider-models-speech"] input[type="checkbox"]')];return boxes.length + ':' + boxes.every(b => b.checked);})()`
		),
		'8:true'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-models-image"]')) && document.querySelectorAll('[data-testid="provider-models-image"] input').length === 0 && document.querySelector('[data-testid="provider-models-image"]')?.textContent.includes('已关闭')`,
		'image listed as switched off'
	);
	await cdp.click(
		`document.querySelector('[data-testid="provider-save"]')`,
		'save MiniMax provider'
	);
	await cdp.waitForExpression(
		`!document.querySelector('[aria-labelledby="provider-wizard-title"]') && document.querySelector('#tab-connections')?.textContent.includes('MiniMax')`,
		'saved MiniMax provider'
	);
	const minimaxSaved = (await (await fetch(`${origin}/__fixture_provenance`)).json()).events
		.filter((event) => event.kind === 'provider-saved' && event.provider_id === 'minimax')
		.pop();
	assert.ok(minimaxSaved, 'MiniMax provider-saved event');
	assert.deepEqual([...(minimaxSaved?.services ?? [])].sort(), ['chat', 'speech', 'transcription']);
	const minimaxSelections = minimaxSaved?.model_selections ?? [];
	assert.equal(minimaxSelections.length, 10);
	// model_ids and model_selections must state the same model set, otherwise
	// the backend refuses the connection.
	assert.deepEqual(
		[...(minimaxSaved?.model_ids ?? [])].sort(),
		[...minimaxSelections.map((s) => s.upstream_id)].sort()
	);
	const minimaxChatSelection = minimaxSelections.find((s) => s.uses?.chat);
	assert.equal(minimaxChatSelection?.upstream_id, 'minimax-fixture-chat');
	assert.equal(minimaxChatSelection?.uses.chat, 'openai-chat');
	assert.equal(minimaxChatSelection?.source, 'provider');
	const minimaxTranscriptionSelection = minimaxSelections.find((s) => s.uses?.transcription);
	assert.equal(minimaxTranscriptionSelection?.upstream_id, 'asr-1.0');
	assert.equal(minimaxTranscriptionSelection?.uses.transcription, 'minimax-transcription');
	assert.equal(minimaxTranscriptionSelection?.source, 'preset');
	const minimaxSpeechSelections = minimaxSelections.filter((s) => s.uses?.speech);
	assert.equal(minimaxSpeechSelections.length, 8);
	assert.ok(
		minimaxSpeechSelections.every(
			(s) => s.uses.speech === 'minimax-speech' && s.source === 'preset'
		)
	);
	assert.ok(minimaxSelections.every((s) => !s.uses?.image));

	const providerList = '[data-testid="provider-list"]';
	const listCount = await cdp.evaluate(
		`document.querySelector(${JSON.stringify(providerList)})?.querySelectorAll('button').length`
	);
	assert.equal(listCount, 5);
	await cdp.click(
		`document.querySelector('[data-testid="provider-list"] button')`,
		'open provider detail'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-models"]'))`,
		'provider models detail'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('input[aria-label="启用 deepseek-fixture"]'))`,
		'enabled provider model'
	);
	await cdp.click(
		`document.querySelector('input[aria-label="启用 deepseek-fixture"]')`,
		'disable provider model'
	);
	await cdp.waitForExpression(
		`document.querySelector('input[aria-label="启用 deepseek-fixture"]')?.checked === false && document.querySelector('input[aria-label="启用 deepseek-fixture"]')?.disabled === false`,
		'provider disabled state'
	);
	await cdp.click(
		`document.querySelector('input[aria-label="启用 deepseek-fixture"]')`,
		'enable provider model'
	);
	await cdp.waitForExpression(
		`document.querySelector('input[aria-label="启用 deepseek-fixture"]')?.checked === true && document.querySelector('input[aria-label="启用 deepseek-fixture"]')?.disabled === false`,
		'provider enabled state'
	);
	const detailWidth = await cdp.evaluate(
		`document.querySelector('[data-testid="provider-models"]').getBoundingClientRect().right`
	);
	assert.ok(detailWidth <= 394, 'Provider detail must stay inside mobile viewport');
	await cdp.screenshot('provider-models-393x852.png');
	for (const dark of [false, true]) {
		await cdp.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`);
		for (const width of [393, 1256]) {
			await cdp.send('Emulation.setDeviceMetricsOverride', {
				width,
				height: 852,
				deviceScaleFactor: 1,
				mobile: width < 768
			});
			await sleep(200);
			const rect = await cdp.evaluate(
				`(() => {const r=document.querySelector('[data-testid="provider-models"]').getBoundingClientRect();return {left:r.left,right:r.right};})()`
			);
			assert.ok(
				rect.left >= 0 && rect.right <= width,
				'Provider model workspace stays inside viewport'
			);
			await cdp.screenshot(`provider-models-${dark ? 'dark' : 'light'}-${width}.png`);
		}
	}
	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 393,
		height: 852,
		deviceScaleFactor: 2,
		mobile: true
	});

	await cdp.click(
		`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '调用记录')`,
		'provider calls tab'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[aria-label="调用记录"]'))`,
		'provider calls empty state'
	);
	await cdp.click(
		`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '连接设置')`,
		'provider connection tab'
	);
	const accountLayout = await cdp.evaluate(
		`(() => { const row=document.querySelector('[data-testid="provider-account-row"]'); const r=row?.getBoundingClientRect(); return r ? {left:r.left,right:r.right} : null; })()`
	);
	assert.ok(accountLayout && accountLayout.left >= 0 && accountLayout.right <= 394);

	await cdp.screenshot('provider-accounts-393x852.png');

	// MiniMax voice interaction: fetch voices from the connection, pick one and
	// send a single speech test request against the resolved endpoint.
	await cdp.click(
		`document.querySelector('[data-testid="provider-mobile-tabs"] [role="tab"]:nth-child(1)')`,
		'back to provider list'
	);
	await cdp.click(
		`[...document.querySelectorAll('[data-testid="provider-list"] button')].find(b => b.textContent.includes('MiniMax'))`,
		'open MiniMax provider detail'
	);
	await cdp.click(
		`[...document.querySelectorAll('[role="tablist"][aria-label="提供商详情"] [role="tab"]')].find(b => b.textContent.trim() === '模型')`,
		'MiniMax models tab'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-test-speech"]'))`,
		'MiniMax speech test button'
	);
	await cdp.click(
		`document.querySelector('[data-testid="provider-test-speech"]')`,
		'open MiniMax speech test'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-test-fetch-voices"]'))`,
		'MiniMax speech test dialog'
	);
	await cdp.click(
		`document.querySelector('[data-testid="provider-test-fetch-voices"]')`,
		'fetch MiniMax voices'
	);
	await cdp.waitForExpression(
		`document.querySelectorAll('[data-testid="provider-test-voice-list"] option').length >= 3`,
		'MiniMax voice list loaded'
	);
	await cdp.evaluate(
		`(() => {const s=document.querySelector('[data-testid="provider-test-voice-list"]');s.value='female-shaonv';s.dispatchEvent(new Event('change',{bubbles:true}));})()`
	);
	await cdp.waitForExpression(
		`document.querySelector('[data-testid="provider-test-voice"]')?.value === 'female-shaonv'`,
		'MiniMax voice picked from list'
	);
	await cdp.click(
		`document.querySelector('[data-testid="provider-test-run"]')`,
		'run MiniMax speech test'
	);
	await cdp.waitForExpression(
		`document.querySelector('[data-testid="provider-test-result"]')?.textContent.includes('本次请求通过')`,
		'MiniMax speech test passed'
	);
	assert.equal(
		await cdp.evaluate(
			`document.querySelector('[data-testid="provider-test-result"]')?.textContent.includes('t2a_v2')`
		),
		true
	);
	assert.equal(await cdp.evaluate(`document.querySelector('[data-testid="provider-test-timeline"]')?.textContent.includes('120 ms')`), true);
	await cdp.waitForExpression(`document.querySelector('[data-testid="provider-test-timeline"] audio')?.readyState >= 2`, 'speech sample decoded');
	assert.equal(await cdp.evaluate(`(async () => { const audio=document.querySelector('[data-testid="provider-test-timeline"] audio'); audio.muted=true; await audio.play(); return !audio.error; })()`), true);
	const checkProviderDialogWidths = async (selector) => {
		for (const dark of [false, true]) {
			await cdp.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`);
			for (const width of [375, 393, 430, 1280]) {
				await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 852, deviceScaleFactor: 1, mobile: width < 500 });
				const bounds = await cdp.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && {left:r.left,right:r.right}; })()`);
				assert.ok(bounds && bounds.left >= -1 && bounds.right <= width + 1, `${selector} is clipped at ${width}: ${JSON.stringify(bounds)}`);
			}
		}
		await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
	};
	await checkProviderDialogWidths('[data-testid="provider-test-timeline"]');
	await cdp.click(
		`document.querySelector('[data-testid="provider-test-cancel"]')`,
		'close MiniMax speech test'
	);
	await cdp.waitForExpression(
		`!document.querySelector('[data-testid="provider-test-run"]')`,
		'MiniMax speech test dialog closed'
	);
	// K1-K2: a finished purpose test remains readable after switching views,
	// including the short 489x550 viewport; none of the three panes scroll sideways.
	for (const size of [{ width: 390, height: 844 }, { width: 489, height: 550 }]) {
		await cdp.send('Emulation.setDeviceMetricsOverride', {
			...size, deviceScaleFactor: 1, mobile: true
		});
		await cdp.click(`document.querySelector('[data-testid="provider-mobile-tabs"] [role="tab"]:nth-child(3)')`, 'show provider result');
		await cdp.waitForExpression(
			`document.querySelector('[data-testid="provider-result-card"]')?.textContent.includes('语音合成') && document.querySelector('[data-testid="provider-result-card"]')?.textContent.includes('成功')`,
			'completed MiniMax test in result card'
		);
		const resultGeometry = await cdp.evaluate(`(() => {
			const panel=document.querySelector('[data-testid="provider-results-panel"]');
			const tabs=document.querySelector('[data-testid="provider-mobile-tabs"]');
			const r=panel.getBoundingClientRect(); const t=tabs.getBoundingClientRect();
			return {panel:{left:r.left,right:r.right,top:r.top,scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth},tabs:{left:t.left,right:t.right,top:t.top,scrollWidth:tabs.scrollWidth,clientWidth:tabs.clientWidth}};
		})()`);
		assertHorizontalBounds('Provider result panel', resultGeometry.panel, size.width);
		assertHorizontalBounds('Provider navigation tabs', resultGeometry.tabs, size.width);
		assert.ok(resultGeometry.panel.scrollWidth <= resultGeometry.panel.clientWidth + 1, 'Result panel needs no horizontal scrolling');
		assert.ok(resultGeometry.tabs.scrollWidth <= resultGeometry.tabs.clientWidth + 1, 'Navigation needs no horizontal scrolling');
		assert.ok(resultGeometry.tabs.top < size.height && resultGeometry.panel.top < size.height, 'Result and tabs start inside viewport');
		await cdp.screenshot(`provider-result-${size.width}x${size.height}.png`);
		await cdp.click(`document.querySelector('[data-testid="provider-mobile-tabs"] [role="tab"]:nth-child(1)')`, 'switch to provider list');
		await cdp.click(`document.querySelector('[data-testid="provider-mobile-tabs"] [role="tab"]:nth-child(2)')`, 'return to provider detail');
		await cdp.click(`document.querySelector('[data-testid="provider-mobile-tabs"] [role="tab"]:nth-child(3)')`, 'return to retained result');
		assert.equal(await cdp.evaluate(`document.querySelector('[data-testid="provider-result-card"]')?.textContent.includes('语音合成')`), true);
	}
	await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
	await cdp.click(`document.querySelector('[data-testid="provider-mobile-tabs"] [role="tab"]:nth-child(2)')`, 'return to MiniMax model detail');
	const removedPreset = await fetch(`${origin}/api/v1/providers/connections/fixture-minimax-connection/models/asr-1.0`, { method: 'DELETE' });
	assert.equal(removedPreset.status, 200);
	await cdp.click(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '获取模型列表')`, 'refresh fixture after removing ASR preset');
	await cdp.waitForExpression(`document.querySelector('[data-testid="provider-result-card"]')?.textContent.includes('获取模型列表')`, 'fetch outcome visible in result card');
	await cdp.click(`document.querySelector('[data-testid="provider-mobile-tabs"] [role="tab"]:nth-child(2)')`, 'return to models after fetch');
	await cdp.waitForExpression(`!document.querySelector('[data-testid="provider-test-transcription"]')`, 'existing connection has no transcription model');
	await cdp.click(
		`[...document.querySelectorAll('[role="tablist"][aria-label="提供商详情"] [role="tab"]')].find(b => b.textContent.trim() === '服务')`,
		'MiniMax services'
	);
	await cdp.waitForExpression(`Boolean(document.querySelector('[data-testid="provider-service-transcription"] select[aria-label="选择官方预设模型 / Select an official preset"]'))`, 'official ASR preset choice');
	await cdp.evaluate(`(() => {const select=document.querySelector('[data-testid="provider-service-transcription"] select[aria-label="选择官方预设模型 / Select an official preset"]');select.value='asr-1.0';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
	await cdp.click(`[...document.querySelector('[data-testid="provider-service-transcription"]').querySelectorAll('button')].find(b => b.textContent.includes('添加并启用'))`, 'add ASR preset to existing connection');
	await waitForValue(async () => (await (await fetch(`${origin}/__fixture_provenance`)).json()).events,
		(events) => events.some((event) => event.kind === 'provider-models-added' && event.source === 'preset' && event.upstream_ids.includes('asr-1.0') && event.uses?.transcription === 'minimax-transcription'),
		'official ASR preset saved with purpose and source');
	await cdp.click(`document.querySelector('[data-testid="provider-new-voice-transcription"]')`, 'create separate ASR connection');
	await cdp.waitForExpression(`Boolean(document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="password"]'))`, 'voice-only key input');
	assert.equal(await cdp.evaluate(`(() => { const wizard=document.querySelector('[aria-labelledby="provider-wizard-title"]'); const chat=wizard.querySelector('[data-testid="provider-service-chat"] input'); const asr=wizard.querySelector('[data-testid="provider-service-transcription"] input'); return !chat.checked && chat.disabled && asr.checked && asr.disabled; })()`), true);
	await cdp.evaluate(`(() => {const input=document.querySelector('[aria-labelledby="provider-wizard-title"] input[type="password"]');input.value='separate-synthetic-media-key';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
	await cdp.click(`document.querySelector('[data-testid="provider-verify"]')`, 'choose voice model without chat catalog');
	await cdp.waitForExpression(`Boolean(document.querySelector('[data-testid="provider-models-transcription"] input[type="checkbox"]'))`, 'voice-only preset');
	await cdp.click(`document.querySelector('[data-testid="provider-models-transcription"] input[type="checkbox"]')`, 'select ASR preset');
	await cdp.click(`document.querySelector('[data-testid="provider-save"]')`, 'save separate ASR connection');
	await cdp.waitForExpression(`!document.querySelector('[aria-labelledby="provider-wizard-title"]')`, 'voice-only connection saved');
	const voiceOnlySaved = (await (await fetch(`${origin}/__fixture_provenance`)).json()).events.filter((event) => event.kind === 'provider-saved' && event.provider_id === 'minimax').at(-1);
	assert.deepEqual(voiceOnlySaved?.services, ['transcription']);
	assert.deepEqual(voiceOnlySaved?.model_ids, ['asr-1.0']);
	assert.equal(voiceOnlySaved?.visibility, 'private');
	assert.equal(voiceOnlySaved?.separate_key, true);
	assert.equal(await cdp.evaluate(`(async () => (await (await fetch('/api/v1/providers/connections')).json()).filter(c => c.provider_id === 'minimax').length)()`), 2);
	await cdp.click(
		`[...document.querySelectorAll('[role="tablist"][aria-label="提供商详情"] [role="tab"]')].find(b => b.textContent.trim() === '连接设置')`,
		'MiniMax connection settings'
	);
	await cdp.click(`document.querySelector('[data-testid="provider-remove"]')`, 'open removal confirmation');
	await cdp.waitForExpression(`Boolean(document.querySelector('[data-testid="provider-removal-dialog"]'))`, 'removal confirmation');
	await checkProviderDialogWidths('[data-testid="provider-removal-dialog"]');
	await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
	await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
	assert.equal(await cdp.evaluate(`Boolean(document.querySelector('[data-testid="provider-removal-dialog"]')?.contains(document.activeElement))`), true);
	await cdp.click(`document.querySelector('[data-testid="provider-removal-dialog"] button:not([data-testid])')`, 'cancel removal');
	assert.equal((await (await fetch(`${origin}/__fixture_provenance`)).json()).events.filter((event) => event.kind === 'provider-connection-removed').length, 0);
	await cdp.click(`document.querySelector('[data-testid="provider-remove"]')`, 'reopen removal confirmation');
	await cdp.click(`document.querySelector('[data-testid="provider-removal-confirm"]')`, 'confirm removal');
	await cdp.waitForExpression(`!document.querySelector('[data-testid="provider-removal-dialog"]')`, 'removal completed');
	assert.equal((await (await fetch(`${origin}/__fixture_provenance`)).json()).events.filter((event) => event.kind === 'provider-connection-removed').length, 1);
	await cdp.click(
		`document.querySelector('[data-testid="provider-mobile-tabs"] [role="tab"]:nth-child(1)')`,
		'back to provider list after voice test'
	);

	await cdp.click(
		`document.querySelector('button[aria-controls="tab-appearance"]')`,
		'restore appearance tab'
	);
	await cdp.waitForExpression(
		`Boolean(document.querySelector('#open-mist-appearance-editor'))`,
		'restored appearance settings'
	);
	return {
		independentOfDirectConnections: true,
		keyClearedOnProviderChange: true,
		upstreamModelIds: true,
		privateConnectionSaved: true,
		chatgptBrowserLoginWithoutHelper: true,
		chatgptCancelAndInvalidCallback: true,
		kimiDeviceCode: true,
		kimiCancelAndDenied: true,
		kimiConnected: true,
		minimaxPerServiceWizard: true,
		minimaxVoiceInteraction: true,
		responsiveProviderDetail: true,
		providerModelEnableToggle: true,
		providerCallsTab: true
	};
}

async function catalogWarning(cdp) {
	// A8: the model selector names the failing connection, keeps the long
	// explanation in the details and offers a reachable way into the
	// connection. The warning must not push the search field or the model
	// actions out of the viewport.
	const sizes = [
		{ name: '390x844', width: 390, height: 844 },
		{ name: '489x550', width: 489, height: 550 },
		{ name: '1280x800', width: 1280, height: 800 }
	];
	const measured = {};
	for (const size of sizes) {
		await cdp.send('Emulation.setDeviceMetricsOverride', {
			width: size.width,
			height: size.height,
			deviceScaleFactor: 1,
			mobile: size.width < 768
		});
		await sleep(300);
		for (const dark of [false, true]) {
			await cdp.evaluate(`document.documentElement.classList.toggle('dark', ${dark})`);
			await cdp.click(`document.querySelector('button[id^="model-selector-"]')`, 'model selector');
			await cdp.waitForExpression(
				`Boolean(document.querySelector('[data-testid="provider-catalog-warnings"]'))`,
				'catalog warning'
			);
			const state = await cdp.evaluate(`
				(() => {
					const rect = (element) => {
						const box = element?.getBoundingClientRect();
						return box
							? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }
							: null;
					};
					const warning = document.querySelector('[data-testid="provider-catalog-warnings"]');
					const action = document.querySelector('[data-testid="provider-catalog-open-connection"]');
					return {
						text: warning?.textContent ?? '',
						warning: rect(warning),
						action: rect(action),
						actionText: action?.textContent ?? '',
						search: rect(document.querySelector('#model-search-input')),
						viewport: { width: innerWidth, height: innerHeight }
					};
				})()
			`);
			assert.match(state.text, /SiliconFlow/);
			assert.match(state.text, /获取模型列表时地址被本地安全策略拦截/);
			// The long deployment explanation stays in the connection details.
			assert.doesNotMatch(state.text, /请检查地址解析结果与代理配置/);
			assert.ok(state.action && state.action.width >= 1, 'the warning offers an action');
			assert.ok(
				state.action.right <= state.viewport.width + 1,
				`the warning action stays inside the viewport: ${JSON.stringify(state)}`
			);
			assert.ok(
				state.search && state.search.bottom <= size.height + 1,
				`the search field stays inside the viewport: ${JSON.stringify(state)}`
			);
			await cdp.screenshot(`catalog-warning-${dark ? 'dark' : 'light'}-${size.name}.png`);
			await cdp.send('Input.dispatchKeyEvent', {
				type: 'keyDown',
				key: 'Escape',
				code: 'Escape',
				windowsVirtualKeyCode: 27
			});
			await sleep(250);
		}
		measured[size.name] = true;
	}

	// The action is reachable with the keyboard alone and lands on the
	// connection that failed.
	await cdp.send('Emulation.setDeviceMetricsOverride', {
		width: 390,
		height: 844,
		deviceScaleFactor: 1,
		mobile: true
	});
	await sleep(300);
	await cdp.click(`document.querySelector('button[id^="model-selector-"]')`, 'model selector');
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-catalog-open-connection"]'))`,
		'catalog warning action'
	);
	await cdp.evaluate(`
		(() => {
			const action = document.querySelector('[data-testid="provider-catalog-open-connection"]');
			action?.focus();
			return document.activeElement === action;
		})()
	`);
	// A key event with its text activates the focused button; a keydown
	// without text does not.
	await cdp.send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'Enter',
		code: 'Enter',
		windowsVirtualKeyCode: 13,
		nativeVirtualKeyCode: 13,
		text: '\r',
		unmodifiedText: '\r'
	});
	await cdp.send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'Enter',
		code: 'Enter',
		windowsVirtualKeyCode: 13,
		nativeVirtualKeyCode: 13
	});
	await cdp.waitForExpression(
		`Boolean(document.querySelector('[data-testid="provider-connection-error"]'))`,
		'the failing connection in the connection settings'
	);
	const focused = await cdp.evaluate(`
		(() => {
			const banner = document.querySelector('[data-testid="provider-connection-error"]');
			return {
				text: banner?.textContent ?? '',
				action: banner?.querySelector('[data-testid="provider-recovery-action"]')?.textContent ?? ''
			};
		})()
	`);
	assert.match(focused.text, /SiliconFlow|获取模型列表时地址被本地安全策略拦截/);
	assert.ok(focused.action.length > 0, 'the connection offers a recovery action');
	await cdp.screenshot('catalog-warning-connection-details.png');

	// Leave the settings the way the next scenario expects to find them: the
	// escape closes the model list, the back button closes the settings.
	await cdp.send('Input.dispatchKeyEvent', {
		type: 'keyDown',
		key: 'Escape',
		code: 'Escape',
		windowsVirtualKeyCode: 27,
		nativeVirtualKeyCode: 27
	});
	await cdp.send('Input.dispatchKeyEvent', {
		type: 'keyUp',
		key: 'Escape',
		code: 'Escape',
		windowsVirtualKeyCode: 27,
		nativeVirtualKeyCode: 27
	});
	await sleep(300);
	await cdp.click(`document.querySelector('#settings-tabs-container button')`, 'settings back');
	await cdp.waitForExpression(
		`!document.querySelector('.settings-content-scroll')`,
		'the connection settings are closed again'
	);
	return {
		perConnectionReason: true,
		longExplanationInDetails: true,
		reachableAction: true,
		keyboardReachable: true,
		viewports: Object.keys(measured)
	};
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

async function verifyChineseFonts(cdp) {
	await cdp.send('DOM.enable');
	await cdp.send('CSS.enable');
	await cdp.evaluate(`(async () => {
		const probe = document.createElement('span');
		probe.id = 'mobile-smoke-chinese-font-probe';
		probe.textContent = '中文连接账号设置';
		probe.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;font-family:inherit';
		document.body.append(probe);
		await document.fonts.ready;
	})()`);
	try {
		const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
		const { nodeId } = await cdp.send('DOM.querySelector', {
			nodeId: root.nodeId,
			selector: '#mobile-smoke-chinese-font-probe'
		});
		const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
		assert.ok(
			fonts.some((font) => font.glyphCount > 0),
			'Chinese text must use a rendered font'
		);
		if (process.env.MOBILE_SMOKE_CJK_FONT_PATTERN) {
			const expected = new RegExp(process.env.MOBILE_SMOKE_CJK_FONT_PATTERN);
			assert.ok(
				fonts.some((font) => expected.test(font.familyName) && font.glyphCount >= 8),
				`Chinese text must use the prepared CJK font; actual=${JSON.stringify(fonts)}`
			);
		}
		return fonts;
	} finally {
		await cdp.evaluate("document.querySelector('#mobile-smoke-chinese-font-probe')?.remove()");
	}
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
				// Establish the synthetic session before app hydration can capture an empty token.
				if (location.origin === ${JSON.stringify(origin)}) localStorage.setItem('token', 'fixture-token');
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

		await client.navigate(
			origin,
			"document.readyState === 'complete' && document.querySelector('.owui-mist-app')"
		);
		await client.navigate(
			chatUrl,
			"document.readyState === 'complete' && document.querySelector('.owui-mist-app')"
		);
		await dismissUpdateDialog(client);

		const results = {
			sourceCommit: fixture.sourceCommit,
			chineseFonts: await verifyChineseFonts(client),
			viewports: {}
		};
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
			await client.waitForExpression(
				"(() => {const a=document.querySelector('[data-testid=page-chrome-controls]')?.getBoundingClientRect();const b=document.querySelector('#message-input-container')?.getBoundingClientRect();return a && b && (a.right<=b.left || a.left>=b.right || a.bottom<=b.top || a.top>=b.bottom);})()",
				'layout control clears the composer'
			);
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
		results.catalogWarning = await catalogWarning(client);
		await openSettings(client);
		results.providers = await providerSettings(client);
		results.settings = await settingsGeometry(client, 393, 852);
		await client.screenshot('appearance-editor-393x852.png');

		results.desktop = {};
		const savedAppearance = await client.evaluate(
			"localStorage.getItem('owui-appearance:v3:' + location.origin)"
		);
		for (const width of [1280, 1440, 1920]) {
			for (const sidebar of [false, true]) {
				for (const wallpaper of [false, true]) {
					await client.send('Emulation.setDeviceMetricsOverride', {
						width,
						height: 1000,
						deviceScaleFactor: 1,
						mobile: false
					});
					await client.evaluate(
						`localStorage.sidebar='${sidebar}';localStorage.sidebarWidth='300'`
					);
					await client.evaluate(
						`(() => { const key='owui-appearance:v3:' + location.origin; const appearance=JSON.parse(${JSON.stringify(savedAppearance)}); appearance.enabled=${wallpaper}; localStorage.setItem(key,JSON.stringify(appearance)); })()`
					);
					await client.navigate(
						chatUrl,
						"document.querySelector('.owui-messages') && document.querySelector('#message-input-container')"
					);
					await sleep(500);
					results.desktop[`${width}-${sidebar}-${wallpaper}`] = await chatGeometry(client, width);
					await client.evaluate(
						"document.documentElement.style.setProperty('--owui-assistant-width','720px'); document.documentElement.style.setProperty('--owui-composer-width','700px');"
					);
					await sleep(50);
					results.desktop[`${width}-${sidebar}-${wallpaper}-custom`] = await chatGeometry(
						client,
						width
					);
				}
			}
		}
		await client.screenshot('chat-desktop-centered.png');

		await client.navigate(
			`${origin}/workspace/models`,
			'document.querySelector(\'a[aria-current=page][href="/workspace/models"]\')'
		);
		for (const dark of [false, true]) {
			await client.evaluate(
				`(() => {const key='owui-appearance:v3:' + location.origin;const value=JSON.parse(localStorage.getItem(key));value.theme='${dark ? 'dark' : 'light'}';const serialized=JSON.stringify(value);localStorage.setItem(key,serialized);window.dispatchEvent(new StorageEvent('storage',{key,newValue:serialized,storageArea:localStorage}));})()`
			);
			await sleep(300); // Let the appearance provider update theme classes and color tokens together.
			const tabs = await client.evaluate(
				`(() => {const ctx=document.createElement('canvas').getContext('2d'); return Array.from(document.querySelectorAll('a[href^="/workspace/"]')).filter(e=>e.closest('nav')).map(e=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=getComputedStyle(e).color;ctx.fillRect(0,0,1,1);return {color:getComputedStyle(e).color,rgb:Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3),active:e.getAttribute('aria-current')};});})()`
			);
			assert.ok(tabs.length >= 3, 'workspace tabs are present');
			for (const tab of tabs) {
				const rgb = tab.rgb;
				const luminance = rgb
					.map((v) => {
						v /= 255;
						return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
					})
					.reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
				assert.ok(
					dark ? (luminance + 0.05) / 0.06 >= 4.5 : 1.05 / (luminance + 0.05) >= 4.5,
					`workspace tab contrast (${dark ? 'dark' : 'light'}): ${tab.color}; sRGB=${tab.rgb}`
				);
			}
			await client.screenshot(`workspace-tabs-${dark ? 'dark' : 'light'}.png`);
		}

		// Collapsed chrome remains reversible and note reading never writes data.
		await client.navigate(
			`${origin}/workspace/knowledge`,
			"document.querySelector('#workspace-container')?.textContent.includes('课堂资料')"
		);

		for (const dark of [false, true]) {
			await client.evaluate(
				`(() => {const key='owui-appearance:v3:'+location.origin;const v=JSON.parse(localStorage.getItem(key));v.theme='${dark ? 'dark' : 'light'}';v.enabled=true;localStorage.setItem(key,JSON.stringify(v));window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(v),storageArea:localStorage}));})()`
			);
			await sleep(300);
			const surface = await client.evaluate(
				`(() => {const e=document.querySelector('#workspace-container');const c=getComputedStyle(e);return {background:c.backgroundColor,shadow:c.textShadow,color:c.color};})()`
			);
			assert.ok(
				surface.background === 'rgba(0, 0, 0, 0)' || surface.background === 'transparent',
				'workspace must keep the wallpaper visible'
			);
			assert.notEqual(surface.shadow, 'none', 'text has local contrast protection');
			await client.screenshot(`knowledge-wallpaper-${dark ? 'dark' : 'light'}.png`);
		}
		await client.screenshot('knowledge-reading-surface.png');
		await client.click(
			"document.querySelector('[data-testid=page-chrome-controls] > button')",
			'page layout controls'
		);
		await client.click(
			"[...document.querySelectorAll('.chrome-menu button')].find(e=>e.textContent.includes('收起顶部栏'))",
			'collapse top toolbar'
		);
		assert.ok(await client.evaluate("document.documentElement.hasAttribute('data-topbar-hidden')"));
		await client.click(
			"[...document.querySelectorAll('.chrome-menu button')].find(e=>e.textContent.includes('收起侧边导航'))",
			'collapse side navigation'
		);
		await sleep(350);
		assert.ok(
			await client.evaluate(
				"document.querySelector('#main-content > div').getBoundingClientRect().left < 2"
			),
			'hidden navigation releases content width'
		);
		await client.click(
			"[...document.querySelectorAll('.chrome-menu button')].find(e=>e.textContent.includes('恢复页面布局'))",
			'restore all navigation'
		);

		results.knowledgeImport = {};
		for (const viewport of [
			{ name: '390x844', width: 390, height: 844 },
			{ name: '489x550', width: 489, height: 550 }
		]) {
			results.knowledgeImport[viewport.name] = await knowledgeImportFlow(client, viewport, {
				refresh: viewport.name === '390x844'
			});
		}
		results.knowledgeImport['489x550-cancelled'] = await knowledgeImportFlow(
			client,
			{ name: '489x550-cancelled', width: 489, height: 550 },
			{ cancel: true }
		);

		await client.send('Emulation.setScrollbarsHidden', { hidden: false });
		await client.navigate(
			`${origin}/workspace/knowledge/reading-kb`,
			"document.querySelector('#collection-container')?.textContent.includes('阅读验收.pdf')"
		);
		await client.click(
			"[...document.querySelectorAll('#collection-container button')].find(e=>e.textContent.includes('阅读验收.pdf'))",
			'open synthetic PDF'
		);
		await client.waitForExpression("document.querySelector('.file-reader canvas')", 'PDF rendered');
		await client.click(
			"document.querySelector('.file-reader button[aria-label=全屏阅读]')",
			'expand PDF reader'
		);
		await client.waitForExpression(
			"document.querySelector('.reader-expanded')?.getBoundingClientRect().width === innerWidth",
			'PDF fills the viewport'
		);
		await client.waitForExpression(
			"document.querySelector('.reader-expanded canvas')?.getBoundingClientRect().width > innerWidth * .85",
			'PDF adapts to expanded width'
		);
		await sleep(750);
		await client.evaluate(
			"window.__stablePdfCanvas=document.querySelector('.reader-expanded canvas')"
		);
		await sleep(750);
		assert.ok(
			await client.evaluate(
				"window.__stablePdfCanvas === document.querySelector('.reader-expanded canvas')"
			),
			'visible scrollbars do not repeatedly recreate PDF canvases'
		);
		await client.screenshot('knowledge-pdf-fullscreen.png');
		await client.send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			key: 'Escape',
			code: 'Escape',
			windowsVirtualKeyCode: 27
		});
		await client.waitForExpression(
			"!document.querySelector('.reader-expanded') && !document.querySelector('.owui-mist-app').inert",
			'PDF exits fullscreen'
		);
		assert.equal(
			(await (await fetch(`${origin}/__fixture_provenance`)).json()).events.filter(
				(e) => e.kind === 'reading-pdf-load'
			).length,
			1,
			'fullscreen keeps the loaded PDF'
		);
		await client.send('Emulation.setScrollbarsHidden', { hidden: true });
		await client.navigate(`${origin}/notes`, "document.querySelector('#notes-container')");
		const notesSurface = await client.evaluate(
			"getComputedStyle(document.querySelector('#notes-container')).backgroundColor"
		);
		const notesSurfaceAlpha = /rgba?\([^)]*[,/]\s*([0-9.]+)\)$/.exec(notesSurface);
		assert.ok(
			notesSurface !== 'rgba(0, 0, 0, 0)' &&
				(!notesSurfaceAlpha || Number(notesSurfaceAlpha[1]) >= 0.9),
			`Notes text needs a readable surface over wallpaper: ${notesSurface}`
		);
		await client.screenshot('notes-reading-surface.png');
		await client.navigate(
			`${origin}/notes/reading-note`,
			"Boolean(document.querySelector('#note-editor h2'))"
		);
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: 393,
			height: 852,
			deviceScaleFactor: 2,
			mobile: true
		});
		await client.click(
			"document.querySelector('button[aria-label=笔记目录]')",
			'open heading outline'
		);
		await client.waitForExpression(
			"document.querySelectorAll('.outline-popover > button').length === 2",
			'outline headings'
		);
		assert.ok(
			await client.evaluate(
				"(() => {const r=document.querySelector('.outline-popover').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;})()"
			),
			'mobile outline stays inside the viewport'
		);
		await client.screenshot('note-outline-mobile.png');
		await client.click(
			"[...document.querySelectorAll('.outline-popover > button')].find(e=>e.textContent.includes('重点回顾'))",
			'jump to second heading'
		);
		await client.waitForExpression(
			"(() => {const r=document.querySelector('#note-editor h2').getBoundingClientRect();return r.top >= 0 && r.bottom <= innerHeight;})()",
			'outline brings the selected heading fully into view'
		);
		await client.click(
			"[...document.querySelectorAll('#note-editor button')].find(e=>e.textContent.trim()==='全屏阅读')",
			'expand note'
		);
		assert.ok(
			await client.evaluate(
				"document.querySelector('.note-expanded')?.getBoundingClientRect().left === 0 && document.querySelector('.owui-mist-app').inert"
			),
			'reader expands without remounting the editor'
		);
		await client.screenshot('note-fullscreen-outline.png');
		await client.send('Input.dispatchKeyEvent', {
			type: 'keyDown',
			key: 'Escape',
			code: 'Escape',
			windowsVirtualKeyCode: 27
		});
		await client.waitForExpression(
			"!document.querySelector('.note-expanded') && !document.querySelector('.owui-mist-app').inert",
			'escape restores page'
		);
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: 393,
			height: 852,
			deviceScaleFactor: 2,
			mobile: true
		});
		await client.navigate(
			`${origin}/notes/recordings?id=recording-fixture`,
			"document.querySelector('.recordings-page textarea')"
		);
		await client.waitForExpression(
			"document.querySelector('.recordings-page textarea').value.includes('老师讲课')",
			'transcript note'
		);
		const selectedRecordingModel = await client.waitForExpression(
			`document.querySelector('select[aria-labelledby="recording-model-label"]')?.value`,
			'preloaded transcription model'
		);
		assert.equal(selectedRecordingModel, 'provider:fixture-provider-connection:asr-fixture');
		await client.waitForExpression(
			"document.querySelector('[data-testid=recording-poll-warning]')",
			'transient task status warning'
		);
		assert.equal(
			await client.evaluate("document.querySelectorAll('.recordings-page [role=alert]').length"),
			0
		);
		await client.waitForExpression(
			"!document.querySelector('[data-testid=recording-poll-warning]')",
			'automatic task status recovery'
		);
		assert.ok(
			await client.evaluate(
				"document.querySelector('.recordings-page textarea').value.includes('老师讲课')"
			)
		);

		const recordingSurface = await client.evaluate(`(() => {
   const style=getComputedStyle(document.querySelector('.recordings-surface'));
   return {background:style.backgroundColor,color:style.color};
  })()`);
		const surfaceAlpha = /rgba?\([^)]*[,/]\s*([0-9.]+)\)$/.exec(recordingSurface.background);
		assert.ok(
			recordingSurface.background !== 'transparent' &&
				(!surfaceAlpha || Number(surfaceAlpha[1]) >= 0.9),
			`Recording text needs an opaque reading surface over wallpaper: ${JSON.stringify(recordingSurface)}`
		);
		await client.screenshot('recording-workspace-393x852.png');
		// Theme, filter and deletion semantics must remain visible at every width.
		for (const dark of [false, true]) {
			await client.evaluate(
				`(() => {const key='owui-appearance:v3:' + location.origin;const value=JSON.parse(localStorage.getItem(key));value.theme='${dark ? 'dark' : 'light'}';const serialized=JSON.stringify(value);localStorage.setItem(key,serialized);window.dispatchEvent(new StorageEvent('storage',{key,newValue:serialized,storageArea:localStorage}));})()`
			);
			await sleep(300); // Let the appearance provider update theme classes and color tokens together.
			for (const width of [393, 1256]) {
				await client.send('Emulation.setDeviceMetricsOverride', {
					width,
					height: 900,
					deviceScaleFactor: 1,
					mobile: width < 600
				});
				await sleep(100);
				assert.ok(
					await client.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),
					'Recording workspace must not overflow'
				);
				await client.screenshot(`recording-redesign-${dark ? 'dark' : 'light'}-${width}.png`);
			}
		}
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: 393,
			height: 852,
			deviceScaleFactor: 2,
			mobile: true
		});
		await client.evaluate(
			`(() => {const e=document.querySelector('select[aria-label="筛选录音任务"]');e.value='audio';e.dispatchEvent(new Event('change',{bubbles:true}));})()`
		);
		await client.waitForExpression(
			"document.querySelectorAll('.task').length === 0",
			'audio filter excludes deleted originals'
		);
		await client.evaluate(
			`(() => {const e=document.querySelector('select[aria-label="筛选录音任务"]');e.value='removed';e.dispatchEvent(new Event('change',{bubbles:true}));})()`
		);
		await client.waitForExpression(
			"document.querySelector('.task .audio-removed')",
			'deleted audio remains a clearly labelled task'
		);
		await client.evaluate(
			`(() => {const e=document.querySelector('select[aria-label="筛选录音任务"]');e.value='all';e.dispatchEvent(new Event('change',{bubbles:true}));})()`
		);

		// LAN HTTP pages may expose getRandomValues but not randomUUID.
		await client.evaluate(
			"Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })"
		);
		await client.evaluate(
			`(() => {const input=document.querySelector('#recording-file');const transfer=new DataTransfer();transfer.items.add(new File(['fixture audio'],'class.wav',{type:'audio/wav'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`
		);
		await client.click(
			`[...document.querySelectorAll('.recordings-page button')].find(b=>b.textContent.trim()==='开始转写')`,
			'upload recording'
		);
		const recordingEvents = await waitForValue(
			async () => (await (await fetch(`${origin}/__fixture_provenance`)).json()).events,
			(events) =>
				events.some((e) => e.kind === 'recording-action' && e.path === '/api/v1/recordings'),
			'recording upload'
		);
		assert.equal(
			recordingEvents.find((e) => e.kind === 'recording-action' && e.path === '/api/v1/recordings')
				?.payload?.model_ref,
			selectedRecordingModel
		);
		await client.waitForExpression(
			"!document.querySelector('#recording-file').disabled",
			'upload completed'
		);
		await client.evaluate(
			`(() => {const e=document.querySelector('.recordings-page textarea');e.value='修改后的课堂原文';e.dispatchEvent(new Event('input',{bubbles:true}));})()`
		);
		await client.click(
			`[...document.querySelectorAll('.recordings-page button')].find(b=>b.textContent.trim()==='保存' && !b.disabled)`,
			'save transcript'
		);
		await client.waitForExpression(
			"document.querySelector('.recordings-page textarea').value==='修改后的课堂原文'",
			'edited transcript'
		);
		await client.evaluate(
			`(() => {const e=document.querySelector('select[aria-label="文字模型"]');e.value='fixture-model';e.dispatchEvent(new Event('change',{bubbles:true}));})()`
		);
		await client.click(
			`[...document.querySelectorAll('.recordings-page button')].find(b=>['Generate','生成'].includes(b.textContent.trim()))`,
			'generate class notes'
		);
		await client.waitForExpression(
			"document.querySelector('.recordings-page [role=alert]')?.textContent.includes('Synthetic summary failure')",
			'summary failure is visible'
		);
		assert.equal(
			await client.evaluate("document.querySelector('.recordings-page textarea').value"),
			'修改后的课堂原文'
		);
		await client.click(
			`[...document.querySelectorAll('.recordings-page button')].find(b=>['Generate','生成'].includes(b.textContent.trim()))`,
			'retry summary without overwriting transcript'
		);
		await client.waitForExpression(
			"document.querySelector('.recordings-page textarea').value==='课堂知识点整理'",
			'separate summary note'
		);
		await client.evaluate(
			`(() => {const e=document.querySelector('select[aria-label="知识库"]');e.value='recording-kb';e.dispatchEvent(new Event('change',{bubbles:true}));})()`
		);
		const syncButton = `document.querySelector('[data-testid=knowledge-sync]')`;
		await client.click(syncButton, 'save knowledge snapshot');
		await waitForValue(
			async () => (await (await fetch(`${origin}/__fixture_provenance`)).json()).events,
			(events) =>
				events.some((e) => e.kind === 'recording-action' && e.path?.endsWith('/file/add')),
			'knowledge snapshot add'
		);
		await client.waitForExpression(
			`(${syncButton}).textContent.includes('知识库副本已是最新')`,
			'knowledge action complete'
		);
		assert.equal(await client.evaluate(`(${syncButton}).disabled`), true);
		await client.evaluate(
			`(() => {const e=document.querySelector('.recordings-page textarea');e.value+=String.fromCharCode(10)+'新增课堂重点';e.dispatchEvent(new Event('input',{bubbles:true}));})()`
		);
		await client.waitForExpression(
			`!(${syncButton}).disabled`,
			'edited document can update knowledge'
		);
		await client.click(syncButton, 'update knowledge snapshot');
		await client.waitForExpression(
			"document.querySelector('.recordings-page [role=alert]')?.textContent.includes('Synthetic knowledge update failure')",
			'knowledge failure preserves note'
		);
		assert.ok(
			await client.evaluate(
				"document.querySelector('.recordings-page textarea').value.includes('新增课堂重点')"
			)
		);
		await client.click(syncButton, 'retry knowledge update');
		await waitForValue(
			async () => (await (await fetch(`${origin}/__fixture_provenance`)).json()).events,
			(events) =>
				events.some((e) => e.kind === 'recording-action' && e.path?.endsWith('/file/update')),
			'knowledge snapshot update'
		);
		await client.waitForExpression(
			`(${syncButton}).textContent.includes('知识库副本已是最新')`,
			'knowledge retry completed'
		);
		await client.screenshot('recording-documents-393x852.png');
		await fetch(`${origin}/__fixture_missing_recording_note`, { method: 'POST' });
		await client.navigate(
			`${origin}/notes/recordings?id=recording-fixture`,
			"document.querySelector('[data-testid=recording-note-missing]')"
		);
		const missingCount = async () =>
			(await (await fetch(`${origin}/__fixture_provenance`)).json()).events.filter(
				(e) => e.kind === 'missing-recording-note'
			).length;
		const initialMissingCount = await missingCount();
		await sleep(4500);
		assert.equal(
			await missingCount(),
			initialMissingCount,
			'Missing notes must not be fetched on each status poll'
		);
		assert.equal(
			await client.evaluate(
				"document.querySelectorAll('.recordings-page [role=alert], [data-testid=recording-poll-warning]').length"
			),
			0
		);
		await client.click(
			"document.querySelector('[data-testid=remove-recording-task]')",
			'remove synthetic task'
		);
		await client.click(
			"document.querySelector('[data-testid=confirm-remove-recording-task]')",
			'confirm synthetic task removal'
		);
		await client.waitForExpression(
			"!document.querySelector('[data-testid=remove-recording-task]')",
			'task record removed'
		);
		const retainedSummary = await (await fetch(`${origin}/api/v1/notes/recording-summary`)).json();
		assert.ok(retainedSummary.data.content.md.includes('新增课堂重点'));
		results.recordings = {
			readingSurface: recordingSurface,
			editableTranscript: true,
			separateSummary: true,
			knowledgeAddAndUpdate: true,
			submittedModelRef: selectedRecordingModel
		};

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
				catalogWarning: results.catalogWarning,
				knowledgeImport: Object.keys(results.knowledgeImport),
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
			console.warn(
				`Could not remove Chromium profile ${userDataDirectory}: ${removeError.message}`
			);
		}
	}
}

await main();
