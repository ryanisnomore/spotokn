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
git clone https://github.com/appujet/spotokn.git
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

### 🏗️ Architecture Overview

```mermaid
flowchart TD
    A[Client Request] --> B(Elysia API)
    B -- GET /api/token --> C[TokenController]
    B -- GET /health --> D[Health Check]

    C --> F[SpotifyTokenService]

    subgraph SpotifyTokenService Logic
        F --> G[Token Cache]
        F --> H[MutexLock]
        F --> I[BrowserService]
        F --> J[Auto-Refresh Timer]
        J -- triggers refresh --> F
        H -- ensures single operation --> F
        I -- automates browser --> Spotify[Spotify Web]
        Spotify -- intercepts token --> F
        F -- returns token --> G
    end

    G -- cached/fresh token --> C
    C -- API Response --> B
    B -- HTTP Response --> A

    subgraph Global Error Handling
        B -- errors --> K[ErrorMiddleware]
    end
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

**Need help?** Open an issue on [GitHub](https://github.com/appujet/spotokn/issues) or check the [Wiki](https://github.com/appujet/spotokn/wiki) for detailed guides.
