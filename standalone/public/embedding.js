const editor = document.querySelector('#editor');
const source = document.querySelector('#source');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
const sessionId = crypto.randomUUID();
let revision = 0;
let pending = null;

function post(message) {
  editor.contentWindow.postMessage({ requestId: crypto.randomUUID(), ...message, sessionId, revision }, location.origin);
}

function load() {
  revision++;
  post({ action: 'load', source: source.value, autosave: 0, fileName: 'fixture.tikz' });
  post({ action: 'workspace', workspace: 'canvasOnly' });
}

function receive(event) {
  if (event.source !== editor.contentWindow || event.origin !== location.origin) return;
  const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  if (message.event === 'init') load();
  if (message.event === 'loaded' && message.revision === revision) status.textContent = 'Loaded';
  if (message.event === 'change' && message.revision === revision) source.value = message.source;
  if (message.event === 'snapshot' && message.requestId === pending?.id) {
    clearTimeout(pending.timer);
    pending = null;
    result.textContent = JSON.stringify(message);
    status.textContent = message.error ? 'Snapshot failed' : 'Snapshot ready';
  }
}

window.addEventListener('message', receive);
document.querySelector('#load').addEventListener('click', load);
document.querySelector('#snapshot').addEventListener('click', () => {
  const id = crypto.randomUUID();
  status.textContent = 'Awaiting snapshot';
  pending = { id, timer: setTimeout(() => { status.textContent = 'Snapshot timed out'; }, 10000) };
  post({ action: 'snapshot', requestId: id, source: source.value });
});
document.querySelector('#dispose').addEventListener('click', () => {
  window.removeEventListener('message', receive);
  if (pending !== null) clearTimeout(pending.timer);
  editor.remove();
  status.textContent = 'Disposed';
});
