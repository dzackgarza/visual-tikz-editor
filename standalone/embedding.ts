import { requestEditorSource, requestEditorSnapshot, type HostCommand } from '../src/host';

const editor = document.querySelector<HTMLIFrameElement>('#editor')!;
const source = document.querySelector<HTMLTextAreaElement>('#source')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const result = document.querySelector<HTMLPreElement>('#result')!;
const sessionId = crypto.randomUUID();
let revision = 0;
let acceptedSource = source.value;
const lifetime = new AbortController();
let pending: AbortController | null = null;

function post(message: HostCommand) {
  editor.contentWindow!.postMessage(message, location.origin);
}

function load() {
  acceptedSource = source.value;
  revision++;
  post({ action: 'load', source: source.value, autosave: 0, fileName: 'fixture.tikz', imageBaseUrl: `${location.origin}/`, sessionId, revision, requestId: crypto.randomUUID() });
}

function receive(event: MessageEvent) {
  if (event.source !== editor.contentWindow || event.origin !== location.origin) return;
  const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  if (message.event === 'init') load();
  if (message.event === 'loaded' && message.revision === revision &&
      (status.textContent === 'Loading' || status.textContent === 'Loading editor')) status.textContent = 'Loaded';
  if (message.event === 'change' && message.sessionId === sessionId && message.revision === revision && source.value === acceptedSource) {
    acceptedSource = message.source;
    source.value = acceptedSource;
  }
  if (message.event === 'reply')
    document.querySelector('#command-result')!.textContent = `${message.action}:${message.status}:${message.error ?? ''}`;
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
      sessionId, revision, requestId: crypto.randomUUID() });
  });
}
document.querySelector('#load')!.addEventListener('click', load);
document.querySelector('#load-snapshot')!.addEventListener('click', () => {
  const snapshot = JSON.parse(document.querySelector<HTMLTextAreaElement>('#saved-snapshot')!.value);
  status.textContent = 'Loading';
  source.value = snapshot.source;
  acceptedSource = snapshot.source;
  revision++;
  editor.contentWindow!.postMessage({ action: 'load', source: snapshot.source, state: snapshot.state,
    fileName: 'fixture.tikz', sessionId, revision, requestId: crypto.randomUUID(), imageBaseUrl: `${location.origin}/` }, location.origin);
});
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

document.querySelector('#copy-source')!.addEventListener('click', async () => {
  try {
    source.value = await requestEditorSource(editor, { sessionId, revision }, lifetime.signal);
    acceptedSource = source.value;
    await navigator.clipboard.writeText(source.value);
  } catch (error) { status.textContent = String(error); }
});
