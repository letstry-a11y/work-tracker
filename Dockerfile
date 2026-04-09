FROM node:18-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY server/package*.json ./server/
RUN cd server && npm ci --production

# Copy application code
COPY . .

EXPOSE 3000

CMD ["node", "server/app.js"]
