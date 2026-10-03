<template>
  <div class="tikz-standalone" :class="theme">
    <header class="document-bar">
      <strong>{{ fileName }}</strong>
      <div class="document-views" role="group" aria-label="Diagram view">
        <Button label="Render" text :disabled="target?.language !== 'tikz'" :severity="activeMode === 'tikz' ? 'primary' : 'secondary'" @click="activeMode = 'tikz'" />
        <Button label="Quiver" text :disabled="target?.language !== 'tikzcd'" :severity="activeMode === 'quiver' ? 'primary' : 'secondary'" @click="activeMode = 'quiver'" />
        <Button label="Draw" text :disabled="target?.language !== 'tikz'" :severity="activeMode === 'visual' ? 'primary' : 'secondary'" @click="activeMode = 'visual'" />
      </div>
      <Button label="File" icon="pi pi-folder" text aria-haspopup="true" aria-controls="file-menu" @click="toggleFileMenu" />
      <Menu id="file-menu" ref="fileMenu" :model="fileItems" popup />
      <button type="button" :aria-pressed="inspectorOpen" @click="toggleInspector">
        {{ inspectorOpen ? 'Hide properties' : 'Properties' }}
      </button>
      <button type="button" @click="toggleTheme">{{ theme === 'light' ? 'Dark' : 'Light' }} theme</button>
      <span class="tikz-standalone-status" role="status">{{ status }}</span>
    </header>
    <Splitter v-if="document !== null && target !== null" class="workspace-splitter" layout="horizontal">
      <SplitterPanel :size="40" :min-size="25">
        <SourceEditor class="tikz-standalone-source" :source="source" :theme="theme" @change="source = $event" />
      </SplitterPanel>
      <SplitterPanel :size="60" :min-size="35">
        <TikzWorkbench
          :key="documentKey"
          class="tikz-standalone-workbench"
          :target="target"
          :host="host"
          :theme="theme"
          :show-inspector="inspectorOpen"
          :show-header="false"
          :initial-mode="target.language === 'tikzcd' ? 'quiver' : 'visual'"
          :requested-mode="activeMode"
          @mode="activeMode = $event"
          @inspector-closed="inspectorOpen = false"
        />
      </SplitterPanel>
    </Splitter>
    <pre v-else-if="loadError !== ''" class="tikz-standalone-error" role="alert">{{ loadError }}</pre>
  </div>
</template>

<script setup lang="ts">
/**
 * The standalone TikZ workbench for one diagram. The source pane and the
 * workbench edit the same text; the local server owns file operations and
 * serves the pinned editor pages.
 */

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { TikzWorkbenchHost, TikzWorkbenchTheme } from "../src/host";
import type { TikzLivePreviewTarget } from "../src/live-preview";
import type { QuiverMacroProjection } from "../src/quiver-macros";
import { contiguousSourceLineRanges, rawTikzEnvironment } from "../src/source-block";
import type { TikzRenderResult } from "../src/tikz-render";
import type { TikzPreviewModeId } from "../src/preview-modes";
import TikzWorkbench from "../src/ui/TikzWorkbench.vue";
import SourceEditor from "./SourceEditor.vue";
import Button from "primevue/button";
import Menu from "primevue/menu";
import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";

interface StandaloneDocument {
  path: string;
  revision: string;
  saved: boolean;
}

const document = shallowRef<StandaloneDocument | null>(null);
const documentKey = ref(0);
const source = ref("");
const savedSource = ref("");
const loadError = ref("");
const hostError = ref("");
const inspectorOpen = ref(false);
const activeMode = ref<TikzPreviewModeId>("visual");
const fileMenu = ref<InstanceType<typeof Menu> | null>(null);
const fileItems = computed(() => [
  { label: "New diagram", disabled: document.value === null, command: newDocument },
  { label: "Open…", disabled: document.value === null, command: openDocument },
  { separator: true },
  { label: "Save", disabled: document.value === null || !dirty.value, command: save },
  { label: "Save As…", disabled: document.value === null, command: saveAs },
]);
function toggleFileMenu(event: Event): void {
  fileMenu.value?.toggle(event);
}
const theme = ref<TikzWorkbenchTheme>(
  window.localStorage.getItem("visual-tikz-editor:theme") === "dark" ? "dark" : "light",
);

const dirty = computed(
  () => document.value !== null && (!document.value.saved || source.value !== savedSource.value),
);
const fileName = computed(() => document.value?.path.split("/").pop() ?? "TikZ workbench");
const status = computed(() => {
  if (hostError.value !== "") return hostError.value;
  if (document.value === null) return loadError.value === "" ? "Loading…" : "Load failed";
  if (!document.value.saved)
    return source.value === savedSource.value ? "New diagram" : "Unsaved changes";
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

watch(() => target.value?.language, (language) => {
  if (language === "tikzcd") activeMode.value = "quiver";
  if (language === "tikz" && activeMode.value === "quiver") activeMode.value = "visual";
});

async function responseText(response: Response): Promise<string> {
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text}`);
  return text;
}

const host: TikzWorkbenchHost = {
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
  activeMode.value = document.value.path.endsWith(".tikzcd") || rawTikzEnvironment(text) === "tikzcd" ? "quiver" : "visual";
  savedSource.value = text;
  documentKey.value++;
  hostError.value = "";
}

async function load(): Promise<void> {
  try {
    await applyDocument(await fetch("/api/document"));
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  }
}

function mayReplaceDocument(): boolean {
  return source.value === savedSource.value || window.confirm("Discard unsaved changes?");
}

async function newDocument(): Promise<void> {
  if (!mayReplaceDocument()) return;
  try {
    await applyDocument(await fetch("/api/new", { method: "POST" }));
  } catch (error) {
    host.reportError("Could not create a diagram", error);
  }
}

async function openDocument(): Promise<void> {
  if (!mayReplaceDocument()) return;
  try {
    await applyDocument(await fetch("/api/open", { method: "POST" }));
  } catch (error) {
    host.reportError("Could not open a diagram", error);
  }
}

async function saveAs(): Promise<void> {
  const text = source.value;
  try {
    const response = await fetch("/api/save-as", { method: "POST", body: text });
    if (response.status === 204) return;
    await responseText(response);
    document.value = metadata(response);
    savedSource.value = text;
    hostError.value = "";
  } catch (error) {
    host.reportError("Could not save the diagram", error);
  }
}

async function save(): Promise<void> {
  const current = document.value;
  if (current === null) return;
  if (!current.saved) return await saveAs();
  const text = source.value;
  try {
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
  } catch (error) {
    host.reportError("Could not save the file", error);
  }
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === "s") {
    event.preventDefault();
    void save();
  }
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (source.value === savedSource.value) return;
  event.preventDefault();
}

function toggleTheme(): void {
  theme.value = theme.value === "light" ? "dark" : "light";
  window.localStorage.setItem("visual-tikz-editor:theme", theme.value);
}

function toggleInspector(): void {
  inspectorOpen.value = !inspectorOpen.value;
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", onBeforeUnload);
  void load();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", onBeforeUnload);
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
  flex-wrap: nowrap;
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

.workspace-splitter {
  flex: 1 1 auto;
  min-height: 0;
  border: 0;
}

.workspace-splitter :deep(.p-splitterpanel) {
  min-width: 0;
  min-height: 0;
}

.tikz-standalone-source {
  height: 100%;
  border-right: 1px solid color-mix(in srgb, currentColor 20%, transparent);
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
