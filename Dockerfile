# Use an official Bun runtime as a parent image
FROM oven/bun:latest

# Set the working directory in the container
WORKDIR /app

# Copy package.json first for better caching
COPY package.json ./

# Install dependencies (remove --frozen-lockfile if you don't have bun.lockb)
RUN bun install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["bun", "run", "src/app.ts"]
