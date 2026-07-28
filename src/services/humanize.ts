import { spawn, type Subprocess } from "bun";

export function startHumanize(): Subprocess {
  return spawn({
    cmd: ["bun", "run", "src/proxy/index.ts"],
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      CDP_TARGET: "http://127.0.0.1:9223",
      PORT: "9222",
    },
  });
}
