import { requestEditorSnapshot, type HostCommand } from '../src/host';

const editor = document.querySelector<HTMLIFrameElement>('#editor')!;
const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const sessionId = crypto.randomUUID();
let revision = 0;
const lifetime = new AbortController();
let pending: AbortController | null = null;

function post(message: HostCommand) {
  editor.contentWindow!.postMessage(message, location.origin);
}

function load() {
  revision++;
  post({ action: 'load', source: source.value, autosave: 0, fileName: 'fixture.tikz', imageBaseUrl: `${location.origin}/`, sessionId, revision, requestId: crypto.randomUUID() });
  post({ action: 'workspace', workspace: 'canvasOnly', sessionId, revision, requestId: crypto.randomUUID() });
}

function receive(event: MessageEvent) {
  if (event.source !== editor.contentWindow || event.origin !== location.origin) return;
  const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  if (message.event === 'init') load();
  if (message.event === 'loaded' && message.revision === revision) status.textContent = 'Loaded';
  if (message.event === 'change' && message.revision === revision) source.value = message.source;
  if (message.event === 'reply' && message.status === 'failed') status.textContent = message.error;
}

window.addEventListener('message', receive);
document.querySelector('#import-ink')!.addEventListener('click', () => {
  const strokes = JSON.parse(document.querySelector<HTMLTextAreaElement>('#ink')!.value);
  post({ action: 'import-ink', strokes, sessionId, revision,
    requestId: crypto.randomUUID(), source: source.value });
});
for (const action of ['interpret-ink', 'restore-ink'] as const) {
  document.querySelector(`#${action}`)!.addEventListener('click', () => {
    post({ action, source: source.value, key: document.querySelector<HTMLInputElement>('#stroke-key')!.value,
      tolerance: 8, sessionId, revision, requestId: crypto.randomUUID() });
  });
}
document.querySelector('#load')!.addEventListener('click', load);
document.querySelector('#snapshot')!.addEventListener('click', async () => {
  pending?.abort();
  const request = new AbortController();
  pending = request;
  status.textContent = 'Awaiting snapshot';
  const snapshot = await requestEditorSnapshot(editor, { sessionId, revision, source: source.value }, AbortSignal.any([lifetime.signal, request.signal]));
  if (lifetime.signal.aborted || pending !== request) return;
  pending = null;
  result.textContent = JSON.stringify(snapshot);
  status.textContent = snapshot.status === 'ready' ? 'Snapshot ready' : 'Snapshot failed';
});
document.querySelector('#cancel')!.addEventListener('click', () => pending?.abort());
document.querySelector('#dispose')!.addEventListener('click', () => {
  window.removeEventListener('message', receive);
  lifetime.abort('disposed');
  editor.remove();
  status.textContent = 'Disposed';
});
