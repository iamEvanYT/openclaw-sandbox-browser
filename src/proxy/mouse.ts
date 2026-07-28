/**
 * Based on humanize-cdp (https://github.com/pip-owl/humanize-cdp)
 *
 * MIT License
 *
 * Copyright (c) the humanize-cdp authors
 */

import { config } from "./config";
import type { CdpMessage, Point, Submove, WsData } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function plusMinus(max: number): number {
  return (Math.random() < 0.5 ? -1 : 1) * rand(0, max);
}

// ─── Motion model ─────────────────────────────────────────────────────────────
// Human pointing: Meyer submovements + Flash–Hogan minimum-jerk + Fitts timing.
// Gross path is a cubic Bézier (arm approach angle); progress along it is
// minimum-jerk per submovement, sampled at velocity-dependent rates with
// physiological tremor and occasional overshoot.

const FITTS_A = -95; // ms — calibrated so ~50px ≈ 150ms, ~500px ≈ 450–550ms
const FITTS_B = 105; // ms / bit
const TARGET_W = 20; // px — effective target width for Fitts' ID
const SAME_SPOT_PX = 3;

/** Minimum-jerk progress σ(τ) = 10τ³ − 15τ⁴ + 6τ⁵ (Flash & Hogan). Peak |v| at τ=0.5. */
function minJerk(tau: number): number {
  const t = clamp(tau, 0, 1);
  return t * t * t * (10 + t * (-15 + t * 6));
}

/** Analytic min-jerk speed factor (unnormalized); used for sampling density & tremor. */
function minJerkSpeed(tau: number): number {
  const t = clamp(tau, 0, 1);
  return 30 * t * t * (1 - t) * (1 - t);
}

function cubicBezier(
  t: number,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
): Point {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

/** Fitts' law movement time: MT = a + b · log₂(2D/W). */
function fittsDuration(dist: number, targetW = TARGET_W): number {
  const id = Math.log2(Math.max((2 * dist) / targetW, 1.05));
  const mt = FITTS_A + FITTS_B * id + rand(-35, 45);
  return clamp(mt, 90, 1100);
}

function planSubmovements(
  dist: number,
  totalMs: number,
  overshoot: boolean,
): Submove[] {
  const subs: Submove[] = [];

  // Primary covers ~85–95% of distance (or past 1.0 if overshooting).
  const primaryFrac = overshoot
    ? 1 + rand(5, 15) / Math.max(dist, 1)
    : rand(0.85, 0.95);
  const primaryMs = totalMs * rand(0.68, 0.82);
  subs.push({
    s0: 0,
    s1: primaryFrac,
    durationMs: primaryMs,
    tremorAmp: rand(0.35, 0.9) * Math.min(dist / 80, 2.2),
  });

  let s = primaryFrac;
  let remainingMs = Math.max(totalMs - primaryMs, 25);

  if (overshoot) {
    // Tiny corrective snap back onto target.
    const corrMs = clamp(remainingMs * rand(0.45, 0.7), 20, 90);
    subs.push({
      s0: s,
      s1: 1,
      durationMs: corrMs,
      tremorAmp: rand(0.05, 0.2),
    });
    return subs;
  }

  // 1–3 corrective submovements near the target (Meyer et al.).
  const nCorrect =
    dist < 80
      ? 1
      : dist < 250
        ? Math.random() < 0.55
          ? 1
          : 2
        : Math.floor(rand(1, 3.999));
  for (let i = 0; i < nCorrect; i++) {
    const last = i === nCorrect - 1;
    const s1 = last ? 1 : s + (1 - s) * rand(0.45, 0.75);
    const share = last ? 1 : rand(0.35, 0.55);
    const dur = Math.max(remainingMs * share, 18);
    remainingMs = Math.max(remainingMs - dur, 12);
    subs.push({
      s0: s,
      s1,
      durationMs: dur,
      tremorAmp: rand(0.04, 0.25) * (1 - s),
    });
    s = s1;
  }

  return subs;
}

function pointOnPath(
  s: number,
  p0: Point,
  cp1: Point,
  cp2: Point,
  p3: Point,
): Point {
  if (s <= 1) return cubicBezier(s, p0, cp1, cp2, p3);
  // Overshoot: extend past the target along the terminal tangent.
  const end = cubicBezier(1, p0, cp1, cp2, p3);
  const near = cubicBezier(0.98, p0, cp1, cp2, p3);
  const ex = end.x - near.x;
  const ey = end.y - near.y;
  const el = Math.hypot(ex, ey) || 1;
  const over = (s - 1) * Math.hypot(p3.x - p0.x, p3.y - p0.y);
  return { x: end.x + (ex / el) * over, y: end.y + (ey / el) * over };
}

function sampleSubmovement(
  sub: Submove,
  p0: Point,
  cp1: Point,
  cp2: Point,
  p3: Point,
  tremorHz: number,
  tremorPhase: number,
  absoluteMs: number,
  isLast: boolean,
): { points: Point[]; delays: number[]; elapsed: number } {
  const points: Point[] = [];
  const delays: number[] = [];

  // Asymmetric peak (~40% of duration): map real-time u so min-jerk's
  // natural mid-peak (τ=0.5) lands at peakAt.
  const peakAt = rand(0.36, 0.44);
  const warp = (u: number): number => {
    if (u <= peakAt) return (u / peakAt) * 0.5;
    return 0.5 + ((u - peakAt) / (1 - peakAt)) * 0.5;
  };

  let tMs = 0;
  // Always emit a sample at τ=0 of this submovement, then step by variable dt.
  for (;;) {
    const u = clamp(tMs / Math.max(sub.durationMs, 1), 0, 1);
    const tau = warp(u);
    const sigma = minJerk(tau);
    const s = sub.s0 + (sub.s1 - sub.s0) * sigma;
    const pt = pointOnPath(s, p0, cp1, cp2, p3);

    const speed = minJerkSpeed(tau);
    // Tremor ∝ velocity; fades during fine control near target.
    const fade =
      Math.abs(sub.s1 - 1) < 0.02 && sigma > 0.75
        ? 0.12
        : 1 - sigma * 0.4;
    const amp = sub.tremorAmp * (0.2 + 0.8 * (speed / 1.875)) * fade;
    const phase =
      tremorPhase + ((absoluteMs + tMs) / 1000) * tremorHz * Math.PI * 2;

    let x = pt.x + Math.sin(phase) * amp;
    let y = pt.y + Math.cos(phase * 1.13 + 0.7) * amp * 0.85;

    if (config.jitterRange > 0 && sigma < 0.95) {
      x += rand(-config.jitterRange * 0.3, config.jitterRange * 0.3);
      y += rand(-config.jitterRange * 0.3, config.jitterRange * 0.3);
    }

    const atEnd = tMs >= sub.durationMs - 0.5;
    if (isLast && atEnd) {
      x = p3.x;
      y = p3.y;
    }

    points.push({ x, y });

    if (atEnd) break;

    // Variable sampling: ballistic 8–16ms, fine control 2–8ms.
    const ballistic = speed > 0.55 && sigma < 0.85;
    let dt = ballistic ? rand(8, 16) : rand(2, 8);
    if (tMs + dt > sub.durationMs) dt = sub.durationMs - tMs;
    delays.push(dt);
    tMs += dt;
  }

  // Trailing delay after the final sample (pause before next submovement / click).
  const delaySum = delays.reduce((a, b) => a + b, 0);
  const tail = Math.max(sub.durationMs - delaySum, 0);
  delays.push(tail > 0 ? tail : rand(2, 5));

  // Keep points.length === delays.length
  while (delays.length < points.length) delays.push(rand(2, 5));
  while (delays.length > points.length) delays.pop();

  const elapsed = delays.reduce((a, b) => a + b, 0);
  return { points, delays, elapsed };
}

export function generatePath(
  from: Point,
  to: Point,
): { points: Point[]; delays: number[]; totalMs: number } {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);

  // Same-spot double-click / re-click: no approach path.
  if (dist < SAME_SPOT_PX) {
    const hold = rand(30, 80);
    const points = [
      {
        x: to.x + rand(-1, 1),
        y: to.y + rand(-1, 1),
      },
    ];
    return { points, delays: [hold], totalMs: hold };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const nx = dist > 0 ? -dy / dist : 0;
  const ny = dist > 0 ? dx / dist : 0;

  // Subtle arm-biased curve (not a huge arc) — approach angle from hand posture.
  const curveSign = Math.random() < 0.5 ? 1 : -1;
  const curveMag = dist * rand(0.12, 0.28) * curveSign;
  const cp1: Point = {
    x: from.x + dx * rand(0.25, 0.4) + nx * curveMag,
    y: from.y + dy * rand(0.25, 0.4) + ny * curveMag,
  };
  const cp2: Point = {
    x: from.x + dx * rand(0.6, 0.78) + nx * curveMag * rand(0.3, 0.7),
    y: from.y + dy * rand(0.6, 0.78) + ny * curveMag * rand(0.3, 0.7),
  };

  const totalPlanned = fittsDuration(dist);
  const overshoot = Math.random() < 0.125;
  const subs = planSubmovements(dist, totalPlanned, overshoot);

  const tremorHz = rand(8, 12);
  const tremorPhase = rand(0, Math.PI * 2);

  const points: Point[] = [];
  const delays: number[] = [];
  let totalMs = 0;
  let clock = 0;

  for (let i = 0; i < subs.length; i++) {
    const sub = subs[i]!;
    const { points: pts, delays: dts, elapsed } = sampleSubmovement(
      sub,
      from,
      cp1,
      cp2,
      to,
      tremorHz,
      tremorPhase,
      clock,
      i === subs.length - 1,
    );
    for (let j = 0; j < pts.length; j++) {
      points.push(pts[j]!);
      delays.push(dts[j]!);
    }
    totalMs += elapsed;
    clock += elapsed;
  }

  // Guarantee we land on the target.
  if (points.length === 0) {
    points.push({ x: to.x, y: to.y });
    delays.push(totalPlanned);
    totalMs = totalPlanned;
  } else {
    const last = points[points.length - 1]!;
    last.x = to.x;
    last.y = to.y;
  }

  return { points, delays, totalMs };
}

// ─── CDP send / inject plumbing ───────────────────────────────────────────────

export function sendToTarget(data: WsData, msg: CdpMessage): void {
  if (!data.target || data.target.readyState !== WebSocket.OPEN) return;
  data.target.send(JSON.stringify(msg));
}

function injectId(data: WsData): number {
  const id = data.nextInjectedId++;
  data.pendingInjected.add(id);
  return id;
}

/** Resolvers for injected CDP calls that need a result (e.g. getLayoutMetrics) */
export const injectedWaiters = new Map<
  number,
  (result: Record<string, unknown> | null) => void
>();

async function fetchViewport(data: WsData, sessionId?: string): Promise<void> {
  if (!data.target || data.target.readyState !== WebSocket.OPEN) {
    data.viewportW = 1280;
    data.viewportH = 720;
    data.hasViewport = true;
    return;
  }

  const id = injectId(data);
  const msg: CdpMessage = {
    id,
    method: "Page.getLayoutMetrics",
  };
  if (sessionId) msg.sessionId = sessionId;

  const result = await new Promise<Record<string, unknown> | null>((resolve) => {
    const timeout = setTimeout(() => {
      data.pendingInjected.delete(id);
      injectedWaiters.delete(id);
      resolve(null);
    }, 1500);

    injectedWaiters.set(id, (res) => {
      clearTimeout(timeout);
      resolve(res);
    });
    sendToTarget(data, msg);
  });

  if (!result) {
    data.viewportW = 1280;
    data.viewportH = 720;
    data.hasViewport = true;
    return;
  }

  const cssVisual = result.cssVisualViewport as
    | { clientWidth?: number; clientHeight?: number }
    | undefined;
  const layout = result.layoutViewport as
    | { clientWidth?: number; clientHeight?: number }
    | undefined;
  const visual = result.visualViewport as
    | { clientWidth?: number; clientHeight?: number }
    | undefined;

  data.viewportW =
    cssVisual?.clientWidth ??
    layout?.clientWidth ??
    visual?.clientWidth ??
    1280;
  data.viewportH =
    cssVisual?.clientHeight ??
    layout?.clientHeight ??
    visual?.clientHeight ??
    720;
  data.hasViewport = true;
}

async function startPosition(
  data: WsData,
  sessionId?: string,
): Promise<Point> {
  if (data.hasPosition) {
    return { x: data.lastX, y: data.lastY };
  }
  if (!data.hasViewport) {
    await fetchViewport(data, sessionId);
  }
  return {
    x: data.viewportW / 2 + plusMinus(50),
    y: data.viewportH / 2 + plusMinus(50),
  };
}

export async function injectMoves(
  data: WsData,
  points: Point[],
  delays: number[],
  sessionId?: string,
): Promise<void> {
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const id = injectId(data);
    const msg: CdpMessage = {
      id,
      method: "Input.dispatchMouseEvent",
      params: {
        type: "mouseMoved",
        x: p.x,
        y: p.y,
        buttons: data.buttons,
        pointerType: "mouse",
      },
    };
    if (sessionId) msg.sessionId = sessionId;
    sendToTarget(data, msg);
    await sleep(delays[i]!);
  }
}

export function enqueueMouse(data: WsData, task: () => Promise<void>): void {
  data.mouseTail = data.mouseTail.then(task, task);
}

export async function handleMouseEvent(
  data: WsData,
  msg: CdpMessage,
): Promise<void> {
  const params = msg.params ?? {};
  const type = params.type as string | undefined;
  const x = Number(params.x ?? 0);
  const y = Number(params.y ?? 0);
  const buttons = typeof params.buttons === "number" ? params.buttons : 0;
  const sessionId = msg.sessionId;

  if (type === "mousePressed") {
    const wasUp = data.buttons === 0;

    if (wasUp) {
      // Click: inject approach path, then forward press
      const from = await startPosition(data, sessionId);
      const { points, delays, totalMs } = generatePath(from, { x, y });

      console.error(
        `mouse: (${Math.round(from.x)},${Math.round(from.y)})→(${Math.round(x)},${Math.round(y)}) ${points.length} pts ${Math.round(totalMs)}ms`,
      );

      await injectMoves(data, points, delays, sessionId);

      data.pressForwardedAt = Date.now();
      sendToTarget(data, msg);
    } else {
      // Drag in progress — pass through untouched
      data.pressForwardedAt = Date.now();
      sendToTarget(data, msg);
    }

    data.buttons = buttons;
    data.lastX = x;
    data.lastY = y;
    data.hasPosition = true;
    return;
  }

  if (type === "mouseReleased") {
    if (data.pressForwardedAt !== null) {
      const hold = rand(config.clickHoldMin, config.clickHoldMax);
      const elapsed = Date.now() - data.pressForwardedAt;
      const remaining = hold - elapsed;
      if (remaining > 0) await sleep(remaining);
    }

    sendToTarget(data, msg);
    data.buttons = buttons;
    data.lastX = x;
    data.lastY = y;
    data.hasPosition = true;
    data.pressForwardedAt = null;
    return;
  }

  // mouseMoved, mouseWheel, etc. — pass through
  sendToTarget(data, msg);
  if (type === "mouseMoved") {
    data.lastX = x;
    data.lastY = y;
    data.hasPosition = true;
  }
  if (typeof params.buttons === "number") {
    data.buttons = buttons;
  }
}
