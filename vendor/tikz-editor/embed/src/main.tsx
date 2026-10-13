import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setActiveEditorPlatform } from '@tikz-editor/app/platform/current';
import { useEditorStore } from '@tikz-editor/app/store';
import type { EditorPlatform } from '@tikz-editor/app/platform/types';
import type { DocumentFileRef } from '@tikz-editor/app/store/types';
import './styles.css';
import { commandIdentitySchema, hostCommandSchema, type HostCommand } from './commands';
import { createSnapshotRequests } from './snapshots';
import type { CommandFailure } from './events';
import { executeInkCommand } from './ink-commands';
import { parseTikzForEdit } from 'tikz-editor/edit/parse-options';

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

type PendingEditorMessage = {
	source: string;
	sourceRevision: number;
	revision: number;
};

const WORKSPACE_KEY = 'tikz-editor:workspace';
const SETTINGS_KEY = 'tikz-editor:settings';
const STORAGE_HASH_KEY = 'storage';
const SETTINGS_VERSION = 1;
const CHANGE_THROTTLE_MS = 250;
const TEXT_FILE_ACCEPT = '.tex,.tikz,.pgf,.svg,.ipe,text/plain,text/x-tex,text/xml,application/xml,image/svg+xml';
const DEFAULT_SOURCE = String.raw`\begin{tikzpicture}
  \draw[thick, blue] (0,0) circle (1cm);
  \node at (0,0) {TikZ};
\end{tikzpicture}
`;

let lastSavedSource = DEFAULT_SOURCE;
let currentFileName = 'document.tikz';
let currentHostRevision = 0;
let currentHostSession = '';
let imageBaseUrl = '';
let imageBaseErrorReported = false;
const persistenceValues = new Map<string, string>();

function postToHost(message: Record<string, unknown>) {
	if (window.parent === window) return;
	window.parent.postMessage(JSON.stringify({ sessionId: currentHostSession, revision: currentHostRevision, ...message }), new URL(document.referrer).origin);
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
	const state = useEditorStore.getState();
	const source = state.source;
	const lastKnownSvg = state.snapshot.source === source && state.pendingRequestId === null ? state.snapshot.svg?.svg ?? '' : '';
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
	persistenceValues.set(WORKSPACE_KEY, makeWorkspaceSeed(initialSource));
	return {
		load: (key) => persistenceValues.get(key) ?? null,
		save: (key, value) => {
			persistenceValues.set(key, value);
			if (key !== WORKSPACE_KEY) postToHost({ event: 'persistence-save', key, value });
		},
	};
}

function createEmbedPlatform(initialSource: string): EditorPlatform {
	return {
		id: 'zettlr-embed',
		persistence: createMemoryPersistence(initialSource),
		clipboard: {
			readText: async () => navigator.clipboard?.readText?.() ?? '',
			writeText: async (text) => { await navigator.clipboard?.writeText?.(text); },
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
				postToHost({ event: 'save', revision: currentHostRevision, source: text, xml: text, fileName: currentFileName });
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
	const store = useEditorStore.getState();
	store.dispatch({ type: 'CODE_EDITED', source });
	store.dispatch({ type: 'MARK_DOCUMENT_SAVED', fileRef: makeFileRef(fileName), lastKnownDiskSource: source });
	postToHost({ event: 'loaded', revision: currentHostRevision });
}

function HostBridge() {
	const [fullscreen, setFullscreen] = useState(false);
	const fullscreenRef = useRef(false);
	const previousSourceRef = useRef<string | null>(null);
	const previousRenderRef = useRef(-1);
	const pendingChangeRef = useRef<PendingEditorMessage | null>(null);
	const changeTimerRef = useRef<number | null>(null);

	useEffect(() => {
		const pendingCommands = new Map<string, { command: HostCommand; timer: number }>();
		const snapshots = createSnapshotRequests(reply => postToHost({ ...reply }), () => imageBaseUrl);
		postToHost({ event: 'init', version: '0.5.2-zettlr.1' });

		const flushChange = () => {
			changeTimerRef.current = null;
			const pending = pendingChangeRef.current;
			pendingChangeRef.current = null;
			if (!pending) return;
			postToHost({ event: 'change', revision: pending.revision, source: pending.source, sourceRevision: pending.sourceRevision });
		};

		const scheduleChange = (source: string, sourceRevision: number, revision: number) => {
			pendingChangeRef.current = { source, sourceRevision, revision };
			if (changeTimerRef.current !== null) return;
			changeTimerRef.current = window.setTimeout(flushChange, CHANGE_THROTTLE_MS);
		};

		const unsubscribe = useEditorStore.subscribe((state) => {
			if (state.snapshot.source === state.source && state.pendingRequestId === null &&
				state.snapshot.svg !== null && state.snapshot.revision !== previousRenderRef.current) {
				previousRenderRef.current = state.snapshot.revision;
				postToHost({ event: 'rendered', sourceRevision: state.sourceRevision });
			}

			if (previousSourceRef.current === null) {
				previousSourceRef.current = state.source;
				return;
			}
			if (state.source === previousSourceRef.current) return;
			previousSourceRef.current = state.source;
			scheduleChange(state.source, state.sourceRevision, currentHostRevision);
		});

		const reply = (command: HostCommand, error?: CommandFailure) => {
			const pending = pendingCommands.get(command.requestId);
			if (pending) {
				window.clearTimeout(pending.timer);
				pendingCommands.delete(command.requestId);
			}
			postToHost({ event: 'reply', requestId: command.requestId, sessionId: command.sessionId,
				revision: command.revision, action: command.action,
				status: error === undefined ? 'ok' : 'failed', error });
		};

		const handleMessage = (event: MessageEvent) => {
			if (window.parent === window || event.source !== window.parent) return;
			if (event.origin !== new URL(document.referrer).origin) return;
			let data: unknown = event.data;
			if (typeof data === 'string') {
				try { data = JSON.parse(data); } catch { return; }
			}
			const parsed = hostCommandSchema.safeParse(data);
			if (!parsed.success) {
				const identity = commandIdentitySchema.safeParse(data);
				if (identity.success) postToHost({ ...identity.data, event: 'reply', status: 'failed', error: 'invalid-command' });
				return;
			}
			const command = parsed.data;
			if (command.action !== 'load' && command.action !== 'snapshot' &&
				(command.sessionId !== currentHostSession || command.revision !== currentHostRevision)) {
				reply(command, 'stale-target');
				return;
			}
			switch (command.action) {
				case 'import-ink':
				case 'interpret-ink':
				case 'restore-ink':
					try { reply(command, executeInkCommand(command)); }
					catch (error) {
						postToHost({ event: 'error', message: error instanceof Error ? error.message : String(error) });
						reply(command, 'invalid-original-ink');
					}
					return;
				case 'load': {
					if (command.state && !parseTikzForEdit(command.source, { activeFigureId: command.state.activeFigureId })
						.figures.some(figure => figure.id === command.state!.activeFigureId)) {
						reply(command, 'invalid-command');
						return;
					}
					if (currentHostSession !== '' &&
						(command.sessionId !== currentHostSession || command.revision <= currentHostRevision)) {
						reply(command, 'stale-target');
						return;
					}
					snapshots.replace();
					for (const pending of pendingCommands.values()) reply(pending.command, 'stale-target');
					currentHostSession = command.sessionId;
					currentHostRevision = command.revision;
					imageBaseUrl = command.imageBaseUrl ?? '';
					imageBaseErrorReported = false;
					applyHostSettings(command.settings);
					persistHostSettings(command.settings);
					pendingChangeRef.current = null;
					useEditorStore.getState().dispatch({ type: 'RESTORE_CANVAS_VIEWPORT', restore: command.state ? { source: command.source, transform: command.state.viewport, fitToContent: command.state.fitToContent } : null });
					loadIntoEditor(command.source, command.fileName);
					if (command.state) {
						const { dispatch } = useEditorStore.getState();
						dispatch({ type: 'SET_ACTIVE_FIGURE', figureId: command.state.activeFigureId });
						dispatch({ type: 'SET_TOOL_MODE', mode: command.state.tool });
						dispatch({ type: 'SET_FREEHAND_INTERPRETATION', enabled: command.state.interpretGeometry });
						dispatch({ type: 'SELECT_RANGE', ids: command.state.selection });
					}
					reply(command);
					return;
				}
				case 'snapshot':
					snapshots.request(command, currentHostSession, currentHostRevision);
					return;
				case 'cancel':
					if (pendingCommands.has(command.targetRequestId)) reply(pendingCommands.get(command.targetRequestId)!.command, 'cancelled');
					snapshots.cancel(command.targetRequestId);
					reply(command);
					return;
				case 'source':
					postToHost({ event: 'reply', requestId: command.requestId, status: 'ok', action: 'source', source: useEditorStore.getState().source });
					return;
				case 'settings':
					applyHostSettings(command.settings);
					persistHostSettings(command.settings);
					reply(command);
					return;
				case 'display':
					fullscreenRef.current = command.fullscreen;
					setFullscreen(command.fullscreen);
					reply(command);
					return;
				case 'workspace':
					if (pendingCommands.has(command.requestId)) return;
					if (pendingCommands.size >= 32) { reply(command, 'busy'); return; }
					pendingCommands.set(command.requestId, { command,
						timer: window.setTimeout(() => reply(command, 'timeout'), 10000) });
					void import('@tikz-editor/app/workspace').then(({ applyWorkspace }) => {
						if (pendingCommands.get(command.requestId)?.command !== command) return;
						if (command.revision !== currentHostRevision) { reply(command, 'stale-target'); return; }
						applyWorkspace(command.workspace);
						document.documentElement.dataset.embedWorkspace = command.workspace;
						reply(command);
					}).catch(() => {
						if (pendingCommands.get(command.requestId)?.command === command) reply(command, 'workspace-unavailable');
					});
					return;
				case 'inspector':
					document.documentElement.dataset.embedInspector = command.inspector ? 'open' : 'closed';
					window.dispatchEvent(new Event('tikz-embed-inspector'));
					reply(command);
					return;
			}
		};

		const handleKeydown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape' || !fullscreenRef.current) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			postToHost({ event: 'close-request' });
		};

		const inspectorClosed = () => postToHost({ event: 'inspector-closed' });
		window.addEventListener('tikz-embed-inspector-closed', inspectorClosed);
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
			snapshots.dispose();
			for (const pending of pendingCommands.values()) window.clearTimeout(pending.timer);
			pendingCommands.clear();
			imageObserver.disconnect();
			unsubscribe();
			window.removeEventListener('tikz-embed-inspector-closed', inspectorClosed);
			window.removeEventListener('message', handleMessage);
			window.removeEventListener('keydown', handleKeydown, true);
			if (changeTimerRef.current !== null) window.clearTimeout(changeTimerRef.current);
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

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<HostBridge />
		<Suspense fallback={null}>
			<App />
		</Suspense>
	</StrictMode>,
);
