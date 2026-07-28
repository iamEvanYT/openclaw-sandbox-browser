import { config } from "./config";
import { rand, sendToTarget, sleep } from "./mouse";
import type { CdpMessage, WsData } from "./types";

const WORD_END_KEYS = new Set([" ", "Enter", ".", ","]);
const WORD_END_CODES = new Set(["Space", "Enter", "Period", "Comma", "NumpadEnter"]);

/** Per-connection burst state for stderr logging (not on WsData — logging only). */
const burstState = new WeakMap<
  WsData,
  {
    text: string;
    keys: number;
    startMs: number;
    timer: ReturnType<typeof setTimeout> | null;
  }
>();

function endsWord(params: Record<string, unknown>): boolean {
  const key = typeof params.key === "string" ? params.key : "";
  const code = typeof params.code === "string" ? params.code : "";
  const text = typeof params.text === "string" ? params.text : "";
  const unmodified =
    typeof params.unmodifiedText === "string" ? params.unmodifiedText : "";

  if (WORD_END_KEYS.has(key) || WORD_END_CODES.has(code)) return true;
  if (text === " " || text === "." || text === "," || text === "\r" || text === "\n") {
    return true;
  }
  if (
    unmodified === " " ||
    unmodified === "." ||
    unmodified === "," ||
    unmodified === "\r" ||
    unmodified === "\n"
  ) {
    return true;
  }
  return false;
}

function flushBurst(data: WsData): void {
  const burst = burstState.get(data);
  if (!burst || burst.keys === 0) return;
  if (burst.timer) {
    clearTimeout(burst.timer);
    burst.timer = null;
  }
  const elapsed = Date.now() - burst.startMs;
  console.error(`kb: "${burst.text}" ${burst.keys} keys ${elapsed}ms`);
  burst.text = "";
  burst.keys = 0;
  burst.startMs = 0;
}

function noteBurstKey(data: WsData, params: Record<string, unknown>): void {
  let burst = burstState.get(data);
  if (!burst) {
    burst = { text: "", keys: 0, startMs: 0, timer: null };
    burstState.set(data, burst);
  }
  if (burst.keys === 0) {
    burst.startMs = Date.now();
    burst.text = "";
  }
  burst.keys += 1;

  const type = params.type as string | undefined;
  if (type === "char") {
    const text =
      (typeof params.text === "string" && params.text) ||
      (typeof params.unmodifiedText === "string" && params.unmodifiedText) ||
      "";
    burst.text += text;
  }

  if (burst.timer) clearTimeout(burst.timer);
  // Flush once typing has clearly stopped (past max word pause).
  burst.timer = setTimeout(() => flushBurst(data), config.wordPauseMax + 80);
}

export function enqueueKeyboard(data: WsData, task: () => Promise<void>): void {
  data.keyboardTail = data.keyboardTail.then(task, task);
}

export async function handleKeyEvent(
  data: WsData,
  msg: CdpMessage,
): Promise<void> {
  const params = msg.params ?? {};
  const type = params.type as string | undefined;

  if (!config.keyboardHumanize) {
    sendToTarget(data, msg);
    return;
  }

  noteBurstKey(data, params);

  if (type === "char") {
    let delayMs = rand(config.typeDelayMin, config.typeDelayMax);
    if (data.pendingWordPause) {
      delayMs = rand(config.wordPauseMin, config.wordPauseMax);
      data.pendingWordPause = false;
    }
    await sleep(delayMs);
    sendToTarget(data, msg);
    return;
  }

  // Non-char keyDown / rawKeyDown / all keyUp — forward immediately.
  sendToTarget(data, msg);

  if (type === "keyUp" && endsWord(params)) {
    data.pendingWordPause = true;
  }
}
