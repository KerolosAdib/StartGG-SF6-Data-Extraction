FROM node:20-slim

WORKDIR /app

# Amazon RDS certificate bundle, so pg can verify Aurora's TLS certificate
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /certs/rds-global-bundle.pem
RUN chmod 644 /certs/rds-global-bundle.pem
ENV DB_SSL_CA=/certs/rds-global-bundle.pem

# Install production dependencies first so this layer is cached
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations

ENV NODE_ENV=production

# The scraper writes failed GraphQL queries under logs/; let the node user create it
RUN mkdir -p /app/logs && chown node:node /app/logs
USER node

CMD ["node", "src/index.js"]