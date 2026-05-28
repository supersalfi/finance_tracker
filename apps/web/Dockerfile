FROM node:22-alpine

WORKDIR /app

COPY package.json ./package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm install

COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

WORKDIR /app/apps/web
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
