# OpenClaw Sandbox Browser

A Dockerized Google Chrome browser with CDP (Chrome DevTools Protocol) support for browser automation.

## Quick Start

### Build the image

```bash
./build.sh
```

### Run the container

**It is recommended to specify `--shm-size=2gb` (or larger) when running the container.**

```bash
# Non-headless mode (with VNC/NoVNC)
docker run -d \
  --shm-size=2gb \
  -p 9222:9222 \
  -p 5900:5900 \
  -p 6080:6080 \
  ghcr.io/iamevanyt/openclaw-sandbox-browser

# Headless mode
docker run -d \
  --shm-size=2gb \
  -e CLAWDBOT_BROWSER_HEADLESS=1 \
  -p 9222:9222 \
  ghcr.io/iamevanyt/openclaw-sandbox-browser
```

### Run with Docker Compose (Recommended)

The key setting is `shm_size: 2gb`:

**Important**: In Docker Compose, use `shm_size` (not `--shm-size`):

```yaml
services:
  browser:
    image: ghcr.io/iamevanyt/openclaw-sandbox-browser
    shm_size: 2gb
    ports:
      - "9222:9222"
```

## Ports

- **9222**: CDP (Chrome DevTools Protocol) - Main API for browser control
- **5900**: VNC (when not in headless mode)
- **6080**: NoVNC web client (when not in headless mode)

## Environment Variables

| Variable                        | Default | Description                           |
| ------------------------------- | ------- | ------------------------------------- |
| `CLAWDBOT_BROWSER_CDP_PORT`     | 9222    | CDP port                              |
| `CLAWDBOT_BROWSER_VNC_PORT`     | 5900    | VNC port                              |
| `CLAWDBOT_BROWSER_NOVNC_PORT`   | 6080    | NoVNC port                            |
| `CLAWDBOT_BROWSER_ENABLE_NOVNC` | 1       | Enable NoVNC (0 to disable)           |
| `CLAWDBOT_BROWSER_HEADLESS`     | 0       | Run in headless mode (1 for headless) |

## Persisting Browser Data

To persist browser data (cookies, local storage, history, etc.) across container restarts, mount a volume to `/home/sandbox-browser/.chrome`:

```bash
docker run -d \
  --shm-size=2gb \
  -p 9222:9222 \
  -v chrome-data:/home/sandbox-browser/.chrome \
  ghcr.io/iamevanyt/openclaw-sandbox-browser
```

Or with Docker Compose:

```yaml
services:
  browser:
    image: ghcr.io/iamevanyt/openclaw-sandbox-browser
    shm_size: 2gb
    ports:
      - "9222:9222"
    volumes:
      - chrome-data:/home/sandbox-browser/.chrome

volumes:
  chrome-data:
```
