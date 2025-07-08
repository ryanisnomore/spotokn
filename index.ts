import { Elysia } from 'elysia';
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
    requestId?: string;
}

class Logger {
    private formatMessage(level: string, context: LogContext, message: string, meta?: any): string {
        const timestamp = new Date().toISOString();
        const contextStr = `[${context.service}${context.operation ? `:${context.operation}` : ''}${context.requestId ? ` req:${context.requestId}` : ''}]`;
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

    private refreshTimer?: NodeJS.Timeout;
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
        this.setupProactiveRefresh();
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

    private setupProactiveRefresh(): void {
        this.refreshTimer = setInterval(() => {
            if (this.shouldProactivelyRefresh() && !this.cache.isRefreshing) {
                this.logger.info(this.getContext('proactiveRefresh'), 'Starting proactive token refresh');
                this.getToken(true).catch(error => {
                    this.logger.error(this.getContext('proactiveRefresh'), 'Proactive refresh failed', { error: error.message });
                });
            }
        }, 60000);
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

                const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff
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

    shutdown(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        this.logger.info(this.getContext('shutdown'), 'Service shutdown complete');
    }
}

const logger = new Logger();

const spotifyService = new SpotifyTokenService(logger);

const generateRequestId = () => Math.random().toString(36).substring(2, 15);

const app = new Elysia()
    .decorate({
        logger,
        spotifyService,
        generateRequestId
    })
    .get('/api/token', async ({ query, set, logger, spotifyService, generateRequestId }) => {
        const requestId = generateRequestId();
        const startTime = Date.now();
        const forceRefresh = ['1', 'true', 'yes'].includes(query.force?.toLowerCase() || '');

        const context: LogContext = {
            service: 'TokenAPI',
            operation: 'getToken',
            requestId
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
                timestamp: Date.now(),
                requestId
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
                timestamp: Date.now(),
                requestId
            };
        }
    })
    .get('/api/token/status', ({ logger, spotifyService, generateRequestId }) => {
        const requestId = generateRequestId();
        const context: LogContext = {
            service: 'TokenAPI',
            operation: 'getStatus',
            requestId
        };

        logger.debug(context, 'Status request received');

        return {
            success: true,
            status: spotifyService.getStatus(),
            timestamp: Date.now(),
            requestId
        };
    })
    .get('/health', ({ logger, generateRequestId }) => {
        const requestId = generateRequestId();
        const context: LogContext = {
            service: 'HealthAPI',
            operation: 'healthCheck',
            requestId
        };

        logger.debug(context, 'Health check received');

        return {
            status: 'healthy',
            uptime: process.uptime(),
            timestamp: Date.now(),
            requestId
        };
    })
    .onError(({ code, error, set, logger, generateRequestId }) => {
        const requestId = generateRequestId();
        const context: LogContext = {
            service: 'ErrorHandler',
            requestId
        };

        logger.error(context, 'Server error occurred', {
            code,
            error: error instanceof Error ? error.message : 'Unknown error'
        });

        if (code === 'NOT_FOUND') {
            set.status = 404;
            return {
                error: 'Endpoint not found',
                requestId,
                timestamp: Date.now()
            };
        }

        set.status = 500;
        return {
            error: 'Internal server error',
            requestId,
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