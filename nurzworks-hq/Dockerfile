# NurzWorks HQ - zero dependencies, so the image is just Node + the app.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js mcp-stdio.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production PORT=4200 NW_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4200/api/session >/dev/null || exit 1
CMD ["node", "server.js"]
