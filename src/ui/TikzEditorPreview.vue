<template>
  <div class="tikz-editor-preview" :class="{ dark: props.theme === 'dark' }" :data-editor-state="statusText === '' ? 'ready' : 'busy'">
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
import type { HostCommand, Panel } from "../../vendor/tikz-editor/embed/src/commands";
import {
  type EditorNotification,
  editorNotificationSchema,
  FRAME_PROTOCOL_VERSION,
} from "../../vendor/tikz-editor/embed/src/events";
import {
  type TikzEditorSourceSession,
  tikzEditorReplacement,
  tikzEditorSessionForBlock,
} from "../editor-bridge";
import { TOUCHPAD_PINCH, touchpadPinchOver } from "../touchpad-pinch";
import {
  requestEditorSnapshot,
  requestEditorSource,
  type TikzWorkbenchHost,
  type TikzWorkbenchTheme,
} from "../host";
import type { TikzLivePreviewTarget } from "../live-preview";

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
  panel: Panel;
}>();

const emit = defineEmits<{
  (e: "exitFullscreen"): void;
  (e: "panel", panel: Panel): void;
  (e: "undoRequest"): void;
  (e: "redoRequest"): void;
  (e: "popoverOpened"): void;
  (e: "hostPopoverDismissed"): void;
  (e: "settingsRequest"): void;
  (e: "status", text: string): void;
  (e: "busy", busy: boolean): void;
}>();

const frame = ref<HTMLIFrameElement | null>(null);
const session = shallowRef<PreviewSession>({
  id: crypto.randomUUID(),
  revision: 0,
  source: tikzEditorSessionForBlock(props.target),
});
const hostReady = ref(false);
const loaded = ref(false);
const errorMessage = ref("");
const lifetime = new AbortController();

function snapshot(signal: AbortSignal) {
  if (frame.value === null || !loaded.value) {
    throw new Error("The editor has not loaded its source");
  }
  const active = session.value;
  return requestEditorSnapshot(
    frame.value,
    {
      sessionId: active.id,
      revision: active.revision,
      source: active.source.source,
    },
    AbortSignal.any([signal, lifetime.signal]),
  );
}

async function currentSource(signal: AbortSignal): Promise<string> {
  const active = session.value;
  if (frame.value === null || !loaded.value) return active.source.source;
  // The canvas posts each edit as a `change` before it replies, so after the reply the document
  // holds every edit; the frame's source differs only during a gesture, which is not yet an edit.
  await requestEditorSource(
    frame.value,
    { sessionId: active.id, revision: active.revision },
    AbortSignal.any([signal, lifetime.signal]),
  );
  if (session.value.revision !== active.revision) {
    throw new Error("The source changed while reading the editor");
  }
  return session.value.source.source;
}

function sameBlockIdentity(a: TikzEditorSourceSession, b: TikzEditorSourceSession): boolean {
  return a.kind === b.kind && a.blockFrom === b.blockFrom;
}

// A command without the identity that postToEditor adds; a load names its own revision.
type EditorCommand = HostCommand extends infer C
  ? C extends HostCommand
    ? Omit<C, "sessionId" | "revision" | "requestId"> & Partial<Pick<C, "sessionId" | "revision">>
    : never
  : never;

function postToEditor(message: EditorCommand): void {
  const target = frame.value?.contentWindow;
  if (target === undefined || target === null) {
    return;
  }
  target.postMessage(
    {
      requestId: crypto.randomUUID(),
      sessionId: session.value.id,
      revision: session.value.revision,
      ...message,
    },
    new URL(props.host.editorUrl, location.href).origin,
  );
}

// iPadOS reports the on-screen keyboard only to the top-level visual viewport,
// so the editor frame learns how far the keyboard reaches up from its bottom edge.
let keyboardBottom = 0;
function reportKeyboard(always = false): void {
  const visual = window.visualViewport;
  const target = frame.value;
  if (!loaded.value || visual === null || target === null) return;
  const bottom = Math.max(
    0,
    Math.round(target.getBoundingClientRect().bottom - (visual.offsetTop + visual.height)),
  );
  if (bottom === keyboardBottom && !always) return;
  keyboardBottom = bottom;
  postToEditor({ action: "keyboard", bottom });
}

function zoom(direction: "in" | "out" | "fit" | "selection" | "normal"): void {
  if (loaded.value) postToEditor({ action: "zoom", direction });
}

// A step of a pinch on a touchpad over the canvas zooms the figure by its ratio, about the pointer.
function onTouchpadPinch(event: Event): void {
  if (!loaded.value) return;
  const step = touchpadPinchOver(event, frame.value);
  if (step !== null) postToEditor({ action: "zoom", factor: step.ratio, at: step.place });
}

// One popover at a time across shell and canvas (FR-004): the shell's menu closes the canvas's.
function dismissPopover(): void {
  if (loaded.value) postToEditor({ action: "dismiss-popover" });
}

// A menu of the shell opened or closed: while one is open, the next press in the canvas closes it.
function hostPopover(open: boolean): void {
  if (loaded.value) postToEditor({ action: "host-popover", open });
}

// Keyboard focus goes back to the canvas after a window over it closes (FR-062).
function focus(): void {
  frame.value?.focus();
}

defineExpose({ snapshot, currentSource, zoom, dismissPopover, hostPopover, focus });

function sendFullLoad(): void {
  // A load selects nothing, so the changes before it are spent.
  props.host.takeChangedRanges();
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
    nativeClipboard: props.host.clipboard !== undefined,
    state: props.host.viewState(),
  });
}

watch(
  () => props.target,
  (target) => {
    // Every change is taken, the canvas's own too, so the next replace-source names only its own.
    // The ranges in the figure's source, clipped to it.
    const changed = props.host.takeChangedRanges()
      ?.filter((range) => range.to >= target.sourceFrom && range.from <= target.sourceTo)
      .map((range) => ({
        from: Math.max(range.from, target.sourceFrom) - target.sourceFrom,
        to: Math.min(range.to, target.sourceTo) - target.sourceFrom,
      })) ?? null;
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

    // Another view or the document history changed the source: the canvas shows it and
    // keeps its viewport and tool.
    session.value = { ...active, source: next };
    if (sameSource) return;
    errorMessage.value = "";
    if (loaded.value) postToEditor({ action: "replace-source", source: next.source, changed });
    else sendFullLoad();
  },
);

watch(
  () => props.panel,
  (panel) => {
    if (hostReady.value) {
      postToEditor({ action: "panel", panel });
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
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const parsed = editorNotificationSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** One `change` of the canvas; the changes of one canvas `step` are one step of the document history. */
function applyEditorSource(source: string, revision: number, step: number): void {
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
    props.host.writeSource(replacement.edits, `canvas:${active.id}:${active.revision}:${step}`);
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
  if (message === null || (message.event !== "init" && message.sessionId !== session.value.id)) {
    return;
  }

  if (message.event === "clipboard-read" || message.event === "clipboard-write") {
    const clipboard = props.host.clipboard;
    if (clipboard === undefined || message.revision !== session.value.revision) return;
    const active = session.value;
    const operation =
      message.event === "clipboard-read" ? clipboard.readText() : clipboard.writeText(message.text);
    const respond = (result: { text?: string; error?: string }): void => {
      if (
        session.value.id !== active.id ||
        session.value.revision !== active.revision ||
        lifetime.signal.aborted
      ) {
        return;
      }
      postToEditor({ action: "clipboard-result", targetRequestId: message.requestId, ...result });
    };
    void operation
      .then((text) => respond(typeof text === "string" ? { text } : {}))
      .catch((error) => respond({ error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  switch (message.event) {
    case "persistence-save":
      if (message.revision !== session.value.revision) break;
      if (
        typeof message.key === "string" &&
        typeof message.value === "string" &&
        props.host.savePreference !== undefined
      ) {
        void props.host
          .savePreference(message.key, message.value)
          .catch((error) => props.host.reportError("Could not save editor preferences", error));
      }
      break;
    case "view-state":
      if (message.revision !== session.value.revision || !loaded.value) break;
      void props.host
        .saveViewState(message.state)
        .catch((error) => props.host.reportError("Could not keep the canvas view", error));
      break;
    case "init":
      // An editor built from another protocol would misread every command, so it gets none.
      if (message.version !== FRAME_PROTOCOL_VERSION) {
        errorMessage.value = `The editor speaks frame protocol ${message.version}; this shell speaks ${FRAME_PROTOCOL_VERSION}.`;
        break;
      }
      hostReady.value = true;
      sendFullLoad();
      postToEditor({ action: "display", fullscreen: props.fullscreen });
      postToEditor({ action: "panel", panel: props.panel });
      break;
    case "loaded":
      if (message.revision !== session.value.revision) {
        break;
      }
      loaded.value = true;
      errorMessage.value = "";
      reportKeyboard(true);
      break;
    case "change": {
      applyEditorSource(message.source, message.revision, message.step);
      break;
    }
    case "save": {
      // Only `change` writes the source: each write is one step of the document history.
      if (message.revision !== session.value.revision) break;
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
    case "panel":
      emit("panel", message.panel);
      break;
    case "undo-request":
      emit("undoRequest");
      break;
    case "redo-request":
      emit("redoRequest");
      break;
    case "popover-opened":
      emit("popoverOpened");
      break;
    case "host-popover-dismissed":
      emit("hostPopoverDismissed");
      break;
    case "settings-request":
      emit("settingsRequest");
      break;
    case "source-selection": {
      if (message.revision !== session.value.revision || typeof message.source !== "string") break;
      const active = session.value.source;
      if (
        active.source !== message.source ||
        !Number.isInteger(message.from) ||
        !Number.isInteger(message.to) ||
        message.from < 0 ||
        message.to < message.from ||
        message.to > active.source.length
      ) {
        break;
      }
      props.host.selectSource(active.sourceFrom + message.from, active.sourceFrom + message.to);
      break;
    }
  }
}

const statusText = computed(() => {
  if (errorMessage.value !== "") {
    return "Synchronization issue";
  }
  if (!hostReady.value) {
    return "Loading tikz-editor…";
  }
  return loaded.value ? "" : "Loading source…";
});

watch(
  statusText,
  (text) => {
    emit("status", text);
  },
  { immediate: true },
);
emit("busy", false);

const reportKeyboardChange = () => reportKeyboard();

onMounted(() => {
  window.addEventListener("message", onMessage);
  window.visualViewport?.addEventListener("resize", reportKeyboardChange);
  window.visualViewport?.addEventListener("scroll", reportKeyboardChange);
  window.addEventListener(TOUCHPAD_PINCH, onTouchpadPinch);
});

onBeforeUnmount(() => {
  lifetime.abort("disposed");
  window.removeEventListener("message", onMessage);
  window.visualViewport?.removeEventListener("resize", reportKeyboardChange);
  window.visualViewport?.removeEventListener("scroll", reportKeyboardChange);
  window.removeEventListener(TOUCHPAD_PINCH, onTouchpadPinch);
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
