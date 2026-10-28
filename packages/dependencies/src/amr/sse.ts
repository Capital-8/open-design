import { DependencyError } from '../error.js';

/** POC SSE framing: keep only complete events; a truncated tail is replayed from the last committed cursor. */
export async function* sseFrames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', data: string[] = [], id = '', frameSize = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length + frameSize > 4 * 1024 * 1024) throw new DependencyError('runtime_event_too_large');
      for (;;) {
        const pos = buffer.indexOf('\n');
        if (pos < 0) break;
        const line = buffer.slice(0, pos).replace(/\r$/, '');
        buffer = buffer.slice(pos + 1);
        if (!line) {
          if (data.length) yield { id, data: data.join('\n') };
          data = []; id = ''; frameSize = 0; continue;
        }
        if (line.startsWith(':')) continue;
        const sep = line.indexOf(':'), field = sep < 0 ? line : line.slice(0, sep);
        const text = sep < 0 ? '' : line.slice(sep + 1).replace(/^ /, '');
        if (field === 'data') { data.push(text); frameSize += text.length; }
        if (field === 'id') { frameSize += text.length; id = text; }
        if (frameSize > 4 * 1024 * 1024) throw new DependencyError('runtime_event_too_large');
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
