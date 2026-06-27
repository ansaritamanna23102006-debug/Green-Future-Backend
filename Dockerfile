# Use base official Node.js Alpine image for production efficiency
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy dependency configs
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy rest of the application files
COPY . .

# Expose backend port
EXPOSE 5000

# Set environment variable
ENV NODE_ENV=production

# Start command
CMD ["node", "src/server.js"]
