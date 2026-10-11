<template>
  <label>Host document<textarea aria-label="Host document" v-model="source" :readonly="readOnly" /></label>
  <label><input type="checkbox" v-model="readOnly">Read-only document</label>
  <output aria-label="Persisted document">{{ persisted }}</output>
  <output aria-label="Host error">{{ error }}</output>
  <TikzWorkbench :target="target" :host="host" theme="light" initial-mode="quiver" />
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import TikzWorkbench from '../src/ui/TikzWorkbench.vue';
import type { TikzWorkbenchHost } from '../src/host';
import type { TikzLivePreviewTarget } from '../src/live-preview';
import { contiguousSourceLineRanges } from '../src/source-block';
const source = ref(String.raw`\begin{tikzcd}A \arrow[r, "f"] & B\end{tikzcd}`);
const persisted = ref(localStorage.getItem('embedded-diagram') ?? '');
const error = ref('');
const readOnly = ref(false);
const target = computed<TikzLivePreviewTarget>(() => ({
  from: 0, to: source.value.length, sourceFrom: 0, sourceTo: source.value.length,
  source: source.value, authoredSource: source.value,
  sourceLineRanges: contiguousSourceLineRanges(source.value, 0),
  kind: 'raw', language: 'tikzcd', docPath: 'embedded.tikzcd',
}));
const host: TikzWorkbenchHost = {
  readSource: (from, to) => source.value.slice(from, to),
  writeSource: (from, to, insert) => {
    if (readOnly.value) throw new Error('The document is read-only');
    source.value = source.value.slice(0, from) + insert + source.value.slice(to); },
  requestSave: () => {
    localStorage.setItem('embedded-diagram', source.value);
    persisted.value = localStorage.getItem('embedded-diagram')!;
  },
  reportError: (message, cause) => { error.value = `${message}: ${String(cause)}`; },
  quiver: { url: '/quiver/zettlr-host.html', macros: async () => (await fetch('/api/quiver-macros')).json() },
  imageBaseUrl: () => location.origin,
  editorUrl: '/tikz-editor/index.html',
};
</script>
<style>body{margin:0}#app{height:100vh;display:flex;flex-direction:column}textarea{width:95%;height:65px}output{white-space:pre-wrap}</style>
