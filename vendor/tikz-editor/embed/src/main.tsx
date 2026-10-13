import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setActiveEditorPlatform } from '@tikz-editor/app/platform/current';
import { useEditorStore } from '@tikz-editor/app/store';
import { CANVAS_ZOOM_BASE_SCALE } from '@tikz-editor/app';
import type { EditorPlatform } from '@tikz-editor/app/platform/types';
import type { DocumentFileRef } from '@tikz-editor/app/store/types';
import './styles.css';

const App = lazy(async () => {
	const mod = await import('@tikz-editor/app');
	return { default: mod.App };
});

type HostSettingsPatch = {
	general?: {
		colorScheme?: 'system' | 'light' | 'dark';
		canvasInvert?: boolean;
	};
};

type HostMessage = {
	action?: string;
	event?: string;
	source?: string;
	xml?: string;
	revision?: number;
	format?: string;
	autosave?: 0 | 1 | boolean;
	fileName?: string;
	name?: string;
	modified?: boolean;
	fullscreen?: boolean;
	direction?: 'in' | 'out' | 'reset';
	settings?: HostSettingsPatch;
	imageBaseUrl?: string;
	workspace?: 'default' | 'canvasOnly';
	inspector?: boolean;
	nativeClipboard?: boolean;
};

type PendingEditorMessage = {
	source: string;
	svg: string;
	revision: number;
};

const WORKSPACE_KEY = 'tikz-editor:workspace';
const SETTINGS_KEY = 'tikz-editor:settings';
const STORAGE_HASH_KEY = 'storage';
const SETTINGS_VERSION = 1;
const CHANGE_THROTTLE_MS = 250;
const AUTOSAVE_DEBOUNCE_MS = 1000;
const TEXT_FILE_ACCEPT = '.tex,.tikz,.pgf,.svg,.ipe,text/plain,text/x-tex,text/xml,application/xml,image/svg+xml';
const DEFAULT_SOURCE = String.raw`\begin{tikzpicture}
  \draw[thick, blue] (0,0) circle (1cm);
  \node at (0,0) {TikZ};
\end{tikzpicture}
`;

let autosaveEnabled = false;
let lastSavedSource = DEFAULT_SOURCE;
let lastKnownSvg = '';
let currentFileName = 'document.tikz';
let currentHostRevision = 0;
let nativeClipboard = false;
const clipboardRequests = new Map<string, {
	resolve: (text: string) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}>();

function requestNativeClipboard(operation: 'read' | 'write', text?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const requestId = crypto.randomUUID();
		const timer = setTimeout(() => {
			clipboardRequests.delete(requestId);
			reject(new Error('The native clipboard did not answer within 10 seconds.'));
		}, 10_000);
		clipboardRequests.set(requestId, { resolve, reject, timer });
		postToHost({ event: `clipboard-${operation}`, requestId, text });
	});
}

window.addEventListener('message', (event: MessageEvent) => {
	if (event.source !== window.parent || event.origin !== new URL(document.referrer).origin) return;
	const result = event.data as { event?: string; requestId?: string; text?: string; error?: string };
	if (result?.event !== 'clipboard-result' || typeof result.requestId !== 'string') return;
	const request = clipboardRequests.get(result.requestId);
	if (!request) return;
	clearTimeout(request.timer);
	clipboardRequests.delete(result.requestId);
	if (typeof result.error === 'string') request.reject(new Error(result.error));
	else request.resolve(typeof result.text === 'string' ? result.text : '');
});
let imageBaseUrl = '';
let imageBaseErrorReported = false;
const persistenceValues = new Map<string, string>();

function postToHost(message: Record<string, unknown>) {
	window.parent?.postMessage(JSON.stringify(message), '*');
}

function sourceFromMessage(message: HostMessage): string | null {
	if (typeof message.source === 'string') return message.source;
	if (typeof message.xml === 'string') return message.xml;
	return null;
}

function wantsSvg(format?: string) {
	return typeof format === 'string' && format.toLowerCase().includes('svg');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function persistHostSettings(settings?: HostSettingsPatch) {
	if (!settings?.general) return;

	const currentRaw = persistenceValues.get(SETTINGS_KEY);
	let currentSettings: Record<string, unknown> = {};
	try {
		const parsed = currentRaw ? JSON.parse(currentRaw) as unknown : null;
		if (isRecord(parsed) && isRecord(parsed.settings)) {
			currentSettings = parsed.settings;
		}
	} catch {}

	const currentGeneral = isRecord(currentSettings.general) ? currentSettings.general : {};
	const nextRaw = JSON.stringify({
		settingsVersion: SETTINGS_VERSION,
		settings: {
			...currentSettings,
			general: {
				...currentGeneral,
				...settings.general,
			},
		},
	});

	if (nextRaw === currentRaw) return;
	persistenceValues.set(SETTINGS_KEY, nextRaw);
	try { window.localStorage.setItem(SETTINGS_KEY, nextRaw); } catch {}
	postToHost({ event: 'persistence-save', key: SETTINGS_KEY, value: nextRaw });
}

function applyHostSettings(settings?: HostSettingsPatch) {
	const general = settings?.general;
	if (!general) return;

	if (general.colorScheme === 'light' || general.colorScheme === 'dark') {
		document.documentElement.dataset.colorScheme = general.colorScheme;
	} else if (general.colorScheme === 'system') {
		delete document.documentElement.dataset.colorScheme;
	}

	if (typeof general.canvasInvert === 'boolean') {
		if (general.canvasInvert) {
			document.documentElement.dataset.canvasInvert = 'true';
		} else {
			delete document.documentElement.dataset.canvasInvert;
		}
	}
}

function makeExportPayload(format: string | undefined) {
	const source = useEditorStore.getState().source;
	const requestedSvg = wantsSvg(format);
	const data = requestedSvg ? lastKnownSvg : source;

	if (requestedSvg && !lastKnownSvg.trim()) {
		return {
			event: 'export',
			revision: currentHostRevision,
			format: format ?? 'svg',
			error: 'SVG is not ready yet. Wait for the preview to finish rendering and try again.',
			source,
			xml: source,
			svg: '',
			data: '',
		};
	}

	return {
		event: 'export',
		revision: currentHostRevision,
		format: format ?? 'tikz',
		data,
		source,
		xml: source,
		svg: lastKnownSvg,
	};
}

function makeFileRef(name = currentFileName): DocumentFileRef {
	return { kind: 'virtual', name };
}

function openTextFileWithPicker(): Promise<{ source: string; fileRef: DocumentFileRef | null } | null> {
	if (typeof document === 'undefined' || typeof FileReader === 'undefined') return Promise.resolve(null);

	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = TEXT_FILE_ACCEPT;
		input.style.display = 'none';

		let settled = false;
		let changed = false;

		const finish = (result: { source: string; fileRef: DocumentFileRef | null } | null) => {
			if (settled) return;
			settled = true;
			window.removeEventListener('focus', handleFocus);
			input.remove();
			resolve(result);
		};

		const handleFocus = () => {
			window.setTimeout(() => {
				if (!changed) finish(null);
			}, 300);
		};

		input.addEventListener('change', () => {
			changed = true;
			const file = input.files?.[0];
			if (!file) {
				finish(null);
				return;
			}

			const reader = new FileReader();
			reader.onerror = () => finish(null);
			reader.onload = () => {
				finish({
					source: typeof reader.result === 'string' ? reader.result : '',
					fileRef: makeFileRef(file.name || currentFileName),
				});
			};
			reader.readAsText(file);
		}, { once: true });

		document.body.appendChild(input);
		window.addEventListener('focus', handleFocus, { once: true });
		input.click();
	});
}

function makeWorkspaceSeed(source: string, fileName = currentFileName) {
	return JSON.stringify({
		workspaceVersion: 2,
		documents: [{
			id: 'zettlr-document',
			title: fileName,
			source,
			savedSource: source,
			activeFigureId: null,
			fileRef: makeFileRef(fileName),
			diskRevision: null,
			lastKnownDiskSource: source,
			externalChangeStatus: 'none',
			assistantThreadId: null,
			assistantWorkspacePath: null,
			assistantFigurePath: null,
			assistantPreviewPath: null,
		}],
		tabOrder: ['zettlr-document'],
		activeDocumentId: 'zettlr-document',
		recentDocumentIds: ['zettlr-document'],
	});
}

function createMemoryPersistence(initialSource: string): EditorPlatform['persistence'] {
	persistenceValues.clear();
	const seededStorage = new URLSearchParams(window.location.hash.slice(1)).get(STORAGE_HASH_KEY);
	if (seededStorage) {
		try {
			Object.entries(JSON.parse(seededStorage) as Record<string, string>).forEach(([key, value]) => {
				if (key !== WORKSPACE_KEY && typeof value === 'string') persistenceValues.set(key, value);
			});
		} catch {}
	}
	try {
		const savedSettings = window.localStorage.getItem(SETTINGS_KEY);
		if (savedSettings && !persistenceValues.has(SETTINGS_KEY)) persistenceValues.set(SETTINGS_KEY, savedSettings);
	} catch {}
	persistenceValues.set(WORKSPACE_KEY, makeWorkspaceSeed(initialSource));
	return {
		load: (key) => persistenceValues.get(key) ?? null,
		save: (key, value) => {
			persistenceValues.set(key, value);
			if (key !== WORKSPACE_KEY) {
				try { window.localStorage.setItem(key, value); } catch {}
				postToHost({ event: 'persistence-save', key, value });
			}
		},
	};
}

function createEmbedPlatform(initialSource: string): EditorPlatform {
	return {
		id: 'zettlr-embed',
		persistence: createMemoryPersistence(initialSource),
		clipboard: {
			readText: async () => nativeClipboard ? requestNativeClipboard('read') : navigator.clipboard.readText(),
			writeText: async (text) => {
				if (nativeClipboard) await requestNativeClipboard('write', text);
				else await navigator.clipboard.writeText(text);
			},
		},
		menu: {
			usesNativeMenuBar: false,
			usesNativeContextMenus: false,
			syncNativeMenu: () => {},
			showNativeContextMenu: () => {},
		},
		window: {
			setDocumentState: ({ dirty }) => {
				postToHost({ event: 'status', modified: Boolean(dirty) });
			},
			openExternalUrl: (url) => {
				const opened = window.open(url, '_blank', 'noopener,noreferrer');
				return opened != null;
			},
			showMessage: ({ title, message, kind }) => {
				postToHost({ event: 'message', title, message, kind });
			},
		},
		files: {
			openText: async () => openTextFileWithPicker(),
			saveText: async (text, options) => {
				lastSavedSource = text;
				currentFileName = options?.suggestedName ?? options?.fileRef?.name ?? currentFileName;
				postToHost({ event: 'save', revision: currentHostRevision, source: text, xml: text, svg: lastKnownSvg, fileName: currentFileName });
				return { status: 'saved', fileRef: makeFileRef(currentFileName) };
			},
			exportFile: async (content, options) => {
				const format = options.mimeType || options.fileName;
				postToHost(wantsSvg(format) ? makeExportPayload(format) : { ...makeExportPayload(format), data: content });

				// Returning false keeps the upstream browser download fallback active for menu exports.
				// Parent-initiated exports still use the explicit `action: export` message path below.
				return false;
			},
		},
	};
}

function loadIntoEditor(source: string, fileName = currentFileName) {
	currentFileName = fileName;
	lastSavedSource = source;
	lastKnownSvg = '';
	const store = useEditorStore.getState();
	store.dispatch({ type: 'CODE_EDITED', source });
	store.dispatch({ type: 'MARK_DOCUMENT_SAVED', fileRef: makeFileRef(fileName), lastKnownDiskSource: source });
	postToHost({ event: 'loaded', revision: currentHostRevision });
}

function HostBridge() {
	const [fullscreen, setFullscreen] = useState(false);
	const fullscreenRef = useRef(false);
	const previousSourceRef = useRef<string | null>(null);
	const previousSvgRef = useRef<string>('');
	const pendingChangeRef = useRef<PendingEditorMessage | null>(null);
	const pendingAutosaveRef = useRef<PendingEditorMessage | null>(null);
	const changeTimerRef = useRef<number | null>(null);
	const autosaveTimerRef = useRef<number | null>(null);

	useEffect(() => {
		postToHost({ event: 'init', version: '0.5.2-zettlr.1' });
		useEditorStore.getState().dispatch({ type: 'SET_TOOL_MODE', mode: 'addFreehand' });

		const flushChange = () => {
			changeTimerRef.current = null;
			const pending = pendingChangeRef.current;
			pendingChangeRef.current = null;
			if (!pending) return;
			postToHost({ event: 'change', revision: pending.revision, source: pending.source, xml: pending.source, svg: pending.svg });
		};

		const scheduleChange = (source: string, svg: string, revision: number) => {
			pendingChangeRef.current = { source, svg, revision };
			if (changeTimerRef.current !== null) return;
			changeTimerRef.current = window.setTimeout(flushChange, CHANGE_THROTTLE_MS);
		};

		const flushAutosave = () => {
			autosaveTimerRef.current = null;
			const pending = pendingAutosaveRef.current;
			pendingAutosaveRef.current = null;
			if (!pending) return;
			postToHost({ event: 'autosave', revision: pending.revision, source: pending.source, xml: pending.source, svg: pending.svg });
		};

		const scheduleAutosave = (source: string, svg: string, revision: number) => {
			pendingAutosaveRef.current = { source, svg, revision };
			if (autosaveTimerRef.current !== null) {
				window.clearTimeout(autosaveTimerRef.current);
			}
			autosaveTimerRef.current = window.setTimeout(flushAutosave, AUTOSAVE_DEBOUNCE_MS);
		};

		const flushPendingEditorMessages = () => {
			if (changeTimerRef.current !== null) {
				window.clearTimeout(changeTimerRef.current);
				flushChange();
			}
			if (autosaveTimerRef.current !== null) {
				window.clearTimeout(autosaveTimerRef.current);
				flushAutosave();
			}
		};

		let previousSelection = '';
		const unsubscribe = useEditorStore.subscribe((state) => {
			if (state.snapshot.source === state.source) {
				const handle = state.activeHandleId === null ? undefined : state.snapshot.editHandles.find(item => item.id === state.activeHandleId);
				const spans = handle ? [handle.sourceRef.sourceSpan] : (state.snapshot.scene?.elements ?? [])
					.filter(item => state.selectedElementIds.has(item.sourceRef.sourceId))
					.map(item => item.sourceRef.sourceSpan);
				if (spans.length > 0) {
					const from = Math.min(...spans.map(span => span.from));
					const to = Math.max(...spans.map(span => span.to));
					const selection = JSON.stringify([state.sourceRevision, from, to, state.activeHandleId]);
					if (selection !== previousSelection) {
						previousSelection = selection;
						postToHost({ event: 'source-selection', revision: currentHostRevision, source: state.source, from, to });
					}
				} else previousSelection = '';
			}
			const nextSvg = state.snapshot.svg?.svg ?? '';
			if (nextSvg && nextSvg !== previousSvgRef.current) {
				previousSvgRef.current = nextSvg;
				lastKnownSvg = nextSvg;
			}

			if (previousSourceRef.current === null) {
				previousSourceRef.current = state.source;
				return;
			}
			if (state.source === previousSourceRef.current) return;
			previousSourceRef.current = state.source;
			scheduleChange(state.source, lastKnownSvg, currentHostRevision);
			if (autosaveEnabled) {
				scheduleAutosave(state.source, lastKnownSvg, currentHostRevision);
			}
		});

		const handleMessage = (event: MessageEvent) => {
			let message: HostMessage | null = null;
			if (typeof event.data === 'string') {
				try { message = JSON.parse(event.data) as HostMessage; } catch { return; }
			} else if (event.data && typeof event.data === 'object') {
				message = event.data as HostMessage;
			}
			if (!message) return;
			const action = message.action || message.event;
			if (action === 'load') {
				nativeClipboard = message.nativeClipboard === true;
				imageBaseUrl = message.imageBaseUrl ?? '';
				imageBaseErrorReported = false;
				if (typeof message.revision === 'number' && Number.isInteger(message.revision)) {
					currentHostRevision = message.revision;
				}
				applyHostSettings(message.settings);
				persistHostSettings(message.settings);
				autosaveEnabled = Boolean(message.autosave);
				pendingChangeRef.current = null;
				pendingAutosaveRef.current = null;
				loadIntoEditor(sourceFromMessage(message) ?? DEFAULT_SOURCE, message.fileName ?? message.name ?? currentFileName);
			} else if (action === 'settings') {
				applyHostSettings(message.settings);
				persistHostSettings(message.settings);
			} else if (action === 'display') {
				const nextFullscreen = message.fullscreen === true;
				fullscreenRef.current = nextFullscreen;
				setFullscreen(nextFullscreen);
			} else if (action === 'zoom' && message.direction === 'reset') {
				useEditorStore.getState().dispatch({ type: 'REQUEST_ZOOM_SCALE', scale: CANVAS_ZOOM_BASE_SCALE });
			} else if (action === 'zoom' && (message.direction === 'in' || message.direction === 'out')) {
				useEditorStore.getState().dispatch({ type: 'REQUEST_ZOOM', direction: message.direction });
			} else if (action === 'workspace' && message.workspace) {
				const workspace = message.workspace;
				void import('@tikz-editor/app/workspace').then(({ applyWorkspace }) => applyWorkspace(workspace));
			} else if (action === 'inspector' && typeof message.inspector === 'boolean') {
				document.documentElement.dataset.embedInspector = message.inspector ? 'open' : 'closed';
				window.dispatchEvent(new Event('tikz-embed-inspector'));
			} else if (action === 'save') {
				flushPendingEditorMessages();
				const source = useEditorStore.getState().source;
				lastSavedSource = source;
				useEditorStore.getState().dispatch({ type: 'MARK_DOCUMENT_SAVED', fileRef: makeFileRef(currentFileName), lastKnownDiskSource: source });
				postToHost({ event: 'save', revision: currentHostRevision, source, xml: source, svg: lastKnownSvg, fileName: currentFileName });
			} else if (action === 'export') {
				flushPendingEditorMessages();
				postToHost(makeExportPayload(message.format));
			} else if (action === 'status' && typeof message.modified === 'boolean' && !message.modified) {
				useEditorStore.getState().dispatch({ type: 'MARK_DOCUMENT_SAVED', fileRef: makeFileRef(currentFileName), lastKnownDiskSource: useEditorStore.getState().source });
			}
		};

		const handleKeydown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key === '0') {
				event.preventDefault();
				event.stopImmediatePropagation();
				useEditorStore.getState().dispatch({ type: 'REQUEST_ZOOM_SCALE', scale: CANVAS_ZOOM_BASE_SCALE });
				return;
			}
			if (event.key !== 'Escape' || !fullscreenRef.current) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			postToHost({ event: 'close-request' });
		};

		window.addEventListener('message', handleMessage);
		const imageObserver = new MutationObserver(() => {
			const images = document.querySelectorAll<SVGImageElement>('image[data-image-file]');
			if (!imageBaseUrl && images.length > 0 && !imageBaseErrorReported) {
				imageBaseErrorReported = true;
				postToHost({ event: 'error', message: 'Image rendering requires a document image base URL.' });
				return;
			}
			for (const image of images) {
				const fileName = image.dataset.imageFile;
				if (!fileName) continue;
				const url = new URL(fileName, imageBaseUrl).href;
				if (image.getAttribute('href') !== url) image.setAttribute('href', url);
			}
		});
		imageObserver.observe(document.body, { childList: true, subtree: true });
		window.addEventListener('keydown', handleKeydown, true);
		return () => {
			imageObserver.disconnect();
			unsubscribe();
			window.removeEventListener('message', handleMessage);
			window.removeEventListener('keydown', handleKeydown, true);
			if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
			if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
		};
	}, []);

	return fullscreen ? (
		<button
			type="button"
			className="zettlr-exit-fullscreen"
			title="Exit fullscreen (Esc)"
			onClick={() => postToHost({ event: 'close-request' })}
		>
			Exit fullscreen
		</button>
	) : null;
}

setActiveEditorPlatform(createEmbedPlatform(DEFAULT_SOURCE));

Object.defineProperty(window, 'visualTikzEditorDebug', {
	value: () => {
		const state = useEditorStore.getState();
		return {
			source: state.source,
			sourceRevision: state.sourceRevision,
			figureId: state.activeFigureId,
			tool: state.toolMode,
			selection: [...state.selectedElementIds],
			handle: state.activeHandleId,
			viewport: state.canvasTransform,
			pendingRequestId: state.pendingRequestId,
			snapshotSource: state.snapshot.source,
			scene: state.snapshot.scene,
			editHandles: state.snapshot.editHandles,
			historyIndex: state.historyIndex,
			canvasAids: state.canvasAids,
			snapModes: state.snapModes,
			diagnostics: state.diagnostics,
			developerLogs: state.developerLogs,
			snapDebug: state.snapDebug,
			incremental: state.snapshot.incremental,
		};
	},
});

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<HostBridge />
		<Suspense fallback={null}>
			<App />
		</Suspense>
	</StrictMode>,
);
