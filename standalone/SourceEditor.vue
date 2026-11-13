<template>
  <div ref="parent" class="tikz-source-editor" :class="props.theme" />
</template>

<script setup lang="ts">
/**
 * The TikZ source pane of the standalone workbench. It shows the document of
 * `src/document-history.ts` and keeps no history of its own: its edits enter the
 * document's one history, and it shows the edits that other views and Undo make.
 */

import { defaultKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { tikz } from "@tikz-editor/lang-tikz";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CODE_STEP, type DocumentHistory } from "../src/document-history";
import type { TikzWorkbenchTheme } from "../src/host";

const props = defineProps<{
  document: DocumentHistory;
  theme: TikzWorkbenchTheme;
  selection?: { from: number; to: number } | null;
}>();

const parent = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
const themeCompartment = new Compartment();
// An edit made elsewhere, which this pane only shows.
const shown = Annotation.define<boolean>();
let unsubscribe: (() => void) | null = null;

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
      doc: props.document.source,
      extensions: [
        lineNumbers(),
        drawSelection(),
        // CodeMirror's historyKeymap bindings, bound to the document history.
        keymap.of([
          { key: "Mod-z", run: () => props.document.undo(), preventDefault: true },
          { key: "Mod-y", mac: "Mod-Shift-z", run: () => props.document.redo(), preventDefault: true },
          { key: "Mod-Shift-z", run: () => props.document.redo(), preventDefault: true },
          ...defaultKeymap,
        ]),
        tikz(),
        themeCompartment.of(
          props.theme === "dark" ? oneDark : syntaxHighlighting(defaultHighlightStyle),
        ),
        EditorView.updateListener.of((update) => {
          for (const tr of update.transactions) {
            if (tr.docChanged && tr.annotation(shown) !== true) {
              props.document.edit(tr.changes, CODE_STEP, tr.annotation(Transaction.userEvent));
            }
          }
        }),
      ],
    }),
  });
  unsubscribe = props.document.subscribe(({ changes, source }) => {
    if (view === null || view.state.doc.toString() === source) return;
    view.dispatch({ changes, annotations: shown.of(true) });
  });
  showSelection();
});

watch(() => props.selection, showSelection, { flush: "post" });

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

function focus(): void {
  view?.focus();
}
defineExpose({ focus });

onBeforeUnmount(() => {
  unsubscribe?.();
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
