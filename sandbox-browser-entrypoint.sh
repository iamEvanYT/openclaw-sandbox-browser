#!/usr/bin/env bash
set -euo pipefail

# PID for Chrome process
CHROME_PID=""

# Graceful shutdown function
shutdown() {
  echo "Shutting down Chrome gracefully..."
  
  if [[ -n "${CHROME_PID}" ]] && kill -0 "${CHROME_PID}" 2>/dev/null; then
    kill -TERM "${CHROME_PID}" 2>/dev/null || true
    # Wait up to 10 seconds for Chrome to exit
    for _ in $(seq 1 100); do
      if ! kill -0 "${CHROME_PID}" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    # Force kill if still running
    kill -KILL "${CHROME_PID}" 2>/dev/null || true
  fi
  
  exit 0
}

trap shutdown TERM INT

export DISPLAY=:1
export HOME=/tmp/openclaw-home
export XDG_CONFIG_HOME="${HOME}/.config"
export XDG_CACHE_HOME="${HOME}/.cache"

CDP_PORT="${CLAWDBOT_BROWSER_CDP_PORT:-9222}"
VNC_PORT="${CLAWDBOT_BROWSER_VNC_PORT:-5900}"
NOVNC_PORT="${CLAWDBOT_BROWSER_NOVNC_PORT:-6080}"
ENABLE_NOVNC="${CLAWDBOT_BROWSER_ENABLE_NOVNC:-1}"
HEADLESS="${CLAWDBOT_BROWSER_HEADLESS:-0}"

mkdir -p "${HOME}" "${HOME}/.chrome" "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}"

# Remove stale Chrome lockfiles from previous runs
rm -f "${HOME}/.chrome/SingletonLock"
rm -f "${HOME}/.chrome/SingletonSocket"
rm -f "${HOME}/.chrome/SingletonCookie"

Xvfb :1 -screen 0 1280x800x24 -ac -nolisten tcp &

if [[ "${HEADLESS}" == "1" ]]; then
  CHROME_ARGS=(
    "--headless=new"
    "--disable-gpu"
  )
else
  CHROME_ARGS=()
fi

if [[ "${CDP_PORT}" -ge 65535 ]]; then
  CHROME_CDP_PORT="$((CDP_PORT - 1))"
else
  CHROME_CDP_PORT="$((CDP_PORT + 1))"
fi

CHROME_ARGS+=(
  "--remote-debugging-address=0.0.0.0"
  "--remote-debugging-port=${CHROME_CDP_PORT}"
  "--user-data-dir=${HOME}/.chrome"
  "--no-first-run"
  "--no-default-browser-check"
  "--disable-dev-shm-usage"
  "--disable-background-networking"
  "--disable-features=TranslateUI"
  "--disable-breakpad"
  "--disable-crash-reporter"
  "--metrics-recording-only"
  "--no-sandbox"
)

chromium "${CHROME_ARGS[@]}" about:blank &
CHROME_PID=$!

for _ in $(seq 1 50); do
  if curl -sS --max-time 1 "http://127.0.0.1:${CHROME_CDP_PORT}/json/version" >/dev/null; then
    break
  fi
  sleep 0.1
done

socat \
  TCP-LISTEN:"${CDP_PORT}",fork,reuseaddr,bind=0.0.0.0 \
  TCP:127.0.0.1:"${CHROME_CDP_PORT}" &

if [[ "${ENABLE_NOVNC}" == "1" && "${HEADLESS}" != "1" ]]; then
  x11vnc -display :1 -rfbport "${VNC_PORT}" -shared -forever -nopw -localhost &
  websockify --web /usr/share/novnc/ "${NOVNC_PORT}" "localhost:${VNC_PORT}" &
fi

wait -n