<template>
  <div class="tikz-editor-preview" :class="{ dark: props.theme === 'dark' }">
    <div
      v-if="errorMessage !== ''"
      class="tikz-editor-error"
      role="status"
    >
      {{ errorMessage }}
    </div>
    <iframe
      ref="frame"
      class="tikz-editor-frame"
      :src="props.host.editorUrl"
      title="TikZ visual editor"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Vendored tikz-editor preview provider
 * CVM-Role:        View
 * License:         GNU GPL v3
 *
 * Description:     Hosts the pinned DominikPeters/tikz-editor fork in an
 *                  isolated iframe. The host document remains the source authority;
 *                  tikz-editor owns TikZ parsing, semantics, canvas editing,
 *                  edit capabilities and history. The bridge sends complete
 *                  source in both directions and rejects stale iframe writes.
 *
 * END HEADER
 */

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  type TikzEditorSourceSession,
  tikzEditorReplacement,
  tikzEditorSessionForBlock,
} from "../editor-bridge";
import { requestEditorSource, requestEditorSnapshot, type TikzWorkbenchHost, type TikzWorkbenchTheme } from "../host";
import { editorNotificationSchema, type EditorNotification } from "../../vendor/tikz-editor/embed/src/events";
import type { TikzLivePreviewTarget } from "../live-preview";
import type { EditorShapeOption, EditorToolMode } from "../editor-tools";

interface PreviewSession {
  id: string;
  revision: number;
  source: TikzEditorSourceSession;
}


const props = defineProps<{
  target: TikzLivePreviewTarget;
  host: TikzWorkbenchHost;
  theme: TikzWorkbenchTheme;
  fullscreen: boolean;
  showInspector?: boolean;
}>();

const emit = defineEmits<{
  (e: "exitFullscreen"): void;
  (e: "inspectorClosed"): void;
  (e: "status", text: string): void;
  (e: "busy", busy: boolean): void;
  (e: "tool", tool: EditorToolMode): void;
  (e: "toolOptions", shapes: EditorShapeOption[]): void;
}>();

const frame = ref<HTMLIFrameElement | null>(null);
const session = shallowRef<PreviewSession>({
  id: crypto.randomUUID(),
  revision: 0,
  source: tikzEditorSessionForBlock(props.target),
});
const hostReady = ref(false);
const pendingTool = ref<EditorToolMode | null>(null);
const loaded = ref(false);
const errorMessage = ref("");
const lifetime = new AbortController();

function snapshot(signal: AbortSignal) {
  if (frame.value === null || !loaded.value) throw new Error("The editor has not loaded its source");
  const active = session.value;
  return requestEditorSnapshot(frame.value, {
    sessionId: active.id, revision: active.revision, source: active.source.source,
  }, AbortSignal.any([signal, lifetime.signal]));
}

async function currentSource(signal: AbortSignal): Promise<string> {
  const active = session.value;
  if (frame.value === null || !loaded.value) return active.source.source;
  const source = await requestEditorSource(frame.value, { sessionId: active.id, revision: active.revision },
    AbortSignal.any([signal, lifetime.signal]));
  if (session.value.revision !== active.revision) throw new Error("The source changed while reading the editor");
  applyEditorSource(source, active.revision);
  return session.value.source.source;
}


function sameBlockIdentity(a: TikzEditorSourceSession, b: TikzEditorSourceSession): boolean {
  return a.kind === b.kind && a.blockFrom === b.blockFrom;
}

function postToEditor(message: Record<string, unknown>): void {
  const target = frame.value?.contentWindow;
  if (target === undefined || target === null) {
    return;
  }
  target.postMessage({
    requestId: crypto.randomUUID(), sessionId: session.value.id,
    revision: session.value.revision, ...message,
  }, new URL(props.host.editorUrl, location.href).origin);
}

function selectTool(tool: EditorToolMode): void {
  pendingTool.value = tool;
  if (loaded.value) postToEditor({ action: "tool", tool });
}

function zoom(direction: "in" | "out" | "reset"): void {
  if (loaded.value) postToEditor({ action: "zoom", direction });
}

function configureTool(option: "smoothing" | "strokeColor" | "fillColor" | "shape", value: string | number): void {
  postToEditor({ action: "tool-option", option, value });
}

function configureMatrix(rows: number, columns: number): void {
  postToEditor({ action: "tool-option", option: "matrix", rows, columns });
}

defineExpose({ snapshot, currentSource, selectTool, configureTool, configureMatrix, zoom });

function sendFullLoad(): void {
  if (!hostReady.value) {
    return;
  }
  const active = session.value;
  const revision = active.revision + 1;
  session.value = { ...active, revision };
  loaded.value = false;
  postToEditor({
    action: "load",
    sessionId: active.id,
    revision,
    source: active.source.source,
    autosave: 0,
    fileName: props.target.docPath === "" ? "diagram.tikz" : props.target.docPath,
    imageBaseUrl: props.host.imageBaseUrl(props.target.docPath),
    settings: {
      general: {
        colorScheme: props.theme,
        canvasInvert: false,
      },
    },
  });
}

function sendTheme(): void {
  if (!hostReady.value) {
    return;
  }
  postToEditor({
    action: "settings",
    settings: { general: { colorScheme: props.theme, canvasInvert: false } },
  });
}

watch(
  () => props.target,
  (target) => {
    const next = tikzEditorSessionForBlock(target);
    const active = session.value;
    const sameIdentity = sameBlockIdentity(active.source, next);
    const sameSource = sameIdentity && active.source.source === next.source;

    if (!sameIdentity) {
      session.value = { ...active, source: next };
      errorMessage.value = "";
      sendFullLoad();
      return;
    }

    // Edits elsewhere in the Markdown document may move the source range
    // without changing this TikZ block. Keep tikz-editor's history intact and
    // refresh only the authority coordinates used for the next write-back.
    session.value = { ...active, source: next };
    if (!sameSource) {
      errorMessage.value = "";
      sendFullLoad();
    }
  },
);

watch(() => props.theme, sendTheme);

watch(
  () => props.showInspector,
  (visible) => {
    if (hostReady.value) {
      postToEditor({ action: "inspector", inspector: visible === true });
    }
  },
);

watch(
  () => props.fullscreen,
  (fullscreen) => {
    if (hostReady.value) {
      postToEditor({ action: "display", fullscreen });
    }
  },
);

function parseHostMessage(data: unknown): EditorNotification | null {
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }
  const parsed = editorNotificationSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function applyEditorSource(source: string, revision: number | undefined): void {
  const active = session.value;
  if (revision !== active.revision) {
    return;
  }
  if (source === active.source.source) {
    return;
  }

  // The host document may have changed after tikz-editor began this edit. Never let
  // a delayed iframe message overwrite newer authoritative source bytes.
  const current = props.host.readSource(active.source.sourceFrom, active.source.sourceTo);
  if (current !== active.source.source) {
    return;
  }

  try {
    const replacement = tikzEditorReplacement(active.source, source);
    props.host.writeSource(replacement.from, replacement.to, replacement.insert);
    session.value = { ...active, source: replacement.next };
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
    props.host.reportError("Could not synchronize tikz-editor source into the document", error);
  }
}

function onMessage(event: MessageEvent): void {
  if (event.source !== frame.value?.contentWindow) {
    return;
  }
  if (event.origin !== new URL(props.host.editorUrl, location.href).origin) {
    return;
  }
  const message = parseHostMessage(event.data);
  if (message === null || (message.event !== "init" && message.sessionId !== session.value.id)) return;

  switch (message.event) {
    case "init":
      hostReady.value = true;
      sendFullLoad();
      postToEditor({ action: "display", fullscreen: props.fullscreen });
      postToEditor({ action: "workspace", workspace: "canvasOnly" });
      postToEditor({ action: "inspector", inspector: props.showInspector === true });
      break;
    case "loaded":
      if (message.revision !== session.value.revision) {
        break;
      }
      loaded.value = true;
      errorMessage.value = "";
      if (pendingTool.value !== null) postToEditor({ action: "tool", tool: pendingTool.value });
      break;
    case "change": {
      applyEditorSource(message.source, message.revision);
      break;
    }
    case "save": {
      if (message.revision !== session.value.revision) break;
      applyEditorSource(message.source, message.revision);
      props.host.requestSave?.();
      break;
    }
    case "error":
      errorMessage.value = message.message;
      break;
    case "message":
      if (message.kind === "error") {
        errorMessage.value = message.message ?? message.title ?? "tikz-editor reported an error.";
      }
      break;
    case "close-request":
      if (props.fullscreen) {
        emit("exitFullscreen");
      }
      break;
    case "inspector-closed":
      emit("inspectorClosed");
      break;
    case "tool":
      if (message.tool !== undefined) emit("tool", message.tool);
      break;
    case "tool-options":
      if (message.shapes !== undefined) emit("toolOptions", message.shapes);
      break;
  }
}

const statusText = computed(() => {
  if (errorMessage.value !== "") {
    return "Synchronization issue";
  }
  if (!hostReady.value) {
    return "Loading tikz-editor…";
  }
  return loaded.value ? "Synced" : "Loading source…";
});

watch(
  statusText,
  (text) => {
    emit("status", text);
  },
  { immediate: true },
);
emit("busy", false);

onMounted(() => {
  window.addEventListener("message", onMessage);
});

onBeforeUnmount(() => {
  lifetime.abort("disposed");
  window.removeEventListener("message", onMessage);
});
</script>

<style scoped lang="less">
.tikz-editor-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tikz-editor-frame {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  border: 0;
  background: white;
}

.tikz-editor-error {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(192, 57, 43, 0.35);
  background: rgba(192, 57, 43, 0.08);
  color: #a93226;
  font-size: 0.8rem;
}

.tikz-editor-preview.dark .tikz-editor-error {
  color: #e67e73;
}
</style>
