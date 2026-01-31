FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
    git \
    gnupg \
    jq \
    novnc \
    python3 \
    socat \
    websockify \
    wget \
    x11vnc \
    xvfb \
  && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

COPY sandbox-browser-entrypoint.sh /usr/local/bin/openclaw-sandbox-browser
RUN chmod +x /usr/local/bin/openclaw-sandbox-browser

EXPOSE 9222 5900 6080

CMD ["openclaw-sandbox-browser"]
