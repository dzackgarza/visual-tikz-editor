<template>
  <!-- A frame whose color-scheme differs from its page's paints an opaque backdrop (CSS Color Adjustment 1, §2.3). -->
  <iframe ref="frame" class="settings-window" title="Settings" :src="url" :style="{ colorScheme: theme }" />
</template>

<script setup lang="ts">
/**
 * The canvas editor's Settings window over the whole app (FR-062): the editor page in its
 * Settings view. It saves each setting through the shell and closes on its own close button.
 */

import { onBeforeUnmount, onMounted, ref } from "vue";
import { editorNotificationSchema } from "../vendor/tikz-editor/embed/src/events";
import type { TikzWorkbenchHost, TikzWorkbenchTheme } from "../src/host";

const props = defineProps<{ url: string; host: TikzWorkbenchHost; theme: TikzWorkbenchTheme }>();
const emit = defineEmits<{ close: [] }>();
const frame = ref<HTMLIFrameElement | null>(null);

function onMessage(event: MessageEvent): void {
  if (event.source !== frame.value?.contentWindow || event.origin !== new URL(props.url).origin) return;
  if (typeof event.data !== "string") return;
  const parsed = editorNotificationSchema.safeParse(JSON.parse(event.data));
  if (!parsed.success) return;
  const message = parsed.data;
  if (message.event === "settings-closed") emit("close");
  if (message.event === "persistence-save" && props.host.savePreference !== undefined) {
    void props.host.savePreference(message.key, message.value)
      .catch((error) => props.host.reportError("Could not save settings", error));
  }
}

onMounted(() => window.addEventListener("message", onMessage));
onBeforeUnmount(() => window.removeEventListener("message", onMessage));
</script>

<style scoped>
.settings-window {
  position: fixed;
  inset: 0;
  z-index: 40;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
}
</style>
