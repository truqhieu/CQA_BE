# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Copy package files and prisma directory first to cache package installation
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (Prisma client is generated in postinstall / prisma generate hook)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build the NestJS application
RUN npm run build

# Remove development dependencies to keep production node_modules lightweight
RUN npm prune --omit=dev

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

# Copy package configurations
COPY package*.json ./

# Copy the generated prisma client, pruned node_modules, and compiled dist files
COPY --from=builder /usr/src/app/prisma ./prisma/
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist

# Expose the port defined in NestJS app
EXPOSE 3000

# Run the compiled NestJS main entrypoint
CMD ["node", "dist/main"]
