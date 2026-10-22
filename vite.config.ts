import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';
import { resolveBuildInfo } from './scripts/build-info.js';

import { viteStaticCopy } from 'vite-plugin-static-copy';

const buildInfo = resolveBuildInfo();

export default defineConfig(({ mode }) => {
	const backendTarget =
		process.env.WEBUI_BACKEND_URL ||
		loadEnv(mode, process.cwd(), 'WEBUI_BACKEND_URL').WEBUI_BACKEND_URL ||
		'http://localhost:8080';
	return {
		resolve: {
			conditions: ['onnxruntime-web-use-extern-wasm']
		},
		plugins: [
			sveltekit(),
			viteStaticCopy({
				targets: [
					{
						src: 'node_modules/onnxruntime-web/dist/*.jsep.*',

						dest: 'wasm'
					}
				]
			})
		],
		define: {
			APP_VERSION: JSON.stringify(process.env.npm_package_version),
			APP_BUILD_HASH: JSON.stringify(buildInfo.hash),
			APP_BUILD_CHANNEL: JSON.stringify(buildInfo.channel)
		},
		build: {
			sourcemap: true
		},
		server: {
			allowedHosts: process.env.CODESPACE_NAME
				? [`${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}`]
				: [],
			proxy: {
				'/api': {
					target: backendTarget,
					changeOrigin: true,
					ws: true
				},
				'/ollama': {
					target: backendTarget,
					changeOrigin: true
				},
				'/openai': {
					target: backendTarget,
					changeOrigin: true
				},
				'/oauth': {
					target: backendTarget,
					changeOrigin: true
				},
				'/ws': {
					target: backendTarget,
					changeOrigin: true,
					ws: true
				},
				'/cache': {
					target: backendTarget,
					changeOrigin: true
				},
				'/manifest.json': {
					target: backendTarget,
					changeOrigin: true
				},
				'/opensearch.xml': {
					target: backendTarget,
					changeOrigin: true
				}
			}
		},
		worker: {
			format: 'es'
		},
		esbuild: {
			pure: process.env.ENV === 'dev' ? [] : ['console.log', 'console.debug', 'console.error']
		}
	};
});
