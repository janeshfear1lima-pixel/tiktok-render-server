FROM node:20-slim

# Instala o yt-dlp (binário único, já vem pronto — sem precisar instalar Python)
RUN apt-get update && apt-get install -y curl ca-certificates && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .

ENV PORT=10000
EXPOSE 10000
CMD ["node", "server.js"]
