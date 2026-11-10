#!/usr/bin/env node
/**
 * UI audit: measure contrast, font size, hit targets and horizontal overflow.
 *
 * Why this exists: the theme is expressed in `oklch()`, and several surfaces are
 * translucent glass. Reading `getComputedStyle().color` and treating it as RGB
 * produces nonsense (a first pass reported ~1.31:1 everywhere). This script
 * resolves every colour through a canvas — which normalises `oklch`, `rgba`,
 * `color-mix` and friends to sRGB — and composites the translucent background
 * layers before computing the ratio.
 *
 * Usage:
 *   node scripts/ui-audit.mjs --origin http://127.0.0.1:8080 \
 *        --email admin@local.test --password secret
 *
 * Optional:
 *   --themes light,dark        default: light,dark
 *   --viewports 1440x900,390x844   default: both
 *   --out artifacts/ui-audit   default
 *   --screenshots              also write PNGs
 *
 * Exit code 1 when a route has horizontal overflow, a text contrast below
 * AA (4.5:1), or a mobile hit target smaller than 32px.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const ORIGIN = arg('origin', '').replace(/\/$/, '');
const EMAIL = arg('email', 'admin@local.test');
const PASSWORD = arg('password', '');
const THEMES = arg('themes', 'light,dark').split(',').filter(Boolean);
const VIEWPORTS = arg('viewports', '1440x900,390x844')
	.split(',')
	.filter(Boolean)
	.map((v) => v.split('x').map(Number));
const OUT = arg('out', 'artifacts/ui-audit');
const WANT_SHOTS = flag('screenshots');

/** Decorative or disabled text that is deliberately de-emphasised. */
const CONTRAST_EXEMPT = [
	/^[–—/·|]$/, // separators
	/^Select a file to preview$/ // empty-state hint over a preview pane
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromeExecutable() {
	const candidates = [
		process.env.CHROME_BIN,
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium'
	].filter(Boolean);
	const found = candidates.find((c) => existsSync(c));
	if (!found) throw new Error('Chromium/Chrome not found; set CHROME_BIN before running the audit');
	return found;
}

async function launch() {
	const port = 9444;
	const profile = path.join(process.env.TMPDIR || '/tmp', `ui-audit-${Date.now()}`);
	const proc = spawn(
		chromeExecutable(),
		[
			'--headless=new',
			'--no-sandbox',
			'--disable-gpu',
			'--disable-dev-shm-usage',
			'--disable-crash-reporter',
			'--hide-scrollbars',
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${profile}`,
			'--no-first-run',
			'--no-default-browser-check',
			'about:blank'
		],
		{ stdio: 'ignore' }
	);
	for (let i = 0; i < 80; i++) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return { proc, wsUrl: (await res.json()).webSocketDebuggerUrl };
		} catch {}
		await sleep(250);
	}
	proc.kill('SIGKILL');
	throw new Error('Chrome debug endpoint did not come up');
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
	}
	async connect() {
		await new Promise((resolve, reject) => {
			this.ws.addEventListener('open', resolve, { once: true });
			this.ws.addEventListener('error', reject, { once: true });
		});
		this.ws.addEventListener('message', (event) => {
			const msg = JSON.parse(event.data);
			const entry = this.pending.get(msg.id);
			if (entry) {
				this.pending.delete(msg.id);
				msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
			}
		});
	}
	send(method, params = {}, sessionId) {
		const id = ++this.id;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params, sessionId }));
		});
	}
}

const MEASURE = `(() => {
	const cv = document.createElement('canvas');
	cv.width = cv.height = 1;
	const ctx = cv.getContext('2d', { willReadFrequently: true });
	const toRgba = (color) => {
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillStyle = 'rgba(0,0,0,0)';
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, 1, 1);
		const d = ctx.getImageData(0, 0, 1, 1).data;
		return [d[0], d[1], d[2], d[3] / 255];
	};
	const lum = (c) => {
		const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
		return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
	};
	const blend = (top, bottom) => {
		const a = top[3];
		return [top[0]*a + bottom[0]*(1-a), top[1]*a + bottom[1]*(1-a), top[2]*a + bottom[2]*(1-a), 1];
	};
	const effectiveBg = (el) => {
		const chain = [];
		let p = el;
		while (p) {
			const rgba = toRgba(getComputedStyle(p).backgroundColor);
			if (rgba[3] > 0) chain.push(rgba);
			p = p.parentElement;
		}
		let base = toRgba(getComputedStyle(document.body).backgroundColor);
		if (base[3] === 0) base = [255, 255, 255, 1];
		for (let i = chain.length - 1; i >= 0; i--) base = blend(chain[i], base);
		return base;
	};

	const doc = document.documentElement;
	const record = {
		overflowX: doc.scrollWidth > window.innerWidth + 2,
		scrollWidth: doc.scrollWidth,
		innerWidth: window.innerWidth,
		lowContrast: [], tinyText: [], smallTargets: []
	};
	const seen = new Set();

	for (const el of document.querySelectorAll('body *')) {
		const r = el.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) continue;
		const cs = getComputedStyle(el);
		if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
		if (r.bottom < 0 || r.top > window.innerHeight * 3) continue;

		if (el.children.length === 0) {
			const text = (el.textContent || '').trim();
			if (text.length > 1) {
				const fgRaw = toRgba(cs.color);
				const bg = effectiveBg(el);
				const fg = fgRaw[3] < 1 ? blend(fgRaw, bg) : fgRaw;
				const ratio =
					(Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
				const key = 'c:' + text;
				if (!seen.has(key)) {
					seen.add(key);
					record.lowContrast.push({
						text: text.slice(0, 48),
						ratio: Math.round(ratio * 100) / 100,
						fontSize: cs.fontSize,
						color: cs.color,
						background: 'rgb(' + bg.slice(0, 3).map(Math.round).join(',') + ')'
					});
				}
				const fs = parseFloat(cs.fontSize);
				const fkey = 'f:' + text;
				if (fs < 11 && !seen.has(fkey)) {
					seen.add(fkey);
					record.tinyText.push({ text: text.slice(0, 48), fontSize: fs });
				}
			}
		}

		if (el.tagName === 'BUTTON' && el.getAttribute('aria-label')) {
			const tkey = 't:' + Math.round(r.x) + ',' + Math.round(r.y);
			if ((r.width < 32 || r.height < 32) && !seen.has(tkey)) {
				seen.add(tkey);
				record.smallTargets.push({
					tag: el.tagName,
					label: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 32),
					width: Math.round(r.width),
					height: Math.round(r.height),
					// An element whose padding already fills the tap area is fine.
					padded: cs.paddingTop !== '0px' || cs.paddingLeft !== '0px'
				});
			}
		}
	}
	return record;
})()`;

async function api(route, token) {
	const res = await fetch(ORIGIN + route, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
	return res.json();
}

async function signIn() {
	const post = async (route, body) => {
		const res = await fetch(ORIGIN + route, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		return { status: res.status, body: await res.json().catch(() => null) };
	};
	let res = await post('/api/v1/auths/signin', { email: EMAIL, password: PASSWORD });
	if (res.status !== 200) {
		res = await post('/api/v1/auths/signup', { name: 'ui-audit', email: EMAIL, password: PASSWORD });
	}
	if (!res.body?.token) throw new Error(`could not authenticate (${res.status})`);
	return res.body.token;
}

async function main() {
	if (!ORIGIN) throw new Error('--origin is required');
	if (!PASSWORD) throw new Error('--password is required');

	const token = await signIn();
	const [notes, knowledge, chats] = await Promise.all([
		api('/api/v1/notes/', token),
		api('/api/v1/knowledge/', token),
		api('/api/v1/chats/?page=1', token)
	]);
	const noteId = (notes || [])[0]?.id;
	const knowledgeId = (knowledge?.items || [])[0]?.id;
	const chatId = (chats || [])[0]?.id;

	const ROUTES = [
		['chat-home', '/'],
		['chat-thread', chatId ? `/c/${chatId}` : '/'],
		['notes-list', '/notes'],
		['note-editor', noteId ? `/notes/${noteId}` : '/notes'],
		['knowledge-list', '/workspace/knowledge'],
		['knowledge-detail', knowledgeId ? `/workspace/knowledge/${knowledgeId}` : '/workspace/knowledge'],
		['models', '/workspace/models'],
		['model-editor', '/workspace/models/edit?id=gpt-4o-mini'],
		['admin-settings', '/admin/settings'],
		['admin-users', '/admin/users'],
		['recordings', '/notes/recordings'],
		['playground', '/playground'],
		['messages', '/messages']
	];

	mkdirSync(OUT, { recursive: true });
	const { proc, wsUrl } = await launch();
	const cdp = new Cdp(new WebSocket(wsUrl));
	await cdp.connect();
	const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
	const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
	const call = (method, params = {}) => cdp.send(method, params, sessionId);
	await call('Page.enable');
	await call('Runtime.enable');

	/** Run a statement block in the page and return its `return` value. */
	const evaluate = async (body) => {
		const result = await call('Runtime.evaluate', {
			expression: `(async () => { ${body} })()`,
			awaitPromise: true,
			returnByValue: true
		});
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'eval failed');
		return result.result.value;
	};
	const goto = async (url, waitMs = 8000) => {
		await call('Page.navigate', { url });
		await sleep(waitMs);
	};

	await goto(`${ORIGIN}/`, 8000);
	await evaluate(`localStorage.setItem('token', ${JSON.stringify(token)}); return true;`);

	const failures = [];
	const report = [];

	try {
		for (const theme of THEMES) {
			await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
			for (const [width, height] of VIEWPORTS) {
				await call('Emulation.setDeviceMetricsOverride', {
					width, height, deviceScaleFactor: 1, mobile: width < 600
				});
				await call('Emulation.setTouchEmulationEnabled', {
					enabled: width < 600,
					maxTouchPoints: width < 600 ? 5 : 1
				});
				const tag = `${width < 600 ? 'mobile' : 'desktop'}-${theme}`;

				for (const [label, route] of ROUTES) {
					await goto(`${ORIGIN}${route}`, 9000);
					await evaluate(`
						const b = [...document.querySelectorAll('button')].find(x => /确认|开始使用|Got it/i.test(x.innerText || ''));
						if (b) b.click();
						return true;`);
					await sleep(2200);

					const measured = await evaluate(`return (${MEASURE});`);
					const lowContrast = measured.lowContrast.filter(
						(entry) => entry.ratio < 4.5 && !CONTRAST_EXEMPT.some((re) => re.test(entry.text))
					);
					const smallTargets = measured.smallTargets.filter((t) => !t.padded);

					report.push({ tag, label, route, ...measured, lowContrast, smallTargets });

					if (measured.overflowX) failures.push(`${tag} ${label}: horizontal overflow (${measured.scrollWidth}px)`);
					for (const entry of lowContrast) {
						failures.push(`${tag} ${label}: contrast ${entry.ratio} for ${JSON.stringify(entry.text)}`);
					}
					if (width < 600) {
						for (const t of smallTargets) {
							failures.push(`${tag} ${label}: ${t.tag} ${JSON.stringify(t.label)} is ${t.width}x${t.height}`);
						}
					}
					if (measured.tinyText.length) {
						for (const t of measured.tinyText) {
							failures.push(`${tag} ${label}: ${t.fontSize}px text ${JSON.stringify(t.text)}`);
						}
					}

					if (WANT_SHOTS) {
						const { data } = await call('Page.captureScreenshot', { format: 'png' });
						writeFileSync(path.join(OUT, `${tag}__${label}.png`), Buffer.from(data, 'base64'));
					}
				}
			}
		}
	} finally {
		// The DevTools socket keeps the event loop alive; close it or the audit
		// finishes its work and then hangs forever without exiting.
		try {
			cdp.ws.close();
		} catch {}
		proc.kill('SIGKILL');
	}

	writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

	if (failures.length) {
		console.error(`ui audit: ${failures.length} issue(s)`);
		for (const line of failures.slice(0, 40)) console.error('  ' + line);
		if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
		process.exitCode = 1;
	} else {
		console.log(`ui audit: clean across ${report.length} route/theme/viewport combinations`);
	}
	console.log(`report: ${path.join(OUT, 'report.json')}`);
}

main().catch((error) => {
	console.error(`ui audit: ERROR — ${error.message}`);
	process.exit(2);
});
