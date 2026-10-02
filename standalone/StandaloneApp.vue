<template>
  <div class="tikz-standalone" :class="theme">
    <header>
      <strong>{{ fileName }}</strong>
      <button type="button" :disabled="document === null" @click="newDocument">New</button>
      <button type="button" :disabled="document === null" @click="openDocument">Open…</button>
      <button type="button" :disabled="document === null || !dirty" @click="save">Save</button>
      <button type="button" :disabled="document === null" @click="saveAs">Save As…</button>
      <span class="tikz-standalone-status" role="status">{{ status }}</span>
    </header>
    <main v-if="document !== null && target !== null" :class="{ 'visual-mode': mode === 'visual' }">
      <SourceEditor
        v-show="mode !== 'visual'"
        class="tikz-standalone-source"
        :source="source"
        :theme="theme"
        @change="source = $event"
      />
      <TikzWorkbench
        :key="documentKey"
        class="tikz-standalone-workbench"
        :target="target"
        :host="host"
        :theme="theme"
        :initial-mode="target.language === 'tikzcd' ? 'quiver' : 'visual'"
        @mode="mode = $event"
      />
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

import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { TikzWorkbenchHost, TikzWorkbenchTheme } from "../src/host";
import type { TikzLivePreviewTarget } from "../src/live-preview";
import type { TikzPreviewModeId } from "../src/preview-modes";
import type { QuiverMacroProjection } from "../src/quiver-macros";
import { contiguousSourceLineRanges, rawTikzEnvironment } from "../src/source-block";
import type { TikzRenderResult } from "../src/tikz-render";
import TikzWorkbench from "../src/ui/TikzWorkbench.vue";
import SourceEditor from "./SourceEditor.vue";

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
// The visual editor has its own source pane, so the page hides its own in that mode.
const mode = ref<TikzPreviewModeId>("visual");
const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const theme = ref<TikzWorkbenchTheme>(darkScheme.matches ? "dark" : "light");

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
  render: async (request) => {
    const response = await fetch("/api/render", { method: "POST", body: JSON.stringify(request) });
    return JSON.parse(await responseText(response)) as TikzRenderResult;
  },
  quiverMacros: async () => {
    const response = await fetch("/api/quiver-macros");
    return JSON.parse(await responseText(response)) as QuiverMacroProjection;
  },
  figureUrl: (figure) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(figure.svg)}`,
  imageBaseUrl: () => new URL("/tikz-image/", location.href).href,
  editorUrl: "/tikz-editor/index.html",
  quiverUrl: "/quiver/zettlr-host.html",
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

function onSchemeChange(event: MediaQueryListEvent): void {
  theme.value = event.matches ? "dark" : "light";
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", onBeforeUnload);
  darkScheme.addEventListener("change", onSchemeChange);
  void load();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", onBeforeUnload);
  darkScheme.removeEventListener("change", onSchemeChange);
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
  display: flex;
  flex-direction: column;
  height: 100%;
  font: 14px system-ui, sans-serif;
  color: #222;
  background: #fff;
}

.tikz-standalone.dark {
  color: #eee;
  background: #1e1e1e;
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  padding: 0.4rem 1rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent);
}

.tikz-standalone-status {
  opacity: 0.7;
  overflow-wrap: anywhere;
}

main {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
}

main.visual-mode {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

.tikz-standalone-source {
  border-right: 1px solid color-mix(in srgb, currentColor 20%, transparent);
}

.tikz-standalone-error {
  margin: 1rem;
  white-space: pre-wrap;
  color: #c0392b;
}

@media (max-width: 800px) {
  main {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
