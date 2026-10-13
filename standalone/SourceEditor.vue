<template>
  <div ref="parent" class="tikz-source-editor" :class="props.theme" />
</template>

<script setup lang="ts">
/**
 * The TikZ source pane of the standalone workbench. The file text is the
 * source authority: edits here and edits from the workbench both replace it,
 * and this pane shows the current text.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { tikz } from "@tikz-editor/lang-tikz";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TikzWorkbenchTheme } from "../src/host";

const props = defineProps<{
  source: string;
  theme: TikzWorkbenchTheme;
  selection?: { from: number; to: number } | null;
}>();

const emit = defineEmits<{
  (e: "change", source: string): void;
}>();

const parent = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
const themeCompartment = new Compartment();

function showSelection(): void {
  const range = props.selection;
  if (view === null || range === null || range === undefined) return;
  if (range.from < 0 || range.to < range.from || range.to > view.state.doc.length) {
    throw new Error("Canvas selection is outside the current source document");
  }
  view.dispatch({
    selection: { anchor: range.from, head: range.to },
    effects: EditorView.scrollIntoView(range.from, { y: "center" }),
  });
}

onMounted(() => {
  if (parent.value === null) {
    throw new Error("The source editor mounted without its parent element");
  }
  view = new EditorView({
    parent: parent.value,
    state: EditorState.create({
      doc: props.source,
      extensions: [
        lineNumbers(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        tikz(),
        themeCompartment.of(
          props.theme === "dark" ? oneDark : syntaxHighlighting(defaultHighlightStyle),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit("change", update.state.doc.toString());
          }
        }),
      ],
    }),
  });
  showSelection();
});

watch(() => props.selection, showSelection, { flush: "post" });

watch(
  () => props.source,
  (source) => {
    if (view === null || source === view.state.doc.toString()) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source },
    });
  },
);

watch(
  () => props.theme,
  (theme) => {
    view?.dispatch({
      effects: themeCompartment.reconfigure(
        theme === "dark" ? oneDark : syntaxHighlighting(defaultHighlightStyle),
      ),
    });
  },
);

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});
</script>

<style scoped>
.tikz-source-editor {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.tikz-source-editor :deep(.cm-editor) {
  height: 100%;
}

.tikz-source-editor :deep(.cm-scroller) {
  font-family: ui-monospace, monospace;
}

.tikz-source-editor :deep(.cm-selectionBackground) {
  background: #9e2a2b33 !important;
}

.tikz-source-editor.dark :deep(.cm-gutters) {
  background: #2b2b2b;
  color: #888;
  border-right-color: #444;
}

.tikz-source-editor.dark :deep(.cm-cursor) {
  border-left-color: #eee;
}
</style>
