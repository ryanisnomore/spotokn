import { Elysia, t } from 'elysia';
import { cron } from '@elysiajs/cron';
import { swagger } from '@elysiajs/swagger';
import { Logestic } from 'logestic';
import { type Browser, chromium } from 'playwright';

interface SpotifyTokenData {
    accessToken: string;
    accessTokenExpirationTimestampMs: number;
    clientId?: string;
    isAnonymous?: boolean;
}

interface TokenCache {
    token: SpotifyTokenData | null;
    expiresAt: number;
    isRefreshing: boolean;
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

class SpotifyTokenService {
    private cache: TokenCache = {
        token: null,
        expiresAt: 0,
        isRefreshing: false
    };

    private readonly BUFFER_TIME = 5 * 60 * 1000;
    private readonly PROACTIVE_REFRESH_TIME = 10 * 60 * 1000;
    private readonly TIMEOUT_MS = 20000 * 1000; // 20 seconds
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 1000;

    private isTokenValid(): boolean {
        return this.cache.token !== null &&
            this.cache.expiresAt > Date.now() + this.BUFFER_TIME;
    }

    private shouldProactivelyRefresh(): boolean {
        return this.cache.token !== null &&
            this.cache.expiresAt > Date.now() &&
            this.cache.expiresAt <= Date.now() + this.PROACTIVE_REFRESH_TIME;
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async fetchTokenFromSpotify(): Promise<SpotifyTokenData> {
        let browser: Browser | null = null;

        try {
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const browserContext = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1920, height: 1080 }
            });

            const page = await browserContext.newPage();

            const tokenPromise = new Promise<SpotifyTokenData>((resolve, reject) => {
                let resolved = false;

                const timeoutId = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        reject(new Error('Token fetch timeout'));
                    }
                }, this.TIMEOUT_MS);

                page.on('response', async (response) => {
                    if (resolved) return;

                    try {
                        const url = response.url();
                        if (url.includes('/api/token')) {
                            if (!response.ok()) {
                                throw new Error(`Token API returned ${response.status()}`);
                            }

                            const tokenData = await response.json() as SpotifyTokenData;

                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeoutId);
                                resolve(tokenData);
                            }
                        }
                    } catch (error) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeoutId);
                            reject(error);
                        }
                    }
                });
            });
            await page.goto('https://open.spotify.com/', {
                waitUntil: 'networkidle',
                timeout: this.TIMEOUT_MS
            });

            const tokenData = await tokenPromise;
            return tokenData;

        } catch (error) {
            console.error(`[SpotifyTokenService:fetchToken] Failed to fetch Spotify token: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        } finally {
            if (browser) {
                try {
                    await browser.close();
                } catch (closeError) {
                    console.warn(`[SpotifyTokenService:fetchToken] Error closing browser: ${closeError instanceof Error ? closeError.message : 'Unknown error'}`);
                }
            }
        }
    }

    private async fetchWithRetry(): Promise<SpotifyTokenData> {
        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                return await this.fetchTokenFromSpotify();
            } catch (error) {
                if (attempt === this.MAX_RETRIES) {
                    throw error;
                }
                const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
                await this.sleep(delay);
            }
        }

        throw new Error('Max retries exceeded');
    }

    async getToken(forceRefresh: boolean = false): Promise<SpotifyTokenData> {
        if (!forceRefresh && this.isTokenValid()) {
            return this.cache.token!;
        }

        if (this.cache.isRefreshing) {
            const startWait = Date.now();
            const waitTimeout = 30000;

            while (this.cache.isRefreshing && (Date.now() - startWait) < waitTimeout) {
                await this.sleep(100);
            }
            if (this.cache.isRefreshing) {
                throw new Error('Token refresh timeout');
            }

            if (this.isTokenValid()) {
                return this.cache.token!;
            }
        }
        this.cache.isRefreshing = true;

        try {
            const tokenData = await this.fetchWithRetry();
            this.cache.token = tokenData;
            this.cache.expiresAt = tokenData.accessTokenExpirationTimestampMs;
            return tokenData;

        } catch (error) {
            console.error(`[SpotifyTokenService:getToken] Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        } finally {
            this.cache.isRefreshing = false;
        }
    }

    getStatus() {
        return {
            hasToken: this.cache.token !== null,
            isValid: this.isTokenValid(),
            shouldProactivelyRefresh: this.shouldProactivelyRefresh(),
            expiresAt: this.cache.expiresAt,
            isRefreshing: this.cache.isRefreshing,
            timeUntilExpiry: this.cache.expiresAt - Date.now(),
            timeUntilProactiveRefresh: this.cache.expiresAt - Date.now() - this.PROACTIVE_REFRESH_TIME
        };
    }

    async refreshTokenJob(): Promise<void> {
        if (this.shouldProactivelyRefresh() && !this.cache.isRefreshing) {
            try {
                await this.getToken(true);
            } catch (error) {
                console.error(`[SpotifyTokenService:cronRefresh] Scheduled token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }
}

const spotifyService = new SpotifyTokenService();

const app = new Elysia()
    .use(Logestic.preset('fancy'))
    .use(
        swagger({
            documentation: {
                info: {
                    title: 'Spotify Token Service API',
                    version: '1.0.0',
                    description: 'A simple API service for managing Spotify tokens (no authentication required)'
                },
                tags: [
                    { name: 'Token', description: 'Spotify token management' },
                    { name: 'Health', description: 'Health check endpoints' }
                ]
            }
        })
    )
    .use(
        cron({
            name: 'tokenRefresh',
            pattern: '*/5 * * * *', // Every 5 minutes
            timezone: 'UTC',
            run() {
                spotifyService.refreshTokenJob();
            }
        })
    )
    .decorate({
        spotifyService
    })
    .get('/api/token', async ({ query, set, spotifyService }: { query: { force?: string }, set: { status?: number }, spotifyService: SpotifyTokenService }) => {
        const forceRefresh = ['1', 'true', 'yes'].includes(query.force?.toLowerCase() || '');

        try {
            const token = await spotifyService.getToken(forceRefresh);

            return {
                success: true,
                ...token,
                cached: !forceRefresh && spotifyService.getStatus().isValid,
                timestamp: Date.now()
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            set.status = 500;
            return {
                success: false,
                error: errorMessage,
                timestamp: Date.now()
            };
        }
    }, {
        query: t.Object({
            force: t.Optional(t.String({ description: 'Force refresh token (1, true, yes)' }))
        }),
        detail: {
            tags: ['Token'],
            summary: 'Get Spotify access token',
            description: 'Retrieve a valid Spotify access token. Returns cached token if valid, otherwise fetches a new one.'
        }
    })
    .get('/api/token/status', ({ spotifyService }: { spotifyService: SpotifyTokenService }) => {

        return {
            success: true,
            status: spotifyService.getStatus(),
            timestamp: Date.now()
        };
    }, {
        detail: {
            tags: ['Token'],
            summary: 'Get token status',
            description: 'Get current status of the Spotify token cache'
        }
    })
    .post('/api/token/refresh', async ({ set, spotifyService }: { set: { status?: number }, spotifyService: SpotifyTokenService }) => {
        try {
            const token = await spotifyService.getToken(true);

            return {
                success: true,
                ...token,
                cached: false,
                timestamp: Date.now()
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            set.status = 500;
            return {
                success: false,
                error: errorMessage,
                timestamp: Date.now()
            };
        }
    }, {
        detail: {
            tags: ['Token'],
            summary: 'Force refresh token',
            description: 'Manually force a token refresh, bypassing cache'
        }
    })
    // Health endpoint
    .get('/health', () => {
        console.log('[HealthAPI:healthCheck] Health check received');

        return {
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: Date.now(),
        };
    }, {
        detail: {
            tags: ['Health'],
            summary: 'Health check',
            description: 'Check if the service is running properly'
        }
    })
    .onError(({ code, error, set }) => {
        console.error(`[ErrorHandler] Server error occurred - Code: ${code}, Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

        if (code === 'NOT_FOUND') {
            set.status = 404;
            return {
                error: 'Endpoint not found',
                timestamp: Date.now()
            };
        }

        if (code === 'VALIDATION') {
            set.status = 400;
            return {
                error: 'Validation error',
                details: error instanceof Error ? error.message : 'Invalid request',
                timestamp: Date.now()
            };
        }

        set.status = 500;
        return {
            error: 'Internal server error',
            timestamp: Date.now()
        };
    });

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

const shutdown = () => {
    console.log('[Server] Shutting down service gracefully...');
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
