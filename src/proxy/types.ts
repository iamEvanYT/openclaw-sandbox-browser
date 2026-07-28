export interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: unknown;
  error?: unknown;
}

export interface Point {
  x: number;
  y: number;
}

export interface WsData {
  path: string;
  target: WebSocket | null;
  ready: boolean;
  buffer: string[];
  lastX: number;
  lastY: number;
  hasPosition: boolean;
  buttons: number;
  pressForwardedAt: number | null;
  nextInjectedId: number;
  pendingInjected: Set<number>;
  mouseTail: Promise<void>;
  keyboardTail: Promise<void>;
  pendingWordPause: boolean;
  viewportW: number;
  viewportH: number;
  hasViewport: boolean;
}

export interface Submove {
  /** Path parameter s ∈ [0,1] along the Bézier at submovement start. */
  s0: number;
  /** Path parameter s ∈ [0,1] along the Bézier at submovement end. */
  s1: number;
  durationMs: number;
  /** Peak tremor scale for this submovement (px). */
  tremorAmp: number;
}
