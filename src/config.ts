export const config = {
  vncPort: 5900,
  noVncPort: 6080,
  enableNoVnc: process.env.ENABLE_NOVNC !== "0",
  enableHumanize: process.env.ENABLE_HUMANIZE !== "0",
  headless: process.env.HEADLESS === "1",
  display: ":1",
  home: "/home/agent",
};
