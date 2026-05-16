FROM node:24-alpine AS builder

RUN apk add --no-cache python3 make g++ git

WORKDIR /app

RUN npm install -g pnpm@10.12.3

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY . .

RUN npx prisma generate && pnpm run build


FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/main"]
