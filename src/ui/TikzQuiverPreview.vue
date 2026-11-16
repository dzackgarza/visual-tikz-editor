<template>
  <div class="tikz-quiver-preview" :class="{ dark: props.theme === 'dark' }" :data-editor-state="hostReady && errorMessage === '' ? 'ready' : 'busy'">
    <div
      v-if="errorMessage !== ''"
      class="tikz-quiver-error"
      role="status"
    >
      {{ errorMessage }}
    </div>
    <iframe
      ref="frame"
      class="tikz-quiver-frame"
      :src="quiver.url"
      title="Quiver diagram editor"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        TikzQuiverPreview
 * CVM-Role:        View
 * License:         GNU GPL v3
 *
 * Description:     Reusable local host for the forked/vendored Quiver editor.
 *                  The RHS preview pane owns presentation mode and fullscreen
 *                  geometry; this component owns only the live document ↔
 *                  Quiver source bridge, macro projection and theme forwarding.
 *                  Embedded and fullscreen states therefore use the same iframe
 *                  and Quiver history rather than competing editor instances.
 *
 * END HEADER
 */

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { requestEditorSource, type TikzWorkbenchHost, type TikzWorkbenchTheme } from "../host";
import type { TikzLivePreviewTarget } from "../live-preview";
import {
  quiverReplacement,
  quiverSessionForBlock,
  quiverSourceForSession,
  type TikzQuiverSourceSession,
} from "../quiver-bridge";
import type { QuiverMacroProjection } from "../quiver-macros";
import { TOUCHPAD_PINCH, touchpadPinchOver } from "../touchpad-pinch";
import { focusFrame, focusLoadedFrame } from "../keyboard-focus";

interface PreviewSession {
  id: string;
  revision: number;
  source: TikzQuiverSourceSession;
}

interface QuiverDiagnostic {
  severity: "warning" | "error";
  message: string;
  from: number;
  to: number;
}

interface QuiverHostMessage {
  type: string;
  sessionId?: string | null;
  revision?: number;
  source?: string;
  // The Quiver history event of a change; the changes of one event are one step of the document history.
  step?: number;
  message?: string;
  diagnostics?: QuiverDiagnostic[];
}

const props = defineProps<{
  target: TikzLivePreviewTarget;
  host: TikzWorkbenchHost;
  theme: TikzWorkbenchTheme;
  fullscreen: boolean;
}>();

const emit = defineEmits<{
  (e: "exitFullscreen"): void;
  (e: "status", text: string): void;
  (e: "undoRequest"): void;
  (e: "redoRequest"): void;
  (e: "hostPopoverDismissed"): void;
}>();

const quiver = props.host.quiver;

const quiverOrigin = new URL(quiver.url, location.href).origin;
const frame = ref<HTMLIFrameElement | null>(null);
const session = shallowRef<PreviewSession>({
  id: crypto.randomUUID(),
  revision: 0,
  source: quiverSessionForBlock(props.target),
});
const macroProjection = shallowRef<QuiverMacroProjection | null>(null);
const hostReady = ref(false);
const lifetime = new AbortController();
const diagnostics = ref<QuiverDiagnostic[]>([]);
const errorMessage = ref("");

function sameBlockIdentity(a: TikzQuiverSourceSession, b: TikzQuiverSourceSession): boolean {
  return a.kind === b.kind && a.blockFrom === b.blockFrom;
}

function postToQuiver(message: Record<string, unknown>): void {
  const target = frame.value?.contentWindow;
  if (target === undefined || target === null) return;
  target.postMessage(
    { ...message, sessionId: session.value.id, revision: session.value.revision },
    quiverOrigin,
  );
}

function sendFullLoad(): void {
  if (!hostReady.value || macroProjection.value === null) return;
  session.value = { ...session.value, revision: session.value.revision + 1 };
  postToQuiver({
    type: "zettlr-quiver:load",
    source: quiverSourceForSession(session.value.source),
    macros: macroProjection.value.macros,
    theme: props.theme,
  });
  postToQuiver({ type: "zettlr-quiver:display", fullscreen: props.fullscreen });
}

function sendSourceUpdate(): void {
  if (!hostReady.value || macroProjection.value === null) return;
  session.value = { ...session.value, revision: session.value.revision + 1 };
  postToQuiver({
    type: "zettlr-quiver:source",
    source: quiverSourceForSession(session.value.source),
    macros: macroProjection.value.macros,
  });
}

watch(
  () => props.target,
  (target) => {
    if (target.language !== "tikzcd") {
      throw new Error(`Quiver can only edit tikzcd diagrams, not ${target.language}`);
    }
    const next = quiverSessionForBlock(target);
    const active = session.value;
    const sameIdentity = sameBlockIdentity(active.source, next);
    const sameSource = sameIdentity && active.source.source === next.source;

    if (!sameIdentity) {
      session.value = { id: crypto.randomUUID(), revision: 0, source: next };
      diagnostics.value = [];
      errorMessage.value = "";
      sendFullLoad();
      return;
    }

    // Range movement without byte changes can happen when the document changes
    // before this block. Keep the current Quiver history but refresh its source
    // authority coordinates.
    session.value = { ...active, source: next };
    if (!sameSource) {
      diagnostics.value = [];
      errorMessage.value = "";
      sendSourceUpdate();
    }
  },
);

watch(
  () => props.theme,
  (theme) => {
    if (hostReady.value) {
      postToQuiver({ type: "zettlr-quiver:theme", theme });
    }
  },
);

watch(
  () => props.fullscreen,
  (fullscreen) => {
    if (hostReady.value) {
      postToQuiver({ type: "zettlr-quiver:display", fullscreen });
    }
  },
);

function applyEditorSource(source: string, step: string): void {
  const active = session.value;
  const current = props.host.readSource(active.source.sourceFrom, active.source.sourceTo);
  if (current !== active.source.authoredSource) {
    throw new Error("The host document changed before Quiver synchronized");
  }
  if (source === quiverSourceForSession(active.source)) return;
  const replacement = quiverReplacement(active.source, source);
  props.host.writeSource([{ from: replacement.from, to: replacement.to, insert: replacement.insert }], step);
  session.value = { ...active, source: replacement.next };
  errorMessage.value = "";
}

function reportSynchronizationError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : String(error);
  props.host.reportError("Could not synchronize Quiver source into the document", error);
}

async function saveCurrentSource(): Promise<void> {
  try {
    await currentSource(lifetime.signal);
    lifetime.signal.throwIfAborted();
    props.host.requestSave?.();
  } catch (error) {
    if (!lifetime.signal.aborted) reportSynchronizationError(error);
  }
}

async function currentSource(signal: AbortSignal): Promise<string> {
  const active = session.value;
  if (frame.value === null || !hostReady.value) throw new Error("Quiver has not loaded its source");
  const source = await requestEditorSource(
    frame.value,
    { sessionId: active.id, revision: active.revision },
    AbortSignal.any([signal, lifetime.signal]),
  );
  if (session.value.id !== active.id || session.value.revision !== active.revision) {
    throw new Error("The source changed while reading Quiver");
  }
  // Quiver posts its last edit as a `change` before it replies, so the document already holds it.
  if (source !== quiverSourceForSession(session.value.source)) {
    throw new Error("Quiver and the document disagree about the diagram");
  }
  return session.value.source.source;
}
// Keyboard focus goes back to Quiver after a window over it closes (FR-062).
function focus(): void {
  if (frame.value) focusFrame(frame.value);
}
// A menu of the shell opened or closed: while one is open, the next press in Quiver closes it.
// A step of a pinch on a touchpad over Quiver zooms its grid by the step's ratio. Quiver zooms
// about the centre of its view, as for its own wheel with Shift.
function onTouchpadPinch(event: Event): void {
  const step = touchpadPinchOver(event, frame.value);
  if (hostReady.value && step !== null) postToQuiver({ type: "zettlr-quiver:zoom", factor: step.ratio });
}

function hostPopover(open: boolean): void {
  if (hostReady.value) postToQuiver({ type: "zettlr-quiver:host-popover", open });
}
defineExpose({ currentSource, focus, hostPopover });

function onMessage(event: MessageEvent<QuiverHostMessage>): void {
  if (event.source !== frame.value?.contentWindow || event.origin !== quiverOrigin) return;
  const message = event.data;
  if (message === null || typeof message !== "object") return;

  if (message.type === "zettlr-quiver:ready") {
    hostReady.value = true;
    sendFullLoad();
    focusLoadedFrame(frame.value);
    return;
  }
  if (message.sessionId !== session.value.id || message.revision !== session.value.revision) return;

  switch (message.type) {
    case "zettlr-quiver:loaded":
      diagnostics.value = Array.isArray(message.diagnostics) ? message.diagnostics : [];
      errorMessage.value = "";
      break;
    case "zettlr-quiver:change": {
      if (typeof message.source !== "string" || !Number.isSafeInteger(message.step)) return;
      try {
        applyEditorSource(message.source, `quiver:${session.value.id}:${message.step}`);
      } catch (error) {
        reportSynchronizationError(error);
      }
      break;
    }
    case "zettlr-quiver:undo-request":
      emit("undoRequest");
      break;
    case "zettlr-quiver:redo-request":
      emit("redoRequest");
      break;
    case "zettlr-quiver:save":
      void saveCurrentSource();
      break;
    case "zettlr-quiver:error":
      errorMessage.value = message.message ?? "Quiver reported an unknown error.";
      break;
    case "zettlr-quiver:close-request":
      if (props.fullscreen) emit("exitFullscreen");
      break;
    case "zettlr-quiver:host-popover-dismissed":
      emit("hostPopoverDismissed");
      break;
  }
}

const statusText = computed(() => {
  if (errorMessage.value !== "") return "Synchronization issue";
  const errors = diagnostics.value.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.value.filter((item) => item.severity === "warning").length;
  if (errors > 0) return `${errors} import error${errors === 1 ? "" : "s"}`;
  if (warnings > 0) return `${warnings} import warning${warnings === 1 ? "" : "s"}`;
  if (!hostReady.value) return "Loading Quiver…";
  const compilerOnly = macroProjection.value?.unsupported.length ?? 0;
  return compilerOnly > 0
    ? `${compilerOnly} macro${compilerOnly === 1 ? "" : "s"} unavailable in Quiver`
    : "";
});

watch(
  statusText,
  (text) => {
    emit("status", text);
  },
  { immediate: true },
);

onMounted(async () => {
  window.addEventListener("message", onMessage);
  window.addEventListener(TOUCHPAD_PINCH, onTouchpadPinch);

  try {
    macroProjection.value = await quiver.macros();
    sendFullLoad();
  } catch (error) {
    errorMessage.value = `Could not load Quiver macros: ${error instanceof Error ? error.message : String(error)}`;
    props.host.reportError("Quiver macro projection failed", error);
  }
});

onBeforeUnmount(() => {
  lifetime.abort("disposed");
  window.removeEventListener("message", onMessage);
  window.removeEventListener(TOUCHPAD_PINCH, onTouchpadPinch);
});
</script>

<style scoped lang="less">
.tikz-quiver-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tikz-quiver-frame {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  border: 0;
  background: white;
}

.tikz-quiver-error {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(192, 57, 43, 0.35);
  background: rgba(192, 57, 43, 0.08);
  color: #a93226;
  font-size: 0.8rem;
}

.tikz-quiver-preview.dark .tikz-quiver-error {
  color: #e67e73;
}
</style>
