import { ApiError } from './apiError';

interface Options {
  signal?: AbortSignal | null;
  checkOwnership: () => void;
  onEvent: (event: unknown) => void;
}

// Transport only: session checks stay with ApiClient, event semantics with Chat.
export async function readNdjson(body: ReadableStream<Uint8Array>, options: Options) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  function checkCurrent() {
    options.checkOwnership();
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  }

  function decode(line: string) {
    checkCurrent();
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new ApiError('The response stream returned invalid data. Please retry.', 502);
    }
    options.onEvent(value);
  }

  try {
    while (true) {
      checkCurrent();
      const { value, done } = await reader.read();
      checkCurrent();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) decode(line);
      if (done) {
        decode(buffer);
        finished = true;
        return;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
