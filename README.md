# OpenClaw Sandbox Browser

A Dockerized Google Chrome browser with CDP (Chrome DevTools Protocol) support for browser automation.

## Quick Start

### Build the image

```bash
./build.sh
```

### Run the container (IMPORTANT: Use --shm-size)

**You MUST specify `--shm-size=2gb` (or larger) when running the container.**

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
    shm_size: 2gb # <-- This is required!
    ports:
      - "9222:9222"
```

## Why --shm-size is Required

This image removed the `--disable-dev-shm-usage` flag from Chrome to fix click operation timeouts. Without this flag, Chrome uses `/dev/shm` for temporary storage during operations like:

- Calculating element bounding boxes for clicks
- Rendering complex pages
- JavaScript execution

If you don't provide adequate SHM, Chrome will crash or hang when performing element-based interactions like `Input.dispatchMouseEvent`.

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

## Recent Changes

### Fixed: Click Operation Timeouts

**Problem**: `Input.dispatchMouseEvent` (click operations) were timing out after 20,000ms while keyboard events worked fine.

**Root Cause**: The `--disable-dev-shm-usage` flag forced Chrome to use disk instead of shared memory for temporary storage, causing severe performance degradation during element coordinate calculations.

**Solution**:

1. Removed `--disable-dev-shm-usage` flag
2. Added TCP keepalive options to socat proxy to reduce connection latency
3. Added performance optimization flags for Chrome
4. **IMPORTANT**: Users must now run containers with `--shm-size=2gb` or larger

## Testing

To verify clicks work:

```bash
# Connect to CDP and test a click operation
curl http://localhost:9222/json/version
```

## Troubleshooting

### "Can't reach the openclaw browser control service (timed out after 20000ms)"

1. **Check SHM size**: Ensure you're using `--shm-size=2gb` or larger
2. **Check container logs**: `docker logs <container_id>`
3. **Verify CDP is accessible**: `curl http://localhost:9222/json/version`

### Slow click operations

Increase SHM size: `--shm-size=4gb`

### Chrome crashes

Check if the host has adequate shared memory available or increase `--shm-size`.
