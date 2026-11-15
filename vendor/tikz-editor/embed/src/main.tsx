import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { setActiveEditorPlatform } from '@tikz-editor/app/platform/current';
import { useEditorStore } from '@tikz-editor/app/store';
import { PRINTED_SIZE_SCALE, getEditorSettings, publishOccupiedInsets, reloadEditorSettings, replaceSource } from '@tikz-editor/app';
import type { EditorPlatform } from '@tikz-editor/app/platform/types';
import type { DocumentFileRef } from '@tikz-editor/app/store/types';
import { markClosingPress } from '@tikz-editor/app/closing-press';
import './styles.css';
import { commandIdentitySchema, hostCommandSchema, type HostCommand } from './commands';
import { createSnapshotRequests, editorState } from './snapshots';
import { FRAME_PROTOCOL_VERSION, type CommandFailure } from './events';
import { keepFocusAtButtonPress } from './button-focus';
import { parseTikzForEdit } from 'tikz-editor/edit/parse-options';
import { walkStatements } from 'tikz-editor/ast/walk';

const App = lazy(async () => {
	const mod = await import('@tikz-editor/app');
	return { default: mod.App };
});
const SettingsWindow = lazy(async () => {
	const mod = await import('@tikz-editor/app');
	return { default: mod.SettingsWindow };
});

const WORKSPACE_KEY = 'tikz-editor:workspace';
const SETTINGS_KEY = 'tikz-editor:settings';
const STORAGE_HASH_KEY = 'storage';
const TEXT_FILE_ACCEPT = '.tex,.tikz,.pgf,.svg,.ipe,text/plain,text/x-tex,text/xml,application/xml,image/svg+xml';
const DEFAULT_SOURCE = String.raw`\begin{tikzpicture}
  \draw[thick, blue] (0,0) circle (1cm);
  \node at (0,0) {TikZ};
\end{tikzpicture}
`;

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
			saveText: async (_text, options) => {
				currentFileName = options?.suggestedName ?? options?.fileRef?.name ?? currentFileName;
				postToHost({ event: 'save', revision: currentHostRevision });
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
	const store = useEditorStore.getState();
	store.dispatch({ type: 'CODE_EDITED', source });
	store.dispatch({ type: 'MARK_DOCUMENT_SAVED', fileRef: makeFileRef(fileName), lastKnownDiskSource: source });
}

function HostBridge() {
	const [fullscreen, setFullscreen] = useState(false);
	const fullscreenRef = useRef(false);
	const previousRenderRef = useRef(-1);

	useEffect(() => {
		const pendingCommands = new Map<string, { command: HostCommand; timer: number }>();
		let pendingLoad: (() => void) | null = null;
		const snapshots = createSnapshotRequests(reply => postToHost({ ...reply }), () => imageBaseUrl);
		postToHost({ event: 'init', version: FRAME_PROTOCOL_VERSION });
		useEditorStore.getState().dispatch({ type: 'SET_TOOL_MODE', mode: 'addFreehand' });

		// The store records one step per edit and merges the frames of one gesture into it, so
		// each new or merged step is one `change`, and changes with the same `step` are one
		// gesture. A preview, a load, and a `replace-source` record no step and post nothing.
		let previousStep = useEditorStore.getState().lastStep;
		let previousSelection = '';
		let previousSelectionEmpty: boolean | null = null;
		// The selection that the last `replace-source` made; it stays out of the Code panel's cursor.
		let hostSelection: ReadonlySet<string> | null = null;
		// The settled view of the loaded file goes to the shell, which reopens the file at it.
		let loadedRevision = -1;
		let previousView = '';
		const reportView = (state: ReturnType<typeof useEditorStore.getState>) => {
			if (loadedRevision !== currentHostRevision || state.activeFigureId === null || state.pendingViewportRestore !== null ||
				state.pendingRequestId !== null || state.snapshot.source !== state.source ||
				state.snapshot.activeFigureId !== state.activeFigureId) return;
			const view = editorState(state, state.activeFigureId);
			if (view === null) return;
			const serialized = JSON.stringify(view);
			if (serialized === previousView) return;
			previousView = serialized;
			postToHost({ event: 'view-state', state: view });
		};
		const unsubscribe = useEditorStore.subscribe((state) => {
			// The change goes first: the shell takes a selection only in the source it already has.
			if (state.lastStep !== previousStep) {
				previousStep = state.lastStep;
				if (state.lastStep !== null) postToHost({ event: 'change', revision: currentHostRevision, source: state.source, sourceRevision: state.sourceRevision, step: state.historyStep });
			}
			const selectionEmpty = state.selectedElementIds.size === 0 && state.activeHandleId === null;
			if (selectionEmpty !== previousSelectionEmpty) {
				previousSelectionEmpty = selectionEmpty;
				postToHost({ event: 'selection', empty: selectionEmpty });
			}
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
						if (state.selectedElementIds !== hostSelection || handle) postToHost({ event: 'source-selection', source: state.source, from, to });
					}
				} else previousSelection = '';
			}
			if (state.snapshot.source === state.source && state.pendingRequestId === null &&
				state.snapshot.svg !== null && state.snapshot.revision !== previousRenderRef.current) {
				previousRenderRef.current = state.snapshot.revision;
				postToHost({ event: 'rendered', sourceRevision: state.sourceRevision });
			}
			reportView(state);
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

		let hostPopoverOpen = false;
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
				case 'replace-source':
					replaceSource({ source: command.source, changed: command.changed });
					// The shell made this selection; it does not go back to the Code panel's cursor.
					hostSelection = useEditorStore.getState().selectedElementIds;
					reply(command);
					return;
				case 'load': {
					// A file edited outside the editor may no longer hold the figure of its kept
					// view; it then opens as a file without one.
					const keptState = command.state;
					const restoredState = keptState && parseTikzForEdit(command.source, { activeFigureId: keptState.activeFigureId })
						.figures.some(figure => figure.id === keptState.activeFigureId) ? keptState : undefined;
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
					useEditorStore.getState().dispatch({ type: 'RESTORE_CANVAS_VIEWPORT', restore: restoredState ? { source: command.source, view: restoredState.viewport, fitToContent: restoredState.fitToContent } : null });
					loadIntoEditor(command.source, command.fileName);
					const finishLoad = () => {
						const state = useEditorStore.getState();
						if (state.snapshot.source !== command.source ||
							(restoredState && !state.snapshot.figures.some(figure => figure.id === restoredState.activeFigureId))) return;
						pendingLoad?.();
						pendingLoad = null;
						// A file without a kept view opens with every layer shown and unlocked.
						state.dispatch(restoredState
							? { type: 'RESTORE_STATEMENT_MARKS', locked: restoredState.locked, hidden: restoredState.hidden }
							: { type: 'RESTORE_STATEMENT_MARKS', locked: [], hidden: [] });
						if (restoredState) {
							state.dispatch({ type: 'SET_ACTIVE_FIGURE', figureId: restoredState.activeFigureId });
							state.dispatch({ type: 'SET_TOOL_MODE', mode: restoredState.tool });
							state.dispatch({ type: 'SELECT_RANGE', ids: restoredState.selection });
						}
						postToHost({ event: 'loaded', revision: command.revision });
						reply(command);
						loadedRevision = command.revision;
						previousView = '';
						reportView(useEditorStore.getState());
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
				case 'keyboard':
					publishOccupiedInsets({ '--keyboard-inset-bottom': command.bottom });
					reply(command); return;
				case 'zoom': {
					const dispatch = useEditorStore.getState().dispatch;
					if (command.factor !== undefined && command.at !== undefined) {
						// The canvas zooms about the pointer at a wheel event with Ctrl, by exp(-deltaY × zoom speed).
						// This is that event for the factor, so one rule places the view for the wheel and for the pinch.
						const viewport = document.querySelector<HTMLElement>('[data-canvas-viewport="true"]');
						if (!viewport) { reply(command, 'busy'); return; }
						viewport.dispatchEvent(new WheelEvent('wheel', {
							deltaY: -Math.log(command.factor) / getEditorSettings().canvas.zoomSpeed, ctrlKey: true,
							clientX: command.at.x, clientY: command.at.y, bubbles: true, cancelable: true,
						}));
					}
					else if (command.scale !== undefined) dispatch({ type: 'REQUEST_ZOOM_SCALE', scale: command.scale * PRINTED_SIZE_SCALE });
					else if (command.direction === 'normal') dispatch({ type: 'REQUEST_ZOOM_SCALE', scale: PRINTED_SIZE_SCALE });
					else if (command.direction === 'fit') dispatch({ type: 'REQUEST_FIT_TO_CONTENT' });
					else if (command.direction === 'in' || command.direction === 'out') dispatch({ type: 'REQUEST_ZOOM', direction: command.direction });
					else { reply(command, 'invalid-command'); return; }
					reply(command); return;
				}
				case 'display':
					fullscreenRef.current = command.fullscreen;
					setFullscreen(command.fullscreen);
					reply(command);
					return;
				case 'panel':
					document.documentElement.dataset.embedPanel = command.panel ?? '';
					window.dispatchEvent(new Event('tikz-embed-panel'));
					reply(command);
					return;
				case 'dismiss-popover':
					window.dispatchEvent(new Event('tikz-embed-dismiss-popover'));
					reply(command);
					return;
				case 'host-popover':
					hostPopoverOpen = command.open;
					reply(command);
					return;
			}
		};

		// While a menu of the shell is open, the next press here closes it and does nothing else:
		// the canvas gives a closing press no other effect, as for a popup of its own.
		const closeHostPopoverByPress = (event: PointerEvent) => {
			if (!hostPopoverOpen) return;
			hostPopoverOpen = false;
			markClosingPress(event);
			postToHost({ event: 'host-popover-dismissed' });
		};

		const handleKeydown = (event: KeyboardEvent) => {
			// An open dialog takes Escape first (WAI-ARIA APG, Dialog (Modal) pattern).
			if (event.key !== 'Escape' || !fullscreenRef.current || document.querySelector('dialog[open]')) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			postToHost({ event: 'close-request' });
		};

		// The fork reports these gestures as window events; the shell owns what they act on.
		const panelChanged = () => postToHost({ event: 'panel', panel: document.documentElement.dataset.embedPanel || null });
		const undoRequested = () => postToHost({ event: 'undo-request' });
		const redoRequested = () => postToHost({ event: 'redo-request' });
		const popoverOpened = () => postToHost({ event: 'popover-opened' });
		const settingsRequested = () => postToHost({ event: 'settings-request' });
		const forkEvents: [string, () => void][] = [
			['tikz-embed-panel-changed', panelChanged],
			['tikz-embed-undo-request', undoRequested],
			['tikz-embed-redo-request', redoRequested],
			['tikz-embed-popover-opened', popoverOpened],
			['tikz-embed-settings-request', settingsRequested],
		];
		for (const [name, listener] of forkEvents) window.addEventListener(name, listener);
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
		window.addEventListener('pointerdown', closeHostPopoverByPress, true);
		window.addEventListener('mousedown', keepFocusAtButtonPress, true);
		window.addEventListener('keydown', handleKeydown, true);
		return () => {
			pendingLoad?.();
			snapshots.dispose();
			cancelClipboardRequests('The editor was disposed.');
			for (const pending of pendingCommands.values()) window.clearTimeout(pending.timer);
			pendingCommands.clear();
			imageObserver.disconnect();
			unsubscribe();
			for (const [name, listener] of forkEvents) window.removeEventListener(name, listener);
			window.removeEventListener('message', handleMessage);
			window.removeEventListener('pointerdown', closeHostPopoverByPress, true);
			window.removeEventListener('mousedown', keepFocusAtButtonPress, true);
			window.removeEventListener('keydown', handleKeydown, true);
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
// The Settings window is its own frame; its changes reach the open editor frames through
// the storage they share.
window.addEventListener('storage', (event) => {
	if (event.key !== SETTINGS_KEY || event.newValue === null) return;
	persistenceValues.set(SETTINGS_KEY, event.newValue);
	reloadEditorSettings();
});

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
			lastStep: state.lastStep,
			historyStep: state.historyStep,
			canvasAids: { grid: state.showGrid, rulers: state.showRulers, documentBounds: state.showDocumentBounds },
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

// `view=settings` opens the Settings window alone, over another editor of the host.
const settingsView = new URLSearchParams(window.location.hash.slice(1)).get('view') === 'settings';
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		{settingsView ? (
			<Suspense fallback={null}>
				<SettingsWindow onClose={() => postToHost({ event: 'settings-closed' })} />
			</Suspense>
		) : (
			<>
				<HostBridge />
				<Suspense fallback={null}>
					<App />
				</Suspense>
			</>
		)}
	</StrictMode>,
);
