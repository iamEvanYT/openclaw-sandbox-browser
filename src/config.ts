export const config = {
  cdpPort: Number(process.env.CLAWDBOT_BROWSER_CDP_PORT) || 9222,
  vncPort: Number(process.env.CLAWDBOT_BROWSER_VNC_PORT) || 5900,
  noVncPort: Number(process.env.CLAWDBOT_BROWSER_NOVNC_PORT) || 6080,
  enableNoVnc: process.env.CLAWDBOT_BROWSER_ENABLE_NOVNC !== "0",
  headless: process.env.CLAWDBOT_BROWSER_HEADLESS === "1",
  display: ":1",
  home: "/home/openclaw-browser",
};

export const chromeCdpPort =
  config.cdpPort >= 65535 ? config.cdpPort - 1 : config.cdpPort + 1;
