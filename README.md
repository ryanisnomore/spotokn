# spotify-tokener

`spotify-tokener` is a utility designed to generate Spotify access tokens, primarily for use with the `lavasrc` plugin.

## Features

- Generates Spotify access tokens.
- Designed for seamless integration with the `lavasrc` plugin.

## Installation

To get started with `spotify-tokener`, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/appujet/spotify-tokener.git
    cd spotify-tokener
    ```

2.  **Install dependencies:**
    This project uses [Bun](https://bun.sh) as its JavaScript runtime and package manager. If you don't have Bun installed, you can find installation instructions on their official website.

    ```bash
    bun install
    ```

3.  **Download Playwright binaries:**
    `spotify-tokener` utilizes Playwright for browser automation. Download the necessary binaries for your platform:

    ```bash
    npx playwright install
    ```

## Usage

To run the `spotify-tokener` and generate a token:

```bash
bun run start
```
## API Documentation
This will start the server on port 3000. You can access the API documentation at `http://localhost:3000/swagger`.

## API Endpoints

The `spotify-tokener` exposes the following API endpoints:

### `GET /api/token`

This endpoint retrieves a Spotify access token. It can optionally force a refresh of the token.

**Query Parameters:**

*   `force` (optional): Set to `1`, `true`, or `yes` to force a refresh of the token, bypassing the cache.

**Successful Response (Status: 200 OK):**

```json
{
  "success": true,
  "accessToken": "...",
  "accessTokenExpirationTimestampMs": 1678886400000,
  "clientId": "...",
  "isAnonymous": false,
  "cached": false,
  "timestamp": 1678886300000,
}
```

**Error Response (Status: 500 Internal Server Error):**

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": 1678886300000,
}
```

### `GET /api/token/status`

This endpoint provides the current status of the Spotify token service, including cache information and refresh status.

**Successful Response (Status: 200 OK):**

```json
{
  "success": true,
  "status": {
    "hasToken": true,
    "isValid": true,
    "shouldProactivelyRefresh": false,
    "expiresAt": 1678886400000,
    "isRefreshing": false,
    "timeUntilExpiry": 100000,
    "timeUntilProactiveRefresh": 40000
  },
  "timestamp": 1678886300000,
}
```

### `GET /health`

This endpoint is a simple health check to determine if the service is running.

**Successful Response (Status: 200 OK):**

```json
{
  "status": "healthy",
  "uptime": 3600,
  "timestamp": 1678886300000,
}
```

### Error Handling

The application includes a global error handler for unhandled routes and internal server errors.

**Not Found Response (Status: 404 Not Found):**

```json
{
  "error": "Endpoint not found",
  "timestamp": 1678886300000
}
```

**Internal Server Error Response (Status: 500 Internal Server Error):**

```json
{
  "error": "Internal server error",
  "timestamp": 1678886300000
}
```
