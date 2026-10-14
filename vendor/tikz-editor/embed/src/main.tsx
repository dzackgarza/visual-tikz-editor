import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setActiveEditorPlatform } from '@tikz-editor/app/platform/current';
import { useEditorStore } from '@tikz-editor/app/store';
import { CANVAS_ZOOM_BASE_SCALE, getEditorSettings, reloadEditorSettings, updateEditorGeneralSettings } from '@tikz-editor/app';
import type { EditorPlatform } from '@tikz-editor/app/platform/types';
import type { DocumentFileRef } from '@tikz-editor/app/store/types';
import './styles.css';
import { commandIdentitySchema, hostCommandSchema, type HostCommand } from './commands';
import { createSnapshotRequests } from './snapshots';
import type { CommandFailure } from './events';
import { executeInkCommand } from './ink-commands';
import { parseTikzForEdit } from 'tikz-editor/edit/parse-options';
import { walkStatements } from 'tikz-editor/ast/walk';

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
let nativeClipboard = false;
const clipboardRequests = new Map<string, {
  sessionId: string;
  revision: number;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
function cancelClipboardRequests(reason: string): void {
  for (const request of clipboardRequests.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(reason));
  }
  clipboardRequests.clear();
}
function requestNativeClipboard(operation: 'read' | 'write', text?: string): Promise<string> {
  if (clipboardRequests.size >= 32) return Promise.reject(new Error('The native clipboard is busy.'));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      clipboardRequests.delete(requestId);
      reject(new Error('The native clipboard did not answer within 10 seconds.'));
    }, 10_000);
    clipboardRequests.set(requestId, { sessionId: currentHostSession, revision: currentHostRevision, resolve, reject, timer });
    postToHost({ event: `clipboard-${operation}`, requestId, text });
  });
}
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

function applyHostSettings(settings?: HostSettingsPatch) {
  if (settings?.general) updateEditorGeneralSettings(settings.general);
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
			get nativeText() { return nativeClipboard; },
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
		let pendingLoad: (() => void) | null = null;
		const snapshots = createSnapshotRequests(reply => postToHost({ ...reply }), () => imageBaseUrl);
		postToHost({ event: 'init', version: '0.5.2-zettlr.1' });
		useEditorStore.getState().dispatch({ type: 'SET_TOOL_MODE', mode: 'addFreehand' });

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

		let previousSelection = '';
		const unsubscribe = useEditorStore.subscribe((state) => {
			if (state.snapshot.source === state.source) {
				const handle = state.activeHandleId === null ? undefined : state.snapshot.editHandles.find(item => item.id === state.activeHandleId);
				// A selected statement shows its whole statement; a selected node or
				// other item inside one shows that item; a selected point shows the point.
				const statementSpans = new Map<string, { from: number; to: number }>();
				walkStatements(state.snapshot.parseResult?.figure.body ?? [], { onStatement: statement => statementSpans.set(statement.id, statement.span) });
				const spans = handle ? [handle.sourceRef.sourceSpan] : (state.snapshot.scene?.elements ?? [])
					.filter(item => state.selectedElementIds.has(item.sourceRef.sourceId))
					.map(item => statementSpans.get(item.sourceRef.sourceId) ?? item.sourceRef.sourceSpan);
				if (spans.length > 0) {
					const from = Math.min(...spans.map(span => span.from));
					const to = Math.max(...spans.map(span => span.to));
					const selection = JSON.stringify([state.sourceRevision, from, to, state.activeHandleId]);
					if (selection !== previousSelection) {
						previousSelection = selection;
						postToHost({ event: 'source-selection', source: state.source, from, to });
					}
				} else previousSelection = '';
			}
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
					const restoredState = command.state;
					if (restoredState && !parseTikzForEdit(command.source, { activeFigureId: restoredState.activeFigureId })
						.figures.some(figure => figure.id === restoredState.activeFigureId)) {
						reply(command, 'invalid-command');
						return;
					}
					if (currentHostSession !== '' &&
						(command.sessionId !== currentHostSession || command.revision <= currentHostRevision)) {
						reply(command, 'stale-target');
						return;
					}
					pendingLoad?.();
					pendingLoad = null;
					snapshots.replace();
					cancelClipboardRequests('The editor document changed.');
					for (const pending of pendingCommands.values()) reply(pending.command, 'stale-target');
					currentHostSession = command.sessionId;
					currentHostRevision = command.revision;
					nativeClipboard = command.nativeClipboard === true;
					imageBaseUrl = command.imageBaseUrl ?? '';
					imageBaseErrorReported = false;
					applyHostSettings(command.settings);
					pendingChangeRef.current = null;
					useEditorStore.getState().dispatch({ type: 'RESTORE_CANVAS_VIEWPORT', restore: restoredState ? { source: command.source, transform: restoredState.viewport, fitToContent: restoredState.fitToContent } : null });
					loadIntoEditor(command.source, command.fileName);
					const finishLoad = () => {
						const state = useEditorStore.getState();
						if (state.snapshot.source !== command.source ||
							(restoredState && !state.snapshot.figures.some(figure => figure.id === restoredState.activeFigureId))) return;
						pendingLoad?.();
						pendingLoad = null;
						if (restoredState) {
							state.dispatch({ type: 'SET_ACTIVE_FIGURE', figureId: restoredState.activeFigureId });
							state.dispatch({ type: 'SET_TOOL_MODE', mode: restoredState.tool });
							state.dispatch({ type: 'SET_FREEHAND_INTERPRETATION', enabled: restoredState.interpretGeometry });
							state.dispatch({ type: 'SELECT_RANGE', ids: restoredState.selection });
						}
						postToHost({ event: 'loaded', revision: command.revision });
						reply(command);
					};
					pendingLoad = useEditorStore.subscribe(finishLoad);
					finishLoad();
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
				case 'clipboard-result': {
					const request = clipboardRequests.get(command.targetRequestId);
					if (!request || request.sessionId !== command.sessionId || request.revision !== command.revision) {
						reply(command, 'stale-target'); return;
					}
					clearTimeout(request.timer);
					clipboardRequests.delete(command.targetRequestId);
					if (command.error !== undefined) request.reject(new Error(command.error));
					else request.resolve(command.text ?? '');
					reply(command); return;
				}
				case 'zoom':
					if (command.direction === 'reset') useEditorStore.getState().dispatch({ type: 'REQUEST_ZOOM_SCALE', scale: CANVAS_ZOOM_BASE_SCALE });
					else useEditorStore.getState().dispatch({ type: 'REQUEST_ZOOM', direction: command.direction });
					reply(command); return;
				case 'settings':
					applyHostSettings(command.settings);
					reply(command);
					return;
				case 'display':
					fullscreenRef.current = command.fullscreen;
					setFullscreen(command.fullscreen);
					reply(command);
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
			pendingLoad?.();
			snapshots.dispose();
			cancelClipboardRequests('The editor was disposed.');
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
reloadEditorSettings();

Object.defineProperty(window, 'visualTikzEditorDebug', {
	value: () => {
		const state = useEditorStore.getState();
		return {
			settings: getEditorSettings(),
			source: state.source,
			sourceRevision: state.sourceRevision,
			figureId: state.activeFigureId,
			tool: state.toolMode,
			selection: [...state.selectedElementIds],
			handle: state.activeHandleId,
			viewport: state.canvasTransform,
			pendingRequestId: state.pendingRequestId,
			snapshotSource: state.snapshot.source,
			snapshot: state.snapshot,
			scene: state.snapshot.scene,
			editHandles: state.snapshot.editHandles,
			historyIndex: state.historyIndex,
			historyLength: state.history.length,
			canvasAids: { grid: state.showGrid, rulers: state.showRulers, documentBounds: state.showDocumentBounds },
			snapModes: state.snapModes,
			diagnostics: {
				parse: state.snapshot.parseResult?.diagnostics ?? [],
				semantic: state.snapshot.semanticResult?.diagnostics ?? [],
			},
			featureUsage: state.snapshot.semanticResult?.featureUsage,
			dependencies: state.snapshot.semanticResult?.dependencies,
			unresolvedSymbols: state.snapshot.semanticResult?.unresolvedSymbols,
			symbolDependencyEdges: state.snapshot.semanticResult?.symbolDependencyEdges,
			lastEditWarning: state.lastEditWarningMessage,
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
