import type { FaceResult } from './tracking';

export type TrackingWorkerMessage =
  | { type: 'ready' | 'delegate'; delegate: 'GPU' | 'CPU' }
  | { type: 'result'; result: FaceResult; elapsed: number }
  | { type: 'consumed' | 'tick' | 'error' };

// Classic worker: the pinned MediaPipe runtime loads its local WASM glue with importScripts.
// Studio serves the files at /mediapipe/; other sites pass their own worker URL.
export function createTrackingWorker(url = '/mediapipe/tracking-worker.js') { return new Worker(url); }
