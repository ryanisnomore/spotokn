import { Elysia } from 'elysia';
import { type Browser, chromium, } from 'playwright';

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

class SpotifyTokenService {
    private cache: TokenCache = {
        token: null,
        expiresAt: 0,
        isRefreshing: false
    };

    private readonly BUFFER_TIME = 30000; 
    private readonly TIMEOUT_MS = 20000;

    private log(level: 'info' | 'error' | 'warn', message: string, ...args: any[]) {
        const timestamp = new Date().toISOString();
        console[level](`[${timestamp}] ${message}`, ...args);
    }

    private isTokenValid(): boolean {
        return this.cache.token !== null &&
            this.cache.expiresAt > Date.now() + this.BUFFER_TIME;
    }

    private async fetchTokenFromSpotify(): Promise<SpotifyTokenData> {
        let browser: Browser | null = null;

        try {
            this.log('info', 'Launching browser to fetch Spotify token');

            browser = await chromium.launch();
            console.log('Browser launched');
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            const page = await context.newPage();

            const tokenPromise = new Promise<SpotifyTokenData>((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error('Token fetch timeout'));
                }, this.TIMEOUT_MS);

                page.route('**/api/token', async (route) => {
                    console.log('Intercepted token request');
                    try {
                        const response = await route.fetch();

                        if (!response.ok()) {
                            throw new Error(`Token API returned ${response.status()}`);
                        }

                        const tokenData = await response.json() as SpotifyTokenData;

                        clearTimeout(timeoutId);
                        resolve(tokenData);
                    } catch (error) {
                        clearTimeout(timeoutId);
                        reject(error);
                    }
                });
            });

            await page.goto('https://open.spotify.com/', {
                waitUntil: 'networkidle',
                timeout: this.TIMEOUT_MS
            });

            const tokenData = await tokenPromise;

            this.log('info', 'Successfully fetched Spotify token');
            return tokenData;

        } catch (error) {
            this.log('error', 'Failed to fetch Spotify token:', error);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    async getToken(forceRefresh: boolean = false): Promise<SpotifyTokenData> {
        if (!forceRefresh && this.isTokenValid()) {
            this.log('info', 'Returning cached token');
            return this.cache.token!;
        }

        if (this.cache.isRefreshing) {
            this.log('info', 'Token refresh in progress, waiting...');

            while (this.cache.isRefreshing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            if (this.isTokenValid()) {
                return this.cache.token!;
            }
        }

        this.cache.isRefreshing = true;

        try {
            const tokenData = await this.fetchTokenFromSpotify();

            this.cache.token = tokenData;
            this.cache.expiresAt = tokenData.accessTokenExpirationTimestampMs;

            this.log('info', 'Token cache updated successfully');
            return tokenData;

        } catch (error) {
            this.log('error', 'Token refresh failed:', error);
            throw error;
        } finally {
            this.cache.isRefreshing = false;
        }
    }

    getStatus() {
        return {
            hasToken: this.cache.token !== null,
            isValid: this.isTokenValid(),
            expiresAt: this.cache.expiresAt,
            isRefreshing: this.cache.isRefreshing,
            timeUntilExpiry: this.cache.expiresAt - Date.now()
        };
    }
}


const spotifyService = new SpotifyTokenService();


const app = new Elysia()
    .get('/api/token', async ({ query, set }) => {
        const startTime = Date.now();
        const forceRefresh = ['1', 'true', 'yes'].includes(query.force?.toLowerCase() || '');

        try {
            const token = await spotifyService.getToken(forceRefresh);
            const duration = Date.now() - startTime;

            console.log(`Token request completed in ${duration}ms (force: ${forceRefresh})`);

            return {
                success: true,
                data: token,
                cached: !forceRefresh && spotifyService.getStatus().isValid,
                timestamp: Date.now()
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`Token request failed in ${duration}ms:`, error);

            set.status = 500;
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: Date.now()
            };
        }
    })
    .get('/api/token/status', () => {
        return {
            success: true,
            status: spotifyService.getStatus(),
            timestamp: Date.now()
        };
    })
    .get('/health', () => {
        return {
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: Date.now()
        };
    })
    .onError(({ code, error, set }) => {
        console.error('Server error:', error);

        if (code === 'NOT_FOUND') {
            set.status = 404;
            return { error: 'Endpoint not found' };
        }

        set.status = 500;
        return { error: 'Internal server error' };
    });

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Spotify Token API running on port ${PORT}`);
    console.log(`Endpoints:`);
    console.log(`   GET /api/token - Get Spotify token`);
    console.log(`   GET /api/token?force=true - Force refresh token`);
    console.log(`   GET /api/token/status - Get token status`);
    console.log(`   GET /health - Health check`);
});

export default app;