function envNumber(key: string, fallback: number): number {
  return Number(process.env[key] ?? fallback);
}

function envFlag(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw !== "0" && raw !== "false";
}

const CDP_TARGET = process.env.CDP_TARGET ?? "http://localhost:9222";
const targetBase = new URL(CDP_TARGET);

export const config = {
  port: envNumber("PORT", 9333),
  cdpTarget: CDP_TARGET,
  clickHoldMin: envNumber("CLICK_HOLD_MIN", 50),
  clickHoldMax: envNumber("CLICK_HOLD_MAX", 200),
  jitterRange: envNumber("JITTER_RANGE", 2),
  typeDelayMin: envNumber("TYPE_DELAY_MIN", 30),
  typeDelayMax: envNumber("TYPE_DELAY_MAX", 120),
  wordPauseMin: envNumber("WORD_PAUSE_MIN", 100),
  wordPauseMax: envNumber("WORD_PAUSE_MAX", 300),
  keyboardHumanize: envFlag("KEYBOARD_HUMANIZE", true),
  injectedIdStart: 1_000_000,
  targetBase,
  targetWsOrigin:
    (targetBase.protocol === "https:" ? "wss:" : "ws:") +
    "//" +
    targetBase.host,
} as const;

export type Config = typeof config;
