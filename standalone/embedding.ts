import { requestEditorSnapshot, type HostCommand } from '../src/host';

const editor = document.querySelector<HTMLIFrameElement>('#editor')!;
const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const sessionId = crypto.randomUUID();
let revision = 0;
const lifetime = new AbortController();

function post(message: HostCommand) {
  editor.contentWindow!.postMessage(message, location.origin);
}

function load() {
  revision++;
  post({ action: 'load', source: source.value, autosave: 0, fileName: 'fixture.tikz', sessionId, revision, requestId: crypto.randomUUID() });
  post({ action: 'workspace', workspace: 'canvasOnly', sessionId, revision, requestId: crypto.randomUUID() });
}

function receive(event: MessageEvent) {
  if (event.source !== editor.contentWindow || event.origin !== location.origin) return;
  const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  if (message.event === 'init') load();
  if (message.event === 'loaded' && message.revision === revision) status.textContent = 'Loaded';
  if (message.event === 'change' && message.revision === revision) source.value = message.source;
}

window.addEventListener('message', receive);
document.querySelector('#import-ink')!.addEventListener('click', () => {
  const strokes = JSON.parse(document.querySelector<HTMLTextAreaElement>('#ink')!.value);
  editor.contentWindow!.postMessage({ action: 'import-ink', strokes, sessionId, revision,
    requestId: crypto.randomUUID(), source: source.value }, location.origin);
});
document.querySelector('#load')!.addEventListener('click', load);
document.querySelector('#snapshot')!.addEventListener('click', async () => {
  status.textContent = 'Awaiting snapshot';
  const snapshot = await requestEditorSnapshot(editor, { sessionId, revision, source: source.value }, lifetime.signal);
  if (lifetime.signal.aborted) return;
  result.textContent = JSON.stringify(snapshot);
  status.textContent = snapshot.status === 'ready' ? 'Snapshot ready' : 'Snapshot failed';
});
document.querySelector('#dispose')!.addEventListener('click', () => {
  window.removeEventListener('message', receive);
  lifetime.abort('disposed');
  editor.remove();
  status.textContent = 'Disposed';
});
