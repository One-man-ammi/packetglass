/// <reference lib="webworker" />

/**
 * Runs parseCapture off the main thread so a large capture does not freeze the
 * interface. The parser itself stays synchronous and dependency-free; this is
 * only the message plumbing.
 */

import { parseCapture } from './index';
import type { ParsedCapture } from './types';

export interface ParseWorkerRequest {
  buffer: ArrayBuffer;
}

export type ParseWorkerResponse =
  | { ok: true; capture: ParsedCapture }
  | { ok: false; message: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.addEventListener('message', (event: MessageEvent<ParseWorkerRequest>) => {
  try {
    const capture = parseCapture(event.data.buffer);
    const response: ParseWorkerResponse = { ok: true, capture };
    worker.postMessage(response);
  } catch (error) {
    const response: ParseWorkerResponse = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
    worker.postMessage(response);
  }
});
