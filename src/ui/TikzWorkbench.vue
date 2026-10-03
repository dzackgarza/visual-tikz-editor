<template>
  <aside
    class="tikz-live-preview"
    :class="{ fullscreen, dark: props.theme === 'dark' }"
    aria-label="TikZ workbench"
    :data-tikz-language="props.target.language"
  >
    <header class="tikz-live-preview-header">
      <span class="tikz-live-preview-label">View:</span>
      <div
        class="tikz-live-preview-modes"
        role="group"
        aria-label="Diagram view"
      >
        <button
          v-for="provider in providers"
          :key="provider.id"
          type="button"
          :class="{ active: displayMode === provider.id }"
          :aria-pressed="displayMode === provider.id"
          :disabled="!supportsProvider(provider) && displayMode !== provider.id"
          :title="supportsProvider(provider) ? '' : unavailableTitle(provider)"
          @click="selectProvider(provider.id)"
        >
          {{ provider.label }}
        </button>
      </div>

      <span class="tikz-live-preview-status">{{ unavailableMessage !== '' ? 'Unavailable' : activeStatus }}</span>
      <span
        v-if="activeBusy"
        class="tikz-live-preview-spinner"
        aria-hidden="true"
      />
      <button
        v-if="activeProvider.refreshable"
        type="button"
        class="tikz-live-preview-action tikz-live-preview-refresh"
        title="Rebuild TikZ preview"
        aria-label="Rebuild TikZ preview"
        @click="forceRefresh"
      >
        <span aria-hidden="true">↻</span>
      </button>
      <button
        type="button"
        class="tikz-live-preview-action tikz-live-preview-expand"
        :title="fullscreen ? 'Exit fullscreen preview (Esc)' : 'Open fullscreen preview'"
        :aria-label="fullscreen ? 'Exit fullscreen preview' : 'Open fullscreen preview'"
        @click="fullscreen = !fullscreen"
      >
        <span aria-hidden="true">{{ fullscreen ? '↙' : '⤢' }}</span>
      </button>
    </header>

    <div class="tikz-live-preview-content">
      <div v-if="unavailableMessage !== ''" class="tikz-live-preview-unavailable" role="alert">
        <strong>{{ activeProvider.label }} cannot edit this diagram</strong>
        <button type="button" @click="copyUnavailableMessage">Copy error</button>
        <pre>{{ unavailableMessage }}</pre>
        <span v-if="copyError !== ''" role="alert">{{ copyError }}</span>
      </div>
      <component
        v-if="unavailableMessage === '' && displayMode === 'tikz'"
        :is="activeProvider.component"
        ref="previewHandle"
        :key="`${activeProvider.id}\0${targetIdentity(props.target)}`"
        class="tikz-live-preview-provider"
        :target="props.target"
        :host="props.host"
        :theme="props.theme"
        :fullscreen="fullscreen"
        :show-inspector="props.showInspector"
        @exit-fullscreen="fullscreen = false"
        @status="onProviderStatus('tikz', $event)"
        @busy="onProviderBusy('tikz', $event)"
      />
      <component
        v-for="provider in providers.filter((candidate) => candidate.id !== 'tikz' && visitedEditors.has(candidate.id))"
        v-if="unavailableMessage === ''"
        v-show="displayMode === provider.id"
        :is="provider.component"
        :key="`${provider.id}\0${targetIdentity(props.target)}`"
        class="tikz-live-preview-provider"
        :target="props.target"
        :host="props.host"
        :theme="props.theme"
        :fullscreen="fullscreen"
        :show-inspector="props.showInspector"
        @exit-fullscreen="fullscreen = false"
        @status="onProviderStatus(provider.id, $event)"
        @busy="onProviderBusy(provider.id, $event)"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        TikZ workbench shell
 * CVM-Role:        View
 * License:         GNU GPL v3
 *
 * Description:     One surface for TikZ authoring whose preview/editor
 *                  modes are registered providers. The shell owns only mode
 *                  selection, status, refresh dispatch and fullscreen geometry;
 *                  each provider owns its rendering and source synchronization.
 *
 * END HEADER
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TikzWorkbenchHost, TikzWorkbenchTheme } from "../host";
import type { TikzLivePreviewTarget } from "../live-preview";
import { defaultTikzPreviewMode, type TikzPreviewModeId } from "../preview-modes";
import { TIKZ_PREVIEW_PROVIDERS, type TikzPreviewProvider } from "./providers";

const props = defineProps<{
  target: TikzLivePreviewTarget;
  host: TikzWorkbenchHost;
  theme: TikzWorkbenchTheme;
  initialMode?: TikzPreviewModeId;
  requestedMode?: TikzPreviewModeId;
  showInspector?: boolean;
}>();

const emit = defineEmits<{
  (e: "mode", mode: TikzPreviewModeId): void;
}>();

const fullscreen = ref(false);
function defaultMode(): TikzPreviewModeId {
  if (props.target.language === "tikzcd" && props.host.quiver === undefined) {
    return props.host.rendering === undefined ? "visual" : "tikz";
  }
  if (props.target.language === "tikz" && props.host.rendering === undefined) {
    return "visual";
  }
  return defaultTikzPreviewMode(props.target);
}

const requestedMode = ref<TikzPreviewModeId>(
  props.requestedMode ?? props.initialMode ?? defaultMode(),
);
const visitedEditors = ref<Set<TikzPreviewModeId>>(new Set());
const activeStatus = ref("");
const activeBusy = ref(false);
const providerStatus = ref<Record<TikzPreviewModeId, string>>({ tikz: "", quiver: "", visual: "" });
const providerBusy = ref<Record<TikzPreviewModeId, boolean>>({
  tikz: false,
  quiver: false,
  visual: false,
});
const copyError = ref("");
const previewHandle = ref<{ refresh?: () => void } | null>(null);
const providers: readonly TikzPreviewProvider[] = TIKZ_PREVIEW_PROVIDERS;
const displayMode = requestedMode;
const activeProvider = computed(() => {
  const provider = providers.find((candidate) => candidate.id === displayMode.value);
  if (provider === undefined) {
    throw new Error(`No TikZ preview provider registered for mode ${displayMode.value}`);
  }
  return provider;
});
function supportsProvider(provider: TikzPreviewProvider): boolean {
  if (provider.id === "tikz" && props.host.rendering === undefined) return false;
  if (provider.id === "quiver" && props.host.quiver === undefined) return false;
  return provider.supports(props.target);
}

function unavailableTitle(provider: TikzPreviewProvider): string {
  if (provider.id === "tikz" && props.host.rendering === undefined) {
    return "This host has no TeX renderer";
  }
  if (provider.id === "quiver" && props.host.quiver === undefined) {
    return "This host has no Quiver editor";
  }
  return provider.unavailableTitle(props.target);
}

const unavailableMessage = computed(() =>
  supportsProvider(activeProvider.value) ? "" : unavailableTitle(activeProvider.value),
);

watch(
  [unavailableMessage, () => props.target.docPath, () => props.target.sourceFrom],
  ([message, docPath, sourceFrom]) => {
    copyError.value = "";
    if (message !== "") {
      props.host.reportError(`TikZ editor mode unavailable in ${docPath}:${sourceFrom}`, message);
    }
  },
  { immediate: true, flush: "post" },
);

function copyUnavailableMessage(): void {
  void navigator.clipboard.writeText(unavailableMessage.value).catch((error) => {
    copyError.value = error instanceof Error ? error.message : String(error);
    props.host.reportError("Could not copy TikZ editor error", error);
  });
}

function targetIdentity(target: TikzLivePreviewTarget): string {
  return `${target.docPath}\0${target.kind}\0${target.language}\0${target.from}`;
}

watch(
  () => targetIdentity(props.target),
  () => {
    requestedMode.value = props.requestedMode ?? props.initialMode ?? defaultMode();
    visitedEditors.value =
      requestedMode.value === "tikz" ? new Set() : new Set([requestedMode.value]);
    providerStatus.value = { tikz: "", quiver: "", visual: "" };
    providerBusy.value = { tikz: false, quiver: false, visual: false };
    fullscreen.value = false;
  },
);

watch(
  () => props.requestedMode,
  (mode) => {
    if (mode !== undefined) requestedMode.value = mode;
  },
);

watch(
  displayMode,
  (mode) => {
    activeStatus.value = mode === "tikz" ? "" : providerStatus.value[mode];
    activeBusy.value = mode === "tikz" ? false : providerBusy.value[mode];
    if (mode !== "tikz") visitedEditors.value = new Set([...visitedEditors.value, mode]);
    emit("mode", mode);
  },
  { immediate: true },
);

function selectProvider(mode: TikzPreviewModeId): void {
  const provider = providers.find((candidate) => candidate.id === mode);
  if (provider !== undefined && supportsProvider(provider)) {
    requestedMode.value = mode;
  }
}

function forceRefresh(): void {
  previewHandle.value?.refresh?.();
}

function onProviderStatus(provider: TikzPreviewModeId, status: string): void {
  providerStatus.value[provider] = status;
  if (displayMode.value === provider) activeStatus.value = status;
}

function onProviderBusy(provider: TikzPreviewModeId, busy: boolean): void {
  providerBusy.value[provider] = busy;
  if (displayMode.value === provider) activeBusy.value = busy;
}

function onWindowKeydown(event: KeyboardEvent): void {
  if (fullscreen.value && event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    fullscreen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown, true);
});
</script>

<style scoped lang="less">
.tikz-live-preview {
  --surface: #eef0ea;
  --text: #1c2430;
  --accent: #9e2a2b;
  width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fbfaf6;
  color: var(--text);

  &.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 5000;
    width: auto;
    height: auto;
    min-width: 0;
  }
}

.tikz-live-preview-header {
  flex: 0 0 auto;
  min-height: 52px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--text) 15%, transparent);
  background: var(--surface);
  font-size: 0.9rem;
  user-select: none;
}

.tikz-live-preview-label {
  font-weight: 600;
}

.tikz-live-preview-modes {
  display: inline-flex;
  flex-wrap: wrap;
  padding: 2px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--text) 8%, transparent);

  button {
    border: 0;
    min-height: 44px;
    border-radius: 8px;
    padding: 6px 12px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;

    &.active {
      background: var(--accent);
      color: #fff;
      font-weight: 600;
    }

    &:disabled {
      opacity: 0.34;
      cursor: not-allowed;
    }
  }
}

.tikz-live-preview-status {
  margin-left: auto;
  opacity: 0.6;
}

.tikz-live-preview-spinner {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  opacity: 0.72;
  animation: tikz-live-preview-spin 0.8s linear infinite;
}

@keyframes tikz-live-preview-spin {
  to { transform: rotate(360deg); }
}

.tikz-live-preview-action {
  border: 0;
  min-width: 44px;
  min-height: 44px;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  padding: 3px 5px;
  line-height: 1;
  font-size: 1rem;
  cursor: pointer;

  &:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
}

.tikz-live-preview-content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tikz-live-preview-provider {
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow: hidden;
}

.tikz-live-preview-unavailable {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  color: #a93226;
  user-select: text;
  -webkit-user-select: text;

  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  button { margin-left: 8px; cursor: pointer; }
}

.tikz-live-preview.dark {
  --surface: #313b45;
  --text: #f3f2ed;
  --accent: #b44243;
  background: #1d242b;
}
</style>
