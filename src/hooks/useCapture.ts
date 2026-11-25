import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { parseCapture } from '../parser';
import type { ParseWorkerResponse } from '../parser/parseWorker';
import type { ParsedCapture } from '../parser/types';

export interface LoadedCapture {
  capture: ParsedCapture;
  fileName: string;
  fileSize: number;
}

export type CaptureState =
  | { status: 'idle' }
  | { status: 'parsing'; fileName: string; fileSize: number }
  | ({ status: 'ready' } & LoadedCapture)
  | { status: 'error'; fileName: string; message: string };

/**
 * Loads a capture through a worker, falling back to the main thread where
 * workers are unavailable. Nothing is uploaded: the bytes only ever move
 * between this page and its own worker.
 */
export function useCapture(): {
  state: CaptureState;
  loadFile: (file: File) => Promise<void>;
  loadBytes: (bytes: Uint8Array, fileName: string) => Promise<void>;
  reset: () => void;
} {
  const [state, setState] = useState<CaptureState>({ status: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const parse = useCallback(async (buffer: ArrayBuffer): Promise<ParsedCapture> => {
    const worker = ensureWorker(workerRef);
    if (!worker) return parseCapture(buffer);

    return new Promise<ParsedCapture>((resolve, reject) => {
      const onMessage = (event: MessageEvent<ParseWorkerResponse>) => {
        cleanup();
        if (event.data.ok) resolve(event.data.capture);
        else reject(new Error(event.data.message));
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || 'The capture parser crashed.'));
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage as EventListener);
        worker.removeEventListener('error', onError as EventListener);
      };

      worker.addEventListener('message', onMessage as EventListener);
      worker.addEventListener('error', onError as EventListener);
      worker.postMessage({ buffer }, [buffer]);
    });
  }, []);

  const run = useCallback(
    async (buffer: ArrayBuffer, fileName: string, fileSize: number) => {
      const request = (requestRef.current += 1);
      setState({ status: 'parsing', fileName, fileSize });

      try {
        const capture = await parse(buffer);
        if (requestRef.current !== request) return;
        setState({ status: 'ready', capture, fileName, fileSize });
      } catch (error) {
        if (requestRef.current !== request) return;
        setState({
          status: 'error',
          fileName,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [parse],
  );

  const loadFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      await run(buffer, file.name, file.size);
    },
    [run],
  );

  const loadBytes = useCallback(
    async (bytes: Uint8Array, fileName: string) => {
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      await run(buffer, fileName, bytes.byteLength);
    },
    [run],
  );

  const reset = useCallback(() => {
    requestRef.current += 1;
    setState({ status: 'idle' });
  }, []);

  return { state, loadFile, loadBytes, reset };
}

function ensureWorker(ref: RefObject<Worker | null>): Worker | null {
  if (ref.current) return ref.current;
  if (typeof Worker === 'undefined') return null;

  try {
    ref.current = new Worker(new URL('../parser/parseWorker.ts', import.meta.url), {
      type: 'module',
    });
    return ref.current;
  } catch {
    return null;
  }
}
