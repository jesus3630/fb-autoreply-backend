FROM ghcr.io/puppeteer/puppeteer:22 AS build
USER root
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ghcr.io/puppeteer/puppeteer:22
USER root
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /root/.cache/puppeteer /root/.cache/puppeteer

EXPOSE 3000
CMD ["node", "dist/main.js"]
