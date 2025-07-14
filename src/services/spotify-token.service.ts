import { BrowserService } from './browser.service';
import { MutexLock } from '../utils/mutex.util';
import type { SpotifyTokenData } from '../types/spotify.types';
import type { Request, Response, Browser, Page } from 'playwright';

export class SpotifyTokenService {
    private readonly tokenMutex = new MutexLock();
    private currentAccessToken: SpotifyTokenData | null = null;
    private refreshTimer: NodeJS.Timeout | null = null;

    private browser: Browser | null = null;
    private page: Page | null = null;

    private static readonly SPOTIFY_OPEN_URL = 'https://open.spotify.com/';
    private static readonly TOKEN_ENDPOINT = '/api/token';
    private static readonly REFRESH_BUFFER_MS = 60000;
    private static readonly MIN_REFRESH_INTERVAL = 30000;
    private static readonly REQUEST_TIMEOUT = 30000;

    constructor() {
        this.initializeTokenService();
    }

    private async initializeTokenService(): Promise<void> {
        try {
            await this.initializeBrowserSession();

            const initialToken = await this.fetchFreshToken();
            this.currentAccessToken = initialToken;
            this.scheduleTokenRefresh();
            console.log('Spotify token service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Spotify token service:', error);
        }
    }

    private async initializeBrowserSession(): Promise<void> {
        this.browser = await BrowserService.createBrowserInstance();
        this.page = await BrowserService.createNewPage(this.browser);
        if (!this.page) {
            throw new Error('Failed to create a new browser page');
        }
        await this.page.goto(SpotifyTokenService.SPOTIFY_OPEN_URL);
        console.log('Browser session initialized with persistent Spotify tab');
    }


    private scheduleTokenRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        if (!this.currentAccessToken) return;

        const currentTime = Date.now();
        const expirationTime = this.currentAccessToken.accessTokenExpirationTimestampMs;
        const timeUntilExpiry = expirationTime - currentTime;
        const refreshDelay = Math.max(
            timeUntilExpiry - SpotifyTokenService.REFRESH_BUFFER_MS,
            SpotifyTokenService.MIN_REFRESH_INTERVAL
        );

        this.refreshTimer = setTimeout(async () => {
            await this.performBackgroundRefresh();
            this.scheduleTokenRefresh();
        }, refreshDelay);

        console.log(`Next token refresh scheduled in ${Math.round(refreshDelay / 1000)}s`);
    }

    private async performBackgroundRefresh(): Promise<void> {
        try {
            const releaseCallback = await this.tokenMutex.acquireLock();
            try {
                const refreshedToken = await this.fetchFreshToken();
                this.currentAccessToken = refreshedToken;
                console.log('Token refreshed successfully in background');
            } finally {
                releaseCallback();
            }
        } catch (error) {
            console.error('Background token refresh failed:', error);
        }
    }

    private async fetchFreshToken(cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData> {
        return new Promise<SpotifyTokenData>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Token fetch operation timed out'));
            }, SpotifyTokenService.REQUEST_TIMEOUT);

            this.executeBrowserTokenFetch(cookies)
                .then((tokenData) => {
                    clearTimeout(timeoutId);
                    resolve(tokenData);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    private async executeBrowserTokenFetch(cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData> {
        if (!this.page) {
            throw new Error('Browser session not initialized');
        }

        let tokenRequestProcessed = false;

        return new Promise<SpotifyTokenData>((resolve, reject) => {
            const cleanupAndReject = (error: Error) => {
                this.page?.removeAllListeners('requestfinished');
                reject(error);
            };

            const cleanupAndResolve = (tokenData: SpotifyTokenData) => {
                this.page?.removeAllListeners('requestfinished');
                resolve(tokenData);
            };

            const requestHandler = async (request: Request) => {
                if (!request.url().includes(SpotifyTokenService.TOKEN_ENDPOINT)) return;

                tokenRequestProcessed = true;

                try {
                    const response: Response | null = await request.response();

                    if (!response || !response.ok()) {
                        cleanupAndReject(new Error('Invalid response from Spotify API'));
                        return;
                    }

                    const responseData = await response.json();
                    const sanitizedData = this.sanitizeTokenData(responseData);

                    cleanupAndResolve(sanitizedData);
                } catch (error) {
                    cleanupAndReject(new Error(`Failed to process token response: ${error}`));
                }
            };

            this.page!.on('requestfinished', requestHandler);

            this.setCookiesAndNavigate(cookies).catch((error) => {
                if (!tokenRequestProcessed) {
                    cleanupAndReject(new Error(`Failed to navigate to Spotify: ${error}`));
                }
            });
        });
    }

    private async setCookiesAndNavigate(cookies?: Array<{ name: string, value: string }>): Promise<void> {
        if (!this.page) return;

        if (cookies && cookies.length > 0) {
            const cookieObjects = cookies.map(cookie => ({
                name: cookie.name,
                value: cookie.value,
                domain: '.spotify.com',
                path: '/',
                httpOnly: false,
                secure: true,
                sameSite: 'Lax' as const
            }));

            await this.page.context().addCookies(cookieObjects);
            console.log(`Set ${cookies.length} cookies, including sp_dc if provided`);
        }

        await this.page.goto(SpotifyTokenService.SPOTIFY_OPEN_URL);
    }

    private sanitizeTokenData(rawData: unknown): SpotifyTokenData {
        if (typeof rawData === 'object' && rawData !== null && '_notes' in rawData) {
            delete (rawData as Record<string, unknown>)._notes;
        }
        return rawData as SpotifyTokenData;
    }

    public async retrieveAccessToken(forceRefresh = false, cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData | null> {
        try {
            const cachedToken = this.currentAccessToken;
            const isTokenValid = cachedToken &&
                (cachedToken.accessTokenExpirationTimestampMs - 10000) > Date.now();

            if (!forceRefresh && isTokenValid && !cookies) {
                return cachedToken;
            }

            const releaseCallback = await this.tokenMutex.acquireLock();
            try {
                const recentToken = this.currentAccessToken;
                const stillValidAfterWait = recentToken &&
                    (recentToken.accessTokenExpirationTimestampMs - 10000) > Date.now();

                if (!forceRefresh && stillValidAfterWait && !cookies) {
                    return recentToken;
                }

                const freshToken = await this.fetchFreshToken(cookies);
                this.currentAccessToken = freshToken;
                return freshToken;
            } finally {
                releaseCallback();
            }
        } catch (error) {
            console.error('Token retrieval failed:', error);
            return null;
        }
    }

    public cleanup(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }

        if (this.browser) {
            BrowserService.closeBrowserSafely(this.browser);
            this.browser = null;
            this.page = null;
        }
    }
}