<template>
  <div class="hosted-workbench">
    <template v-if="sessionId !== '' && target !== null">
      <header>
        <strong>{{ fileName }}</strong>
        <button type="button" :aria-pressed="sourceOpen" @click="sourceOpen = !sourceOpen">
          {{ sourceOpen ? 'Hide source' : 'Edit source' }}
        </button>
        <button type="button" :aria-pressed="inspectorOpen" @click="inspectorOpen = !inspectorOpen">
          {{ inspectorOpen ? 'Hide properties' : 'Properties' }}
        </button>
        <span role="status">{{ error === '' ? 'Synced' : error }}</span>
      </header>
      <main>
        <SourceEditor v-if="sourceOpen" class="source" :source="source" theme="light"
          @change="source = $event" />
        <TikzWorkbench ref="workbench" class="canvas" :target="target" :host="host"
          theme="light" initial-mode="visual" :show-inspector="inspectorOpen"
          :show-header="false" @inspector-closed="inspectorOpen = false" />
      </main>
    </template>
    <div v-else class="loading" role="status">Loading figure…</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { hostCommandSchema } from '../vendor/tikz-editor/embed/src/commands';
import type { TikzWorkbenchHost } from '../src/host';
import type { TikzLivePreviewTarget } from '../src/live-preview';
import { contiguousSourceLineRanges } from '../src/source-block';
import TikzWorkbench from '../src/ui/TikzWorkbench.vue';
import SourceEditor from './SourceEditor.vue';

const source = ref('');
const fileName = ref('diagram.tikz');
const sessionId = ref('');
const revision = ref(0);
const sourceRevision = ref(0);
const sourceOpen = ref(false);
const inspectorOpen = ref(false);
const error = ref('');
const workbench = ref<InstanceType<typeof TikzWorkbench> | null>(null);
let loaded = false;
const parentOrigin = document.referrer ? new URL(document.referrer).origin : location.origin;

function post(message: Record<string, unknown>): void {
  if (window.parent === window) return;
  window.parent.postMessage(JSON.stringify({ sessionId: sessionId.value, revision: revision.value, ...message }), parentOrigin);
}

const target = computed<TikzLivePreviewTarget | null>(() => sessionId.value === '' ? null : {
  from: 0, to: source.value.length,
  sourceFrom: 0, sourceTo: source.value.length,
  source: source.value,
  sourceLineRanges: contiguousSourceLineRanges(source.value, 0),
  kind: 'raw', language: 'tikz', docPath: fileName.value,
  authoredSource: source.value,
});

const host: TikzWorkbenchHost = {
  readSource: (from, to) => source.value.slice(from, to),
  writeSource: (from, to, insert) => {
    source.value = source.value.slice(0, from) + insert + source.value.slice(to);
  },
  editorUrl: new URL('../tikz-editor/index.html', location.href).href,
  imageBaseUrl: () => '',
  requestSave: () => post({ event: 'save', source: source.value, fileName: fileName.value }),
  reportError: (message, cause) => {
    error.value = `${message}: ${cause instanceof Error ? cause.message : String(cause)}`;
    post({ event: 'error', message: error.value });
  },
};

watch(source, value => {
  if (!loaded) return;
  sourceRevision.value++;
  post({ event: 'change', source: value, sourceRevision: sourceRevision.value });
});

async function currentSource(): Promise<string> {
  const value = await workbench.value?.currentSource(new AbortController().signal) ?? source.value;
  source.value = value;
  return value;
}

async function onMessage(event: MessageEvent): Promise<void> {
  if (event.source !== window.parent || event.origin !== parentOrigin) return;
  let data: unknown = event.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return; }
  }
  const parsed = hostCommandSchema.safeParse(data);
  if (!parsed.success) return;
  const command = parsed.data;
  if (command.action === 'load') {
    if (sessionId.value === command.sessionId && command.revision <= revision.value) {
      post({ event: 'reply', action: 'load', requestId: command.requestId, status: 'failed', error: 'stale-target' });
      return;
    }
    loaded = false;
    sessionId.value = command.sessionId;
    revision.value = command.revision;
    sourceRevision.value = 0;
    source.value = command.source;
    fileName.value = command.fileName;
    error.value = '';
    await nextTick();
    loaded = true;
    post({ event: 'loaded' });
    post({ event: 'reply', action: 'load', requestId: command.requestId, status: 'ok' });
    return;
  }
  if (command.sessionId !== sessionId.value || command.revision !== revision.value) {
    post({ event: 'reply', action: command.action, requestId: command.requestId, status: 'failed', error: 'stale-target' });
    return;
  }
  if (command.action === 'source') {
    try {
      const value = await currentSource();
      post({ event: 'reply', action: 'source', requestId: command.requestId, status: 'ok', source: value });
    } catch (cause) {
      post({ event: 'reply', action: 'source', requestId: command.requestId, status: 'failed',
        error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
}

function receive(event: MessageEvent): void { void onMessage(event); }
onMounted(() => {
  window.addEventListener('message', receive);
  post({ event: 'init', version: '1' });
});
onBeforeUnmount(() => window.removeEventListener('message', receive));
</script>

<style>
html, body, #app { width: 100%; height: 100%; margin: 0; }
</style>
<style scoped>
.hosted-workbench { width: 100%; height: 100%; display: flex; flex-direction: column; background: #fbfaf6; color: #1c2430; font: 16px system-ui, sans-serif; }
header { min-height: 52px; display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: #eef0ea; border-bottom: 1px solid #c9cdc3; }
header strong { margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header button { min-height: 40px; padding: 0 12px; border: 1px solid #c9cdc3; border-radius: 8px; background: #fbfaf6; color: #1c2430; cursor: pointer; }
header button[aria-pressed="true"] { border-color: #9e2a2b; color: #9e2a2b; }
header [role="status"] { max-width: 160px; color: #555d67; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
main { display: flex; flex: 1 1 auto; min-height: 0; }
.source { flex: 0 0 36%; min-width: 0; border-right: 1px solid #c9cdc3; }
.canvas { flex: 1 1 auto; min-width: 0; }
.loading { margin: auto; color: #555d67; }
</style>
