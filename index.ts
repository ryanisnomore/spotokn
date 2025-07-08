import { Elysia, t } from 'elysia';
import { cron } from '@elysiajs/cron';
import { swagger } from '@elysiajs/swagger';
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

interface LogContext {
    service: string;
    operation?: string;
}

class Logger {
    private formatMessage(level: string, context: LogContext, message: string, meta?: any): string {
        const timestamp = new Date().toISOString();
        const contextStr = `[${context.service}${context.operation ? `:${context.operation}` : ''}]`;
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level.toUpperCase()} ${contextStr} ${message}${metaStr}`;
    }

    info(context: LogContext, message: string, meta?: any) {
        console.log(this.formatMessage('info', context, message, meta));
    }

    error(context: LogContext, message: string, meta?: any) {
        console.error(this.formatMessage('error', context, message, meta));
    }

    warn(context: LogContext, message: string, meta?: any) {
        console.warn(this.formatMessage('warn', context, message, meta));
    }

    debug(context: LogContext, message: string, meta?: any) {
        console.debug(this.formatMessage('debug', context, message, meta));
    }
}

class SpotifyTokenService {
    private cache: TokenCache = {
        token: null,
        expiresAt: 0,
        isRefreshing: false
    };

    private readonly BUFFER_TIME = 5 * 60 * 1000;
    private readonly PROACTIVE_REFRESH_TIME = 10 * 60 * 1000;
    private readonly TIMEOUT_MS = 20000;
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 1000;

    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    private getContext(operation?: string): LogContext {
        return {
            service: 'SpotifyTokenService',
            operation
        };
    }

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
        const context = this.getContext('fetchToken');

        try {
            this.logger.info(context, 'Starting browser launch');

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
                            this.logger.debug(context, 'Intercepted token response', { url, status: response.status() });

                            if (!response.ok()) {
                                throw new Error(`Token API returned ${response.status()}`);
                            }

                            const tokenData = await response.json() as SpotifyTokenData;

                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeoutId);

                                this.logger.info(context, 'Token successfully retrieved', {
                                    expiresAt: new Date(tokenData.accessTokenExpirationTimestampMs).toISOString(),
                                    isAnonymous: tokenData.isAnonymous,
                                    hasClientId: !!tokenData.clientId
                                });

                                resolve(tokenData);
                            }
                        }
                    } catch (error) {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timeoutId);
                            this.logger.error(context, 'Error processing token response', { error: error instanceof Error ? error.message : 'Unknown error' });
                            reject(error);
                        }
                    }
                });
            });

            this.logger.debug(context, 'Navigating to Spotify');
            await page.goto('https://open.spotify.com/', {
                waitUntil: 'networkidle',
                timeout: this.TIMEOUT_MS
            });

            const tokenData = await tokenPromise;
            return tokenData;

        } catch (error) {
            this.logger.error(context, 'Failed to fetch Spotify token', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        } finally {
            if (browser) {
                try {
                    await browser.close();
                    this.logger.debug(context, 'Browser closed successfully');
                } catch (closeError) {
                    this.logger.warn(context, 'Error closing browser', {
                        error: closeError instanceof Error ? closeError.message : 'Unknown error'
                    });
                }
            }
        }
    }

    private async fetchWithRetry(): Promise<SpotifyTokenData> {
        const context = this.getContext('fetchWithRetry');

        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                this.logger.info(context, `Attempt ${attempt}/${this.MAX_RETRIES} to fetch token`);
                return await this.fetchTokenFromSpotify();
            } catch (error) {
                this.logger.warn(context, `Attempt ${attempt} failed`, {
                    error: error instanceof Error ? error.message : 'Unknown error'
                });

                if (attempt === this.MAX_RETRIES) {
                    throw error;
                }

                const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
                this.logger.info(context, `Retrying in ${delay}ms`);
                await this.sleep(delay);
            }
        }

        throw new Error('Max retries exceeded');
    }

    async getToken(forceRefresh: boolean = false): Promise<SpotifyTokenData> {
        const context = this.getContext('getToken');

        if (!forceRefresh && this.isTokenValid()) {
            this.logger.debug(context, 'Returning cached token', {
                expiresAt: new Date(this.cache.expiresAt).toISOString(),
                timeUntilExpiry: this.cache.expiresAt - Date.now()
            });
            return this.cache.token!;
        }

        if (this.cache.isRefreshing) {
            this.logger.info(context, 'Token refresh in progress, waiting...');

            const startWait = Date.now();
            const waitTimeout = 30000;

            while (this.cache.isRefreshing && (Date.now() - startWait) < waitTimeout) {
                await this.sleep(100);
            }

            if (this.cache.isRefreshing) {
                this.logger.error(context, 'Timeout waiting for token refresh');
                throw new Error('Token refresh timeout');
            }

            if (this.isTokenValid()) {
                this.logger.info(context, 'Returning token from concurrent refresh');
                return this.cache.token!;
            }
        }

        this.cache.isRefreshing = true;
        this.logger.info(context, 'Starting token refresh', { forceRefresh });

        try {
            const tokenData = await this.fetchWithRetry();

            this.cache.token = tokenData;
            this.cache.expiresAt = tokenData.accessTokenExpirationTimestampMs;

            this.logger.info(context, 'Token cache updated successfully', {
                expiresAt: new Date(this.cache.expiresAt).toISOString(),
                timeUntilExpiry: this.cache.expiresAt - Date.now()
            });

            return tokenData;

        } catch (error) {
            this.logger.error(context, 'Token refresh failed', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
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
        const context = this.getContext('cronRefresh');

        if (this.shouldProactivelyRefresh() && !this.cache.isRefreshing) {
            this.logger.info(context, 'Starting scheduled token refresh');
            try {
                await this.getToken(true);
                this.logger.info(context, 'Scheduled token refresh completed successfully');
            } catch (error) {
                this.logger.error(context, 'Scheduled token refresh failed', {
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
    }

    shutdown(): void {
        this.logger.info(this.getContext('shutdown'), 'Service shutdown complete');
    }
}

const logger = new Logger();
const spotifyService = new SpotifyTokenService(logger);

const app = new Elysia()
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
        logger,
        spotifyService
    })
    // Token endpoints (no authentication required)
    .get('/api/token', async ({ query, set, logger, spotifyService }) => {
        const startTime = Date.now();
        const forceRefresh = ['1', 'true', 'yes'].includes(query.force?.toLowerCase() || '');

        const context: LogContext = {
            service: 'TokenAPI',
            operation: 'getToken'
        };

        logger.info(context, 'Token request received', { forceRefresh });

        try {
            const token = await spotifyService.getToken(forceRefresh);
            const duration = Date.now() - startTime;

            logger.info(context, 'Token request successful', {
                duration,
                forceRefresh,
                cached: !forceRefresh && spotifyService.getStatus().isValid
            });

            return {
                success: true,
                ...token,
                cached: !forceRefresh && spotifyService.getStatus().isValid,
                timestamp: Date.now()
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            logger.error(context, 'Token request failed', {
                duration,
                error: errorMessage
            });

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
    .get('/api/token/status', ({ logger, spotifyService }) => {
        const context: LogContext = {
            service: 'TokenAPI',
            operation: 'getStatus'
        };

        logger.debug(context, 'Status request received');

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
    .post('/api/token/refresh', async ({ set, logger, spotifyService }) => {
        const startTime = Date.now();

        const context: LogContext = {
            service: 'TokenAPI',
            operation: 'manualRefresh'
        };

        logger.info(context, 'Manual token refresh requested');

        try {
            const token = await spotifyService.getToken(true);
            const duration = Date.now() - startTime;

            logger.info(context, 'Manual token refresh successful', { duration });

            return {
                success: true,
                ...token,
                cached: false,
                timestamp: Date.now()
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            logger.error(context, 'Manual token refresh failed', {
                duration,
                error: errorMessage
            });

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
    .get('/health', ({ logger }) => {
        
        const context: LogContext = {
            service: 'HealthAPI',
            operation: 'healthCheck',
        };

        logger.debug(context, 'Health check received');

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
    .onError(({ code, error, set, logger }) => {
        const context: LogContext = {
            service: 'ErrorHandler',
        };

        logger.error(context, 'Server error occurred', {
            code,
            error: error instanceof Error ? error.message : 'Unknown error'
        });

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

export default app;

const shutdown = () => {
    logger.info({ service: 'Server' }, 'Shutting down service gracefully...');
    spotifyService.shutdown();
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);