import type { Subprocess } from "bun";
import { config } from "./config";
import { log } from "./log";
import { ensureDirectories } from "./cleanup";
import { isRunning, killProcess } from "./process";
import { startXvfb } from "./services/xvfb";
import { startChrome } from "./services/chrome";
import { startSocat } from "./services/socat";
import { startHumanize } from "./services/humanize";
import { startX11Vnc, startWebsockify } from "./services/vnc";

let xvfbProc: Subprocess | null = null;
let chromeProc: Subprocess | null = null;
let cdpProxyProc: Subprocess | null = null;
let x11vncProc: Subprocess | null = null;
let websockifyProc: Subprocess | null = null;

function startCdpProxy(): Subprocess {
  return config.enableHumanize ? startHumanize() : startSocat();
}

function cdpProxyName(): string {
  return config.enableHumanize ? "humanize proxy" : "socat";
}

async function shutdown() {
  log("Shutting down...");

  await Promise.all([
    killProcess(chromeProc, "Chrome"),
    killProcess(cdpProxyProc, cdpProxyName()),
    killProcess(x11vncProc, "x11vnc"),
    killProcess(websockifyProc, "websockify"),
  ]);

  await killProcess(xvfbProc, "Xvfb");

  process.exit(0);
}

async function monitor() {
  while (true) {
    await Bun.sleep(2000);

    // Check Xvfb
    if (!isRunning(xvfbProc)) {
      log("Xvfb crashed, restarting...");
      xvfbProc = await startXvfb();
      // Chrome needs X, so restart it too
      await killProcess(chromeProc, "Chrome");
      chromeProc = await startChrome();
    }

    // Check Chrome
    if (!isRunning(chromeProc)) {
      log("Chrome crashed, restarting...");
      chromeProc = await startChrome();
    }

    // Check CDP proxy (humanize or socat)
    if (!isRunning(cdpProxyProc)) {
      log(`${cdpProxyName()} crashed, restarting...`);
      cdpProxyProc = startCdpProxy();
    }

    // Check VNC services
    if (config.enableNoVnc && !config.headless) {
      if (!isRunning(x11vncProc)) {
        log("x11vnc crashed, restarting...");
        x11vncProc = startX11Vnc();
      }
      if (!isRunning(websockifyProc)) {
        log("websockify crashed, restarting...");
        websockifyProc = startWebsockify();
      }
    }
  }
}

async function main() {
  log("Starting agent sandbox...");

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  ensureDirectories();

  xvfbProc = await startXvfb();
  chromeProc = await startChrome();

  cdpProxyProc = startCdpProxy();
  log(
    config.enableHumanize
      ? "CDP proxy listening on port 9222 (humanized)"
      : "CDP proxy listening on port 9222 (passthrough)",
  );

  if (config.enableNoVnc && !config.headless) {
    x11vncProc = startX11Vnc();
    websockifyProc = startWebsockify();
    log("noVNC available on port 6080");
  }

  await monitor();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
