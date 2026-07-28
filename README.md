# Agent Sandbox Browser

Dockerized Chromium sandbox for AI agent automation. Chrome 150 with CDP, VNC, and noVNC.

## Quick Start

### Build

```bash
./build.sh
```

### Run with Docker Compose (Recommended)

**Important**: Use `shm_size: 2gb` (not `--shm-size`). Without enough shared memory, Chrome will crash or time out on clicks.

```yaml
services:
  browser:
    image: agent-sandbox-browser:bookworm-slim
    shm_size: 2gb
    ports:
      - "9222:9222"
      - "5900:5900"
      - "6080:6080"
    volumes:
      - chrome-data:/home/agent/.chrome
    environment:
      HEADLESS: "0"
      ENABLE_NOVNC: "1"
      KEYBOARD_HUMANIZE: "1"

volumes:
  chrome-data:
```

### Run with Docker

```bash
# Non-headless (with VNC/noVNC)
docker run -d \
  --shm-size=2gb \
  -p 9222:9222 \
  -p 5900:5900 \
  -p 6080:6080 \
  -v chrome-data:/home/agent/.chrome \
  agent-sandbox-browser:bookworm-slim

# Headless (no display, CDP only)
docker run -d \
  --shm-size=2gb \
  -e HEADLESS=1 \
  -e ENABLE_NOVNC=0 \
  -p 9222:9222 \
  agent-sandbox-browser:bookworm-slim
```

## Ports

| Port | Service | Notes |
| ---- | ------- | ----- |
| 9222 | CDP | Chrome DevTools Protocol — main API for browser control |
| 5900 | VNC | Direct VNC (headless mode disables this) |
| 6080 | noVNC | Web VNC client at http://localhost:6080/vnc.html |

## Environment Variables

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `HEADLESS` | `0` | Run headless (`1` to enable) |
| `ENABLE_NOVNC` | `1` | Enable noVNC (`0` to disable) |
| `ENABLE_HUMANIZE` | `1` | Humanize CDP mouse/keyboard input (`0` for raw socat passthrough) |
| `KEYBOARD_HUMANIZE` | `1` | Delay typed chars inside the humanize proxy (`0` to disable) |
| `TYPE_DELAY_MIN` | `30` | Min delay (ms) before forwarding each `char` key event |
| `TYPE_DELAY_MAX` | `120` | Max delay (ms) before forwarding each `char` key event |
| `WORD_PAUSE_MIN` | `100` | Min pause (ms) before the next char after space/enter/./, |
| `WORD_PAUSE_MAX` | `300` | Max pause (ms) before the next char after space/enter/./, |

### Mouse & keyboard humanization (`ENABLE_HUMANIZE`)

When enabled (default), a CDP proxy sits on port 9222 in front of Chrome's internal CDP port 9223. It intercepts `Input.dispatchMouseEvent` and injects physiologically realistic cursor paths before clicks:

- **Meyer submovements** — primary ballistic move (85–95% of distance) plus 1–3 corrective submovements
- **Flash–Hogan minimum-jerk** — bell-shaped velocity profile peaking ~40% through each submovement
- **Fitts' Law timing** — movement duration scales with distance (≈150ms for 50px, 500ms+ for 500px)
- **Tremor** — 8–12Hz sinusoidal noise, amplitude ∝ velocity, fading near the target
- **Overshoot** — ~12.5% of moves overshoot slightly then correct

It also intercepts `Input.dispatchKeyEvent` (when `KEYBOARD_HUMANIZE=1`):

- **Per-character delay** — `char` events wait a random `TYPE_DELAY_MIN`–`TYPE_DELAY_MAX` ms before forwarding
- **Word pauses** — after keyUp on space, enter, period, or comma, the next char waits `WORD_PAUSE_MIN`–`WORD_PAUSE_MAX` ms
- **Modifiers / arrows** — non-char keyDown and all keyUp events forward immediately

Set `ENABLE_HUMANIZE=0` to skip the proxy and use socat TCP passthrough instead (no mouse/keyboard injection). Set `KEYBOARD_HUMANIZE=0` to keep mouse humanization but pass key events through unchanged.

Compose example:

```yaml
environment:
  HEADLESS: "0"
  ENABLE_NOVNC: "1"
  ENABLE_HUMANIZE: "1"
  KEYBOARD_HUMANIZE: "1"
  TYPE_DELAY_MIN: "30"
  TYPE_DELAY_MAX: "120"
  WORD_PAUSE_MIN: "100"
  WORD_PAUSE_MAX: "300"
```

### Headless vs Non-Headless

| | Non-Headless (`HEADLESS=0`) | Headless (`HEADLESS=1`) |
| --- | --- | --- |
| **Display** | Xvfb virtual framebuffer | None |
| **CDP** | ✅ port 9222 | ✅ port 9222 |
| **VNC** | ✅ port 5900 | ❌ disabled |
| **noVNC** | ✅ port 6080 (if `ENABLE_NOVNC=1`) | ❌ disabled |
| **Memory** | ~300MB+ (Xvfb + Chrome GPU) | ~150MB (Chrome only) |
| **Use for** | Visual debugging, interactive sessions | Headless automation, agent use |

**Note**: VNC and noVNC are silently disabled in headless mode regardless of `ENABLE_NOVNC`. |

## Persisting Browser Data

Mount a volume to `/home/agent/.chrome` to persist cookies, local storage, history, and cache across restarts:

```bash
docker run -d --shm-size=2gb -p 9222:9222 -v chrome-data:/home/agent/.chrome agent-sandbox-browser:bookworm-slim
```

Or with Docker Compose (see `volumes:` in the example above).
