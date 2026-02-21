FROM node:20-slim

ARG DOCKER_GID=999
ARG ACT_VERSION=0.2.75

ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=info

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    python3 \
    python3-pip \
    git \
    wget \
    jq \
    make \
    zip \
    unzip \
    tar \
    openssh-client \
    vim \
    nano && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends gh docker-ce-cli && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -f -g "${DOCKER_GID}" docker && \
    usermod -aG docker node && \
    curl -fsSL "https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_x86_64.tar.gz" | tar -xz -C /usr/local/bin act && \
    chmod +x /usr/local/bin/act && \
    npm install -g @githubnext/github-copilot-cli

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY entrypoint.sh ./entrypoint.sh

RUN npm run build && chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
