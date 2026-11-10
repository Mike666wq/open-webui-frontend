import { describe, expect, it } from 'vitest';

import en from './en-US/translation.json';
import zh from './zh-CN/translation.json';

/**
 * P-008: the zh-CN catalogue used to contain hundreds of keys whose value was
 * an empty string (i18next then falls back to the English key) or simply the
 * English text again. Chinese users saw English in settings, workspace and the
 * chat header as a result.
 *
 * These assertions keep that from coming back.
 */

type Catalogue = Record<string, string>;

const enCatalogue = en as Catalogue;
const zhCatalogue = zh as Catalogue;

/**
 * Values that are intentionally identical to their key: product and protocol
 * names, model names, URLs, MIME types, file extensions and code literals.
 * Translating these would be wrong, not incomplete.
 */
const UNTRANSLATABLE = new Set<string>([
		"AI",
		"App URL",
		"Automatic1111",
		"Azure OpenAI",
		"Bearer",
		"Brave",
		"CPU",
		"Chat Completions",
		"ComfyUI",
		"DD/MM/YYYY",
		"Datalab Marker API",
		"Deepgram",
		"Docling",
		"Document Intelligence",
		"DuckDuckGo",
		"ElevenLabs",
		"Entra ID",
		"Gemini",
		"Grokipedia",
		"HTML",
		"ID",
		"JSON",
		"JSON Base64",
		"LM Studio",
		"LiteLLM",
		"Markdown",
		"Microsoft OneDrive",
		"MinerU",
		"Mistral OCR",
		"MistralAI",
		"Mojeek",
		"OAuth",
		"OAuth 2.1",
		"OAuth ID",
		"Ollama",
		"OpenAI",
		"OpenAI Realtime",
		"PaddleOCR-vl",
		"Pipe",
		"Responses",
		"Responses API",
		"Shell",
		"Sonar",
		"Sonar Deep Research",
		"Sonar Pro",
		"Sonar Reasoning",
		"Sonar Reasoning Pro",
		"Tika",
		"Tika 3.x",
		"Tika 4.x",
		"Tiktoken",
		"Token",
		"Transformers",
		"URL",
		"Webhook",
		"Yandex",
		"YouTube",
		"http://localhost:8000",
		"https://mineru.net/api/v4",
		"image/*, video/*",
		"key_name",
		"llama.cpp",
		"pdf, docx, pptx, xlsx",
		"sk-1234",
		"thinking, output_config",
		"{{ models }}",
		"此区域需要工作区 ID"
]);

describe('P-008 zh-CN catalogue completeness', () => {
	it('has no empty translations', () => {
		const empty = Object.entries(zhCatalogue)
			.filter(([, value]) => typeof value === 'string' && value.trim() === '')
			.map(([key]) => key);

		expect(empty).toEqual([]);
	});

	it('covers every English key except plural-only variants', () => {
		// Chinese has a single plural category, so the English `_one` forms are
		// legitimately absent; the `_other` forms are what i18next resolves.
		const missing = Object.keys(enCatalogue).filter(
			(key) => !(key in zhCatalogue) && !key.endsWith('_one')
		);

		expect(missing).toEqual([]);
	});

	it('only leaves a value in English when it is a proper noun or a literal', () => {
		const unexplained = Object.entries(zhCatalogue)
			.filter(([key, value]) => value === key && !UNTRANSLATABLE.has(key))
			.map(([key]) => key);

		expect(unexplained).toEqual([]);
	});

	it('never renders a raw i18n key path as text', () => {
		// A dotted path as a *value* means the UI would print
		// "settings.audio.realtime.azureUrl" to the user.
		const leaked = Object.entries(zhCatalogue)
			.filter(([, value]) => /^[a-zA-Z]+(\.[a-zA-Z0-9_]+){2,}$/.test(String(value).trim()))
			.map(([key]) => key);

		expect(leaked).toEqual([]);
	});

	it('keeps interpolation placeholders intact', () => {
		const placeholder = /\{\{[^}]+\}\}/g;
		const mismatched = Object.entries(zhCatalogue)
			.filter(([key, value]) => {
				// An empty English value means the key itself is the source text.
				const source = enCatalogue[key]?.trim() ? enCatalogue[key] : key;
				const expected = (source.match(placeholder) ?? []).sort();
				const actual = (String(value).match(placeholder) ?? []).sort();
				return expected.join('|') !== actual.join('|');
			})
			.map(([key]) => key);

		expect(mismatched).toEqual([]);
	});
});
