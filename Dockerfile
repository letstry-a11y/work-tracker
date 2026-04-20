FROM node:18-alpine

WORKDIR /app

# Install Java runtime (for MPXJ MPP parsing) + unzip/wget to fetch MPXJ distribution
RUN apk add --no-cache openjdk17-jre-headless wget unzip

# Fetch MPXJ (used for parsing Microsoft Project .mpp files)
ENV MPXJ_VERSION=13.4.0
RUN set -eux; \
    mkdir -p /app/server/vendor/mpxj/lib; \
    wget -qO /tmp/mpxj.zip "https://github.com/joniles/mpxj/releases/download/v${MPXJ_VERSION}/mpxj-${MPXJ_VERSION}.zip"; \
    unzip -q /tmp/mpxj.zip -d /tmp/mpxj-extract; \
    ROOT=$(ls -d /tmp/mpxj-extract/*/ | head -1); \
    mv "${ROOT}lib/"* /app/server/vendor/mpxj/lib/; \
    cp "${ROOT}mpxj.jar" /app/server/vendor/mpxj/lib/mpxj.jar; \
    rm -rf /tmp/mpxj.zip /tmp/mpxj-extract; \
    ls /app/server/vendor/mpxj/lib/mpxj.jar

# Install dependencies first for better layer caching
COPY server/package*.json ./server/
RUN cd server && npm ci --production

# Copy application code
COPY . .

EXPOSE 3000

CMD ["node", "server/app.js"]
