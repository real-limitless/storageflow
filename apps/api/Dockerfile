FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev
COPY packages/domain packages/domain
COPY packages/storage packages/storage
COPY apps/api apps/api
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "--import", "tsx", "apps/api/src/index.ts"]
