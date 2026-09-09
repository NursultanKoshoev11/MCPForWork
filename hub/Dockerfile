FROM node:22-alpine
WORKDIR /app
COPY hub/package.json ./package.json
RUN npm install --omit=dev
COPY hub/src ./src
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.mjs"]
