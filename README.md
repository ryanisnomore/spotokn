Here's a compact version of your Spotify Tokener documentation:

# Spotify Tokener

Fast Spotify access token generator for LavaSrc with caching.

## Features
- 🚀 Fast Playwright-based token generation
- ⚡ High-performance Elysia API
- 🔄 Auto-refresh
- 🛡️ Error resilience with retries

## Quick Start
```bash
git clone https://github.com/ryanisnomore/spotokn.git
cd spotokn
bun install
npx playwright install
npx playwright install-deps
bun run start
```

## API Endpoints
- `GET /api/token` - Get token (`?force=1` to refresh)
- `GET /health` - Service health

## LavaSrc Config
```yaml
spotify:
  preferAnonymousToken: true
  customAnonymousTokenEndpoint: "http://yourserver/api/token"
```

## Response Format
```json
{
  "success": true,
  "accessToken": "BQC7...",
  "accessTokenExpirationTimestampMs": 1678886400000,
  "clientId": "3a0ed...",
  "isAnonymous": false,
  "cached": false,
  "timestamp": 1678886300000
}
```

## 🐳 Docker

You can containerize the Spotify Tokener application using Docker.

### Build the Docker Image
Navigate to the root directory of the project and run:
```bash
docker build -t spotify-tokener .
```
This command builds a Docker image named `spotify-tokener`.

### Run the Docker Container
To run the container and map port 3000 from the container to your host, while also providing environment variables from your local `.env` file:
```bash
docker run -p 3000:3000 --env-file .env spotify-tokener
```
Ensure you have a `.env` file in your project root with necessary environment variables (e.g., `PORT`).

## 🛠️ Development

### Prerequisites
- **Bun** - JavaScript runtime ([install](https://bun.sh))
- **Playwright** - Browser automation

### Environment Setup
```bash
# Development mode
bun run dev

# Production build
bun run start
```

## 🔍 Troubleshooting

**Common Issues:**
- **Playwright install fails:** Run `npx playwright install chromium --force`
- **Token generation slow:** Check browser automation setup
- **Cache not working:** Verify memory limits and concurrency settings

**Performance Tips:**
- Use `force=1` sparingly to avoid rate limits
- Monitor `/api/token/status` for proactive refresh timing
- Scale horizontally for high-traffic scenarios

---

**Need help?** Open an issue on [GitHub](https://github.com/ryanisnomore/spotokn/issues) or check the [Wiki](https://github.com/ryanisnomore/spotokn/wiki) for detailed guides.
