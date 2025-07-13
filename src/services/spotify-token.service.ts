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
    private static readonly REQUEST_TIMEOUT = 15000; 
    private static readonly ANONYMOUS_TOKEN_REFRESH_THRESHOLD = 300000;
    private static readonly COOKIE_REQUEST_TIMEOUT = 8000;

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

        // Set page to load faster
        await this.page.setDefaultTimeout(10000);
        await this.page.setDefaultNavigationTimeout(10000);

        await this.setupRequestInterception();

        // Pre-warm the browser with initial load
        await this.page.goto(SpotifyTokenService.SPOTIFY_OPEN_URL, {
            waitUntil: 'domcontentloaded'
        });

        console.log('Browser session initialized with persistent Spotify tab');
    }

    private async setupRequestInterception(): Promise<void> {
        if (!this.page) return;

        // More aggressive blocking for faster performance
        await this.page.route("**/*", (route) => {
            const req = route.request();
            const url = req.url();
            const type = req.resourceType();

            // Block more resource types for speed
            const blockedTypes = [
                "image", "stylesheet", "font", "media", "websocket",
                "other", "manifest", "texttrack", "eventsource"
            ];

            const blockedUrls = [
                "google-analytics", "doubleclick.net", "googletagmanager.com",
                "facebook.com", "twitter.com", "instagram.com", "tiktok.com",
                "googletag", "adsystem", "amazon-adsystem", "google-analytics",
                "googleadservices", "googlesyndication", "youtube.com"
            ];

            const blockedPrefixes = [
                "https://open.spotifycdn.com/cdn/images/",
                "https://encore.scdn.co/fonts/",
                "https://platform-lookaside.fbsbx.com/",
                "https://connect.facebook.net/",
                "https://www.google-analytics.com/",
                "https://www.googletagmanager.com/"
            ];

            // Only allow essential requests
            if (
                blockedTypes.includes(type) ||
                blockedUrls.some((s) => url.includes(s)) ||
                blockedPrefixes.some((prefix) => url.startsWith(prefix))
            ) {
                return route.abort();
            }

            // Only continue requests that are essential
            if (url.includes('open.spotify.com') || url.includes('api/token')) {
                return route.continue();
            }

            // Block everything else
            return route.abort();
        });
    }

    private isTokenExpiringSoon(token: SpotifyTokenData): boolean {
        const currentTime = Date.now();
        const expirationTime = token.accessTokenExpirationTimestampMs;
        const timeUntilExpiry = expirationTime - currentTime;
        const bufferTime = token.isAnonymous
            ? SpotifyTokenService.ANONYMOUS_TOKEN_REFRESH_THRESHOLD
            : SpotifyTokenService.REFRESH_BUFFER_MS;

        return timeUntilExpiry <= bufferTime;
    }

    private scheduleTokenRefresh(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        if (!this.currentAccessToken) return;

        const currentTime = Date.now();
        const expirationTime = this.currentAccessToken.accessTokenExpirationTimestampMs;
        const timeUntilExpiry = expirationTime - currentTime;

        const bufferTime = this.currentAccessToken.isAnonymous
            ? SpotifyTokenService.ANONYMOUS_TOKEN_REFRESH_THRESHOLD
            : SpotifyTokenService.REFRESH_BUFFER_MS;

        const refreshDelay = Math.max(
            timeUntilExpiry - bufferTime,
            SpotifyTokenService.MIN_REFRESH_INTERVAL
        );

        this.refreshTimer = setTimeout(async () => {
            await this.performBackgroundRefresh();
            this.scheduleTokenRefresh();
        }, refreshDelay);

        console.log(`Next token refresh scheduled in ${Math.round(refreshDelay / 1000)}s (${this.currentAccessToken.isAnonymous ? 'anonymous' : 'authenticated'} token)`);
    }

    private async performBackgroundRefresh(): Promise<void> {
        try {
            const releaseCallback = await this.tokenMutex.acquireLock();
            try {
                if (this.currentAccessToken?.isAnonymous) {
                    console.log('Refreshing anonymous token - creating fresh session');
                    await this.refreshBrowserSession();
                }

                const refreshedToken = await this.fetchFreshToken();
                this.currentAccessToken = refreshedToken;
                console.log(`Token refreshed successfully in background (${refreshedToken.isAnonymous ? 'anonymous' : 'authenticated'})`);
            } finally {
                releaseCallback();
            }
        } catch (error) {
            console.error('Background token refresh failed:', error);
            if (this.currentAccessToken?.isAnonymous) {
                console.log('Attempting to recover anonymous token session');
                try {
                    await this.refreshBrowserSession();
                    const recoveredToken = await this.fetchFreshToken();
                    this.currentAccessToken = recoveredToken;
                    console.log('Anonymous token session recovered successfully');
                } catch (recoveryError) {
                    console.error('Failed to recover anonymous token session:', recoveryError);
                }
            }
        }
    }

    private async refreshBrowserSession(): Promise<void> {
        if (!this.browser || !this.page) return;

        try {
            await this.page.context().clearCookies();

            await this.page.goto(SpotifyTokenService.SPOTIFY_OPEN_URL);

            await this.page.waitForLoadState('networkidle');

            console.log('Browser session refreshed for anonymous token');
        } catch (error) {
            console.warn('Failed to refresh browser session:', error);
        }
    }

    private async fetchFreshToken(cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData> {
        const timeout = cookies ? SpotifyTokenService.COOKIE_REQUEST_TIMEOUT : SpotifyTokenService.REQUEST_TIMEOUT;

        return new Promise<SpotifyTokenData>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Token fetch operation timed out'));
            }, timeout);

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

                    if (this.currentAccessToken && this.currentAccessToken.isAnonymous !== sanitizedData.isAnonymous) {
                        console.log(`Token type changed: ${this.currentAccessToken.isAnonymous ? 'anonymous' : 'authenticated'} → ${sanitizedData.isAnonymous ? 'anonymous' : 'authenticated'}`);
                    }

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

            await this.page.reload({ waitUntil: 'domcontentloaded' });
        } else {
            const currentUrl = this.page.url();
            if (!currentUrl.includes('open.spotify.com')) {
                await this.page.goto(SpotifyTokenService.SPOTIFY_OPEN_URL, { waitUntil: 'domcontentloaded' });
            } else {
                await this.page.reload({ waitUntil: 'domcontentloaded' });
            }
        }
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

            if (cookies && cachedToken && !cachedToken.isAnonymous && !forceRefresh) {
                const isValid = !this.isTokenExpiringSoon(cachedToken);
                if (isValid) {
                    console.log('Using cached authenticated token for cookie request');
                    return cachedToken;
                }
            }

            if (!forceRefresh && cachedToken && !cookies) {
                const isValid = !this.isTokenExpiringSoon(cachedToken);
                if (isValid) {
                    return cachedToken;
                }
            }

            const releaseCallback = await this.tokenMutex.acquireLock();
            try {
                const recentToken = this.currentAccessToken;

                if (cookies && recentToken && !recentToken.isAnonymous && !forceRefresh) {
                    const stillValid = !this.isTokenExpiringSoon(recentToken);
                    if (stillValid) {
                        console.log('Using cached authenticated token after lock for cookie request');
                        return recentToken;
                    }
                }

                if (!forceRefresh && recentToken && !cookies) {
                    const stillValid = !this.isTokenExpiringSoon(recentToken);
                    if (stillValid) {
                        return recentToken;
                    }
                }

                if (recentToken?.isAnonymous && !cookies) {
                    console.log('Refreshing anonymous token session');
                    await this.refreshBrowserSession();
                }

                const startTime = Date.now();
                const freshToken = await this.fetchFreshToken(cookies);
                const duration = Date.now() - startTime;

                console.log(`Token fetch completed in ${duration}ms (${cookies ? 'with cookies' : 'anonymous'})`);

                this.currentAccessToken = freshToken;

                this.scheduleTokenRefresh();

                return freshToken;
            } finally {
                releaseCallback();
            }
        } catch (error) {
            console.error('Token retrieval failed:', error);

            if (this.currentAccessToken?.isAnonymous) {
                console.log('Attempting recovery for anonymous token failure');
                try {
                    await this.refreshBrowserSession();
                    const recoveredToken = await this.fetchFreshToken();
                    this.currentAccessToken = recoveredToken;
                    return recoveredToken;
                } catch (recoveryError) {
                    console.error('Recovery attempt failed:', recoveryError);
                }
            }

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