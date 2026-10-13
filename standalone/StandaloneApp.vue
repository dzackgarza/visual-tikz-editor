<template>
  <div class="tikz-standalone" :class="theme">
    <header class="document-bar">
      <strong>{{ fileName }}</strong>
      <details class="file-menu">
        <summary>File</summary>
        <div class="file-menu-items">
          <button type="button" :disabled="document === null" @click="newDocument">New tikzpicture or tikzcd…</button>
          <button type="button" :disabled="document === null" @click="openDocument">Open…</button>
          <button type="button" :disabled="document === null || !dirty" @click="save">Save</button>
          <button type="button" :disabled="document === null" @click="saveAs">Save As…</button>
          <button v-if="nativeWindow" type="button" @click="requestExit">Exit</button>
        </div>
      </details>
      <button type="button" :disabled="document === null" @click="copySource">Copy source</button>
      <button type="button" @click="toggleTheme">{{ theme === 'light' ? 'Dark' : 'Light' }} theme</button>
      <span class="tikz-standalone-status" role="status">{{ status }}<template v-if="editorStatus !== ''"> · {{ editorStatus }}</template></span>
    </header>
    <div v-if="unsavedPrompt" class="new-kind-backdrop">
      <div class="new-kind-dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-title" @keydown.esc.stop.prevent="resolveUnsaved('cancel')">
        <h2 id="unsaved-title">Save changes?</h2>
        <p>Save changes to {{ fileName }} before {{ unsavedPrompt }}?</p>
        <div class="unsaved-actions">
          <button type="button" @click="resolveUnsaved('cancel')">Cancel</button>
          <button type="button" @click="resolveUnsaved('discard')">Discard</button>
          <button type="button" autofocus @click="resolveUnsaved('save')">Save</button>
        </div>
      </div>
    </div>
    <div v-if="newKindOpen" class="new-kind-backdrop">
      <div class="new-kind-dialog" role="dialog" aria-modal="true" aria-labelledby="new-kind-title">
        <h2 id="new-kind-title">New tikzpicture or tikzcd</h2>
        <p>Choose a diagram type.</p>
        <div class="new-kind-options">
          <button type="button" @click="createDocument('tikzpicture')">tikzpicture</button>
          <button type="button" @click="createDocument('tikzcd')">tikzcd</button>
        </div>
        <button type="button" class="new-kind-cancel" @click="openDocument">Open existing…</button>
        <button v-if="document?.saved || source !== ''" type="button" class="new-kind-cancel" @click="newKindOpen = false">Cancel</button>
      </div>
    </div>
    <main v-if="document !== null && target !== null && !newKindOpen" class="workspace">
      <nav class="view-rail" aria-label="Left views" :class="{ 'drop-target': dropSide === 'left' }"
        @dragover.prevent="dropSide = 'left'" @dragleave="dropSide = null" @drop.prevent="dropView($event, 'left')">
        <button v-for="view in placements.left" :key="view" type="button" draggable="true"
          :aria-label="`${viewLabels[view]}: left sidebar`" :title="viewLabels[view]"
          :aria-pressed="active.left === view" :class="{ selected: active.left === view }"
          @click="toggleView('left', view)" @dragstart="startDrag($event, view)" @dragend="dropSide = null">
          <span aria-hidden="true">{{ viewIcons[view] }}</span>
        </button>
      </nav>
      <div ref="paneHost" class="pane-host" :class="{ split: bothOpen }"
        :style="bothOpen ? { gridTemplateColumns: `${splitPercent}% 6px minmax(0, 1fr)` } : undefined">
        <div v-if="visited.has('code')" v-show="isVisible('code')" class="view-pane" :style="paneStyle('code')">
          <SourceEditor class="tikz-standalone-source" :source="source" :theme="theme" :selection="sourceSelection" @change="source = $event" />
        </div>
        <div v-for="view in workbenchViews" :key="view" class="view-pane" :class="{ 'pane-hidden': !isVisible(view) }" :style="paneStyle(view)">
          <TikzWorkbench v-if="visited.has(view)" :ref="(handle) => setWorkbench(view, handle)" :key="`${documentKey}-${view}`"
            class="tikz-standalone-workbench" :target="target" :host="host" :theme="theme"
            :show-mode-switcher="false" :show-status="false" :show-fullscreen="false"
            :initial-mode="modeForView(view)" @status="onEditorStatus(view, $event)" />
        </div>
        <div v-if="bothOpen" class="pane-divider" role="separator" aria-label="Resize sidebars"
          aria-orientation="vertical" :aria-valuenow="Math.round(splitPercent)" aria-valuemin="15" aria-valuemax="85"
          tabindex="0" @pointerdown="startResize" @keydown="resizeWithKeyboard" />
      </div>
      <nav class="view-rail right-rail" aria-label="Right views" :class="{ 'drop-target': dropSide === 'right' }"
        @dragover.prevent="dropSide = 'right'" @dragleave="dropSide = null" @drop.prevent="dropView($event, 'right')">
        <button v-for="view in placements.right" :key="view" type="button" draggable="true"
          :aria-label="`${viewLabels[view]}: right sidebar`" :title="viewLabels[view]"
          :aria-pressed="active.right === view" :class="{ selected: active.right === view }"
          @click="toggleView('right', view)" @dragstart="startDrag($event, view)" @dragend="dropSide = null">
          <span aria-hidden="true">{{ viewIcons[view] }}</span>
        </button>
      </nav>
    </main>
    <pre v-else-if="loadError !== ''" class="tikz-standalone-error" role="alert">{{ loadError }}</pre>
  </div>
</template>

<script setup lang="ts">
/**
 * The standalone TikZ workbench for one diagram. The source pane and the
 * workbench edit the same text; the local server owns file operations and
 * serves the pinned editor pages.
 */

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { TikzWorkbenchHost, TikzWorkbenchTheme } from "../src/host";
import type { TikzLivePreviewTarget } from "../src/live-preview";
import type { QuiverMacroProjection } from "../src/quiver-macros";
import { contiguousSourceLineRanges, rawTikzEnvironment } from "../src/source-block";
import type { TikzRenderResult } from "../src/tikz-render";
import type { TikzPreviewModeId } from "../src/preview-modes";
import TikzWorkbench from "../src/ui/TikzWorkbench.vue";
import SourceEditor from "./SourceEditor.vue";

interface StandaloneDocument {
  path: string;
  revision: string;
  saved: boolean;
}

const document = shallowRef<StandaloneDocument | null>(null);
const documentKey = ref(0);
const sourceSelection = ref<{ from: number; to: number } | null>(null);
let preferenceWrite = Promise.resolve();
const preferences: Record<string, string> = {};
function savePreference(key: string, value: string): Promise<void> {
  preferenceWrite = preferenceWrite.then(async () => {
    const response = await fetch("/api/preferences", { method: "PUT", body: JSON.stringify({ key, value }) });
    if (!response.ok) throw new Error(await response.text());
    preferences[key] = value;
  });
  return preferenceWrite;
}
type ViewId = "code" | "preview" | "canvas" | "quiver";
type Side = "left" | "right";
const viewLabels: Record<ViewId, string> = { code: "Code", preview: "Preview", canvas: "Canvas", quiver: "Quiver" };
const viewIcons: Record<ViewId, string> = { code: "</>", preview: "◉", canvas: "◇", quiver: "⤧" };
const workbenchViews: readonly Exclude<ViewId, "code">[] = ["preview", "canvas", "quiver"];
const placements = reactive<Record<Side, ViewId[]>>({ left: ["code"], right: ["preview", "canvas", "quiver"] });
const active = reactive<Record<Side, ViewId | null>>({ left: null, right: "canvas" });
const visited = reactive(new Set<ViewId>());
const newKindOpen = ref(false);
const nativeWindow = isTauri();
const unsavedPrompt = ref<"closing" | "continuing" | null>(null);
let resolvePrompt: ((choice: "save" | "discard" | "cancel") => void) | null = null;
let allowUnload = false;
let unlistenClose: (() => void) | null = null;
const editorStatuses = reactive<Record<Exclude<ViewId, "code">, string>>({ preview: "", canvas: "", quiver: "" });
const editorStatus = computed(() => {
  const visible = active.right ?? active.left;
  return visible === "preview" || visible === "canvas" || visible === "quiver" ? editorStatuses[visible] : "";
});

function onEditorStatus(view: Exclude<ViewId, "code">, value: string): void {
  editorStatuses[view] = value;
}
const dropSide = ref<Side | null>(null);
const paneHost = ref<HTMLElement | null>(null);
const splitPercent = ref(50);
const bothOpen = computed(() => active.left !== null && active.right !== null);

function modeForView(view: Exclude<ViewId, "code">): TikzPreviewModeId {
  return view === "preview" ? "tikz" : view === "canvas" ? "visual" : "quiver";
}

function isVisible(view: ViewId): boolean {
  return active.left === view || active.right === view;
}

function paneStyle(view: ViewId): { gridColumn: string } {
  if (!bothOpen.value) return { gridColumn: "1" };
  return { gridColumn: active.left === view ? "1" : "3" };
}

function toggleView(side: Side, view: ViewId): void {
  active[side] = active[side] === view ? null : view;
  visited.add(view);
}

function startDrag(event: DragEvent, view: ViewId): void {
  event.dataTransfer?.setData("application/x-visual-tikz-view", view);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function dropView(event: DragEvent, destination: Side): void {
  dropSide.value = null;
  const view = event.dataTransfer?.getData("application/x-visual-tikz-view");
  if (view !== "code" && view !== "preview" && view !== "canvas" && view !== "quiver") return;
  const source: Side = placements.left.includes(view) ? "left" : "right";
  if (source === destination) return;
  placements[source].splice(placements[source].indexOf(view), 1);
  placements[destination].push(view);
  if (active[source] === view) active[source] = null;
  active[destination] = view;
  visited.add(view);
}

function setSplit(clientX: number): void {
  const rect = paneHost.value?.getBoundingClientRect();
  if (rect === undefined) return;
  splitPercent.value = Math.max(15, Math.min(85, ((clientX - rect.left) / rect.width) * 100));
}

function startResize(event: PointerEvent): void {
  const separator = event.currentTarget as HTMLElement;
  separator.setPointerCapture(event.pointerId);
  setSplit(event.clientX);
  const move = (moveEvent: PointerEvent): void => setSplit(moveEvent.clientX);
  const stop = (): void => {
    separator.removeEventListener("pointermove", move);
    separator.removeEventListener("pointerup", stop);
    separator.removeEventListener("pointercancel", stop);
  };
  separator.addEventListener("pointermove", move);
  separator.addEventListener("pointerup", stop);
  separator.addEventListener("pointercancel", stop);
}

function resizeWithKeyboard(event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  splitPercent.value = Math.max(15, Math.min(85, splitPercent.value + (event.key === "ArrowLeft" ? -5 : 5)));
}
const source = ref("");
const workbenches = new Map<Exclude<ViewId, "code">, InstanceType<typeof TikzWorkbench>>();
function setWorkbench(view: Exclude<ViewId, "code">, handle: unknown): void {
  if (handle === null) workbenches.delete(view);
  else workbenches.set(view, handle as InstanceType<typeof TikzWorkbench>);
}
async function currentSource(): Promise<string> {
  const view = target.value?.language === "tikzcd" ? "quiver" : "canvas";
  const editor = workbenches.get(view);
  return editor ? await editor.currentSource(new AbortController().signal) : source.value;
}
const savedSource = ref("");
const loadError = ref("");
const hostError = ref("");
const theme = ref<TikzWorkbenchTheme>(
  window.localStorage.getItem("visual-tikz-editor:theme") === "dark" ? "dark" : "light",
);

const dirty = computed(
  () => document.value !== null && (source.value !== savedSource.value || (!document.value.saved && source.value !== "")),
);
const fileName = computed(() => document.value?.path.split("/").pop() ?? "TikZ workbench");
const status = computed(() => {
  if (hostError.value !== "") return hostError.value;
  if (document.value === null) return loadError.value === "" ? "Loading…" : "Load failed";
  if (!document.value.saved)
    return source.value === savedSource.value
      ? `New ${document.value.path.endsWith(".tikzcd") ? "tikzcd" : "tikzpicture"}`
      : "Unsaved changes";
  return dirty.value ? "Unsaved changes" : "Saved";
});

const target = computed<TikzLivePreviewTarget | null>(() => {
  if (document.value === null) return null;
  const text = source.value;
  const tikzcd = document.value.path.endsWith(".tikzcd") || rawTikzEnvironment(text) === "tikzcd";
  return {
    from: 0,
    to: text.length,
    sourceFrom: 0,
    sourceTo: text.length,
    source: text,
    sourceLineRanges: contiguousSourceLineRanges(text, 0),
    kind: "raw",
    language: tikzcd ? "tikzcd" : "tikz",
    docPath: document.value.path,
    authoredSource: text,
  };
});

async function responseText(response: Response): Promise<string> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return text;
}

const host: TikzWorkbenchHost = {
  savePreference,
  ...(nativeWindow ? { clipboard: { readText, writeText } } : {}),
  selectSource: (from, to) => {
    if (isVisible("code")) sourceSelection.value = { from, to };
  },
  readSource: (from, to) => source.value.slice(from, to),
  writeSource: (from, to, insert) => {
    source.value = source.value.slice(0, from) + insert + source.value.slice(to);
  },
  rendering: {
    render: async (request) => {
      const response = await fetch("/api/render", {
        method: "POST",
        body: JSON.stringify(request),
      });
      return JSON.parse(await responseText(response)) as TikzRenderResult;
    },
    figureUrl: (figure) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(figure.svg)}`,
  },
  quiver: {
    macros: async () => {
      const response = await fetch("/api/quiver-macros");
      return JSON.parse(await responseText(response)) as QuiverMacroProjection;
    },
    url: "/quiver/zettlr-host.html",
  },
  imageBaseUrl: () => new URL("/tikz-image/", location.href).href,
  editorUrl: "/tikz-editor/index.html",
  requestSave: () => { void save(); },
  reportError: (message, error) => {
    hostError.value = `${message}: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message, error);
  },
};

function metadata(response: Response): StandaloneDocument {
  const revision = response.headers.get("etag");
  const path = response.headers.get("x-document-path");
  const saved = response.headers.get("x-document-saved");
  if (revision === null || path === null || (saved !== "true" && saved !== "false")) {
    throw new Error("The server answered without document metadata");
  }
  return { path, revision, saved: saved === "true" };
}

async function applyDocument(response: Response): Promise<void> {
  if (response.status === 204) return;
  const text = await responseText(response);
  document.value = metadata(response);
  source.value = text;
  savedSource.value = text;
  sourceSelection.value = null;
  documentKey.value++;
  newKindOpen.value = !document.value.saved && text === "";
  const preferred: ViewId = rawTikzEnvironment(text) === "tikzcd" || document.value.path.endsWith(".tikzcd") ? "quiver" : "canvas";
  visited.clear();
  visited.add(preferred);
  active.left = null;
  active.right = preferred;
  editorStatuses.preview = "";
  editorStatuses.canvas = "";
  editorStatuses.quiver = "";
  hostError.value = "";
}

async function load(): Promise<void> {
  try {
    const response = await fetch("/api/preferences");
    Object.assign(preferences, JSON.parse(await responseText(response)) as Record<string, string>);
    const editorUrl = new URL("/tikz-editor/index.html", window.location.href);
    editorUrl.hash = new URLSearchParams({ storage: JSON.stringify(preferences) }).toString();
    host.editorUrl = editorUrl.href;
    theme.value = preferences["visual-tikz-editor:theme"] === "dark" ? "dark" : "light";
    await applyDocument(await fetch("/api/document"));
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }
}

function resolveUnsaved(choice: "save" | "discard" | "cancel"): void {
  unsavedPrompt.value = null;
  resolvePrompt?.(choice);
  resolvePrompt = null;
}

async function mayLeaveDocument(action: "closing" | "continuing"): Promise<boolean> {
  if (!dirty.value) return true;
  if (unsavedPrompt.value !== null) return false;
  const choice = await new Promise<"save" | "discard" | "cancel">((resolve) => {
    resolvePrompt = resolve;
    unsavedPrompt.value = action;
    void nextTick(() => window.document.querySelector<HTMLButtonElement>(".unsaved-actions button:last-child")?.focus());
  });
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  return await save() && !dirty.value;
}

async function requestExit(): Promise<void> {
  await preferenceWrite;
  if (nativeWindow) await getCurrentWindow().close();
}

async function newDocument(): Promise<void> {
  if (!await mayLeaveDocument("continuing")) return;
  newKindOpen.value = true;
}

async function createDocument(kind: "tikzpicture" | "tikzcd"): Promise<void> {
  try {
    await applyDocument(await fetch("/api/new", { method: "POST", body: kind }));
    newKindOpen.value = false;
  } catch (error) {
    host.reportError("Could not create a diagram", error);
  }
}

async function openDocument(): Promise<void> {
  if (!await mayLeaveDocument("continuing")) return;
  try {
    const response = await fetch("/api/open", { method: "POST" });
    await applyDocument(response);
    if (response.status !== 204) newKindOpen.value = false;
  } catch (error) {
    host.reportError("Could not open a diagram", error);
  }
}

async function saveAs(): Promise<boolean> {
  try {
    const text = await currentSource();
    const response = await fetch("/api/save-as", { method: "POST", body: text });
    if (response.status === 204) return false;
    await responseText(response);
    document.value = metadata(response);
    savedSource.value = text;
    hostError.value = "";
    return true;
  } catch (error) {
    host.reportError("Could not save the diagram", error);
    return false;
  }
}

async function save(): Promise<boolean> {
  const current = document.value;
  if (current === null) return false;
  if (!current.saved) return await saveAs();
  try {
    const text = await currentSource();
    const response = await fetch("/api/document", {
      method: "PUT",
      headers: { "if-match": current.revision },
      body: text,
    });
    await responseText(response);
    const revision = response.headers.get("etag");
    if (revision === null) throw new Error("The server saved the file without a new revision");
    document.value = { ...current, revision };
    savedSource.value = text;
    hostError.value = "";
    return true;
  } catch (error) {
    host.reportError("Could not save the file", error);
    return false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && !event.altKey &&
      (event.key === "-" || event.key === "=" || event.key === "+" || event.key === "0")) {
    if (isVisible("canvas")) {
      event.preventDefault();
      workbenches.get("canvas")?.zoom(event.key === "0" ? "reset" : event.key === "-" ? "out" : "in");
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "s") {
    event.preventDefault();
    void save();
  }
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (allowUnload || !dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}

function toggleTheme(): void {
  theme.value = theme.value === "light" ? "dark" : "light";
  void savePreference("visual-tikz-editor:theme", theme.value)
    .catch(error => host.reportError("Could not save the theme", error));
}



async function copySource(): Promise<void> {
  try {
    const text = await currentSource();
    if (host.clipboard) await host.clipboard.writeText(text);
    else await navigator.clipboard.writeText(text);
    hostError.value = "";
  } catch (error) {
    host.reportError("Could not copy source", error);
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", onBeforeUnload);
  if (nativeWindow) {
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void preferenceWrite.then(() => mayLeaveDocument("closing")).then(async (leave) => {
        if (!leave) return;
        allowUnload = true;
        try {
          await getCurrentWindow().destroy();
        } catch (error) {
          allowUnload = false;
          host.reportError("Could not close the window", error);
        }
      }).catch(error => host.reportError("Could not finish saving before closing", error));
    }).then((unlisten) => { unlistenClose = unlisten; }).catch((error) => {
      host.reportError("Could not guard unsaved changes", error);
    });
  }
  void load();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", onBeforeUnload);
  unlistenClose?.();
  resolveUnsaved("cancel");
});
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}
</style>

<style scoped>
.tikz-standalone {
  --board: #daddd5;
  --leaf: #eef0ea;
  --ink: #1c2430;
  --graphite: #555d67;
  --ribbon: #9e2a2b;
  --paper: #fbfaf6;
  display: flex;
  flex-direction: column;
  height: 100%;
  font: 16px system-ui, sans-serif;
  color: var(--ink);
  background: var(--board);
}

.tikz-standalone.dark {
  --board: #252c34;
  --leaf: #313b45;
  --ink: #f3f2ed;
  --graphite: #d1d5d8;
  --ribbon: #ef9b9c;
  --paper: #1d242b;
}

.document-bar {
  position: relative;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
  border-radius: 14px;
  background: var(--leaf);
  box-shadow: 0 3px 12px color-mix(in srgb, var(--ink) 15%, transparent);
}

.document-bar strong {
  margin-right: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.document-views {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  padding: 2px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--ink) 7%, transparent);
}

.document-views :deep(.p-button) {
  min-height: 40px;
  padding-inline: 10px;
  font-size: 14px;
}

.document-views :deep(.p-button:disabled) { display: none; }

.document-views :deep(.p-button.p-button-primary) {
  background: var(--ribbon);
  color: #fff;
}

.document-bar button,
.file-menu summary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--ink) 20%, transparent);
  border-radius: 9px;
  color: var(--ink);
  background: var(--paper);
  font: inherit;
  cursor: pointer;
}

.file-menu summary {
  list-style: none;
}

.file-menu summary::-webkit-details-marker {
  display: none;
}

.file-menu-items {
  position: absolute;
  top: calc(100% - 4px);
  right: 12px;
  display: grid;
  gap: 6px;
  min-width: 180px;
  padding: 8px;
  border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
  border-radius: 12px;
  background: var(--leaf);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--ink) 20%, transparent);
}

.file-menu-items button {
  justify-content: flex-start;
}

.document-bar button[aria-pressed="true"] {
  border-color: var(--ribbon);
  color: var(--ribbon);
}

.document-bar button:disabled {
  opacity: 0.45;
  cursor: default;
}

.tikz-standalone-status {
  flex: 0 1 auto;
  color: var(--graphite);
  overflow-wrap: anywhere;
}

.new-kind-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--ink) 38%, transparent);
}

.new-kind-dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 24px;
  border: 1px solid color-mix(in srgb, var(--ink) 20%, transparent);
  border-radius: 16px;
  background: var(--paper);
  box-shadow: 0 16px 48px color-mix(in srgb, var(--ink) 30%, transparent);
}

.new-kind-dialog h2 { margin: 0 0 8px; font-size: 20px; }
.new-kind-dialog p { margin: 0 0 20px; color: var(--graphite); }
.new-kind-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.new-kind-dialog button { min-height: 56px; border: 1px solid var(--ribbon); border-radius: 10px; color: var(--ink); background: var(--leaf); font: inherit; cursor: pointer; }
.new-kind-dialog button:hover, .new-kind-dialog button:focus-visible { background: color-mix(in srgb, var(--ribbon) 15%, var(--leaf)); }
.new-kind-dialog .new-kind-cancel { display: block; width: 100%; min-height: 40px; margin-top: 12px; border-color: color-mix(in srgb, var(--ink) 18%, transparent); }
.unsaved-actions { display: flex; justify-content: flex-end; gap: 8px; }
.unsaved-actions button { min-height: 44px; padding: 0 14px; }

.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 56px;
}

.view-rail {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  padding: 8px 5px;
  border-right: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
  background: var(--leaf);
}

.right-rail {
  border-right: 0;
  border-left: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
}

.view-rail.drop-target { background: color-mix(in srgb, var(--ribbon) 20%, var(--leaf)); }

.view-rail button {
  display: grid;
  place-items: center;
  height: 46px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--graphite);
  font: 700 19px system-ui, sans-serif;
  cursor: grab;
}

.view-rail button:hover, .view-rail button:focus-visible {
  background: color-mix(in srgb, var(--ribbon) 12%, var(--leaf));
}

.view-rail button.selected {
  color: var(--ribbon);
  background: var(--paper);
  box-shadow: inset 3px 0 var(--ribbon);
}

.right-rail button.selected { box-shadow: inset -3px 0 var(--ribbon); }

.pane-host {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: var(--paper);
}

.view-pane {
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.view-pane > * { width: 100%; height: 100%; }

.view-pane.pane-hidden { visibility: hidden; pointer-events: none; }

.pane-divider {
  grid-column: 2;
  grid-row: 1;
  z-index: 2;
  background: color-mix(in srgb, var(--ink) 18%, var(--leaf));
  cursor: col-resize;
  touch-action: none;
}

.pane-divider:hover, .pane-divider:focus-visible { background: var(--ribbon); }

.tikz-standalone-source {
  background: var(--paper);
}

.tikz-standalone-error {
  margin: 1rem;
  white-space: pre-wrap;
  color: #c0392b;
}

@media (max-width: 900px) {
  .document-bar {
    gap: 6px;
  }

  .document-bar strong {
    max-width: 25vw;
    font-size: 14px;
  }

  .document-bar button,
  .file-menu summary {
    padding: 0 8px;
    font-size: 14px;
  }

  .tikz-standalone-status {
    display: none;
  }

}
</style>
