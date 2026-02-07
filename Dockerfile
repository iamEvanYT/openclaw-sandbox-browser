FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Detect architecture and set variables
ARG TARGETARCH

# Install dependencies
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
    gnupg \
    novnc \
    socat \
    unzip \
    websockify \
    wget \
    x11-utils \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

# Install Chrome/Chromium based on architecture
# Google Chrome only supports amd64, so use Chromium for arm64
RUN if [ "$TARGETARCH" = "amd64" ]; then \
      wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome-keyring.gpg \
      && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
      && apt-get update \
      && apt-get install -y --no-install-recommends google-chrome-stable; \
    else \
      apt-get update \
      && apt-get install -y --no-install-recommends chromium; \
    fi \
  && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash \
  && mv /root/.bun/bin/bun /usr/local/bin/

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN bun install

# Copy source code
COPY src ./src

EXPOSE 9222 5900 6080

CMD ["bun", "run", "start"]
