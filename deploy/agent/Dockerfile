FROM node:22-bookworm-slim
ARG CODEX_VERSION=0.157.1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@${CODEX_VERSION} && npm cache clean --force
COPY --chown=node:node public/agent/origin-agent.mjs /opt/origin-agent.mjs
USER node
WORKDIR /home/node
ENTRYPOINT ["node", "/opt/origin-agent.mjs"]
