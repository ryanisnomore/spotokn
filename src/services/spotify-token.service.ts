import { BrowserService } from './browser.service';
import { MutexLock } from '../utils/mutex.util';
import type { SpotifyTokenData } from '../types/spotify.types';
import type { Request, Response, Browser, Page } from 'playwright';

export class SpotifyTokenService {
    private readonly tokenMutex = new MutexLock();
    private currentAccessToken: SpotifyTokenData | null = null;
    private refreshTimer: NodeJS.Timeout | null = null;

    private static readonly SPOTIFY_OPEN_URL = 'https://open.spotify.com/';
    private static readonly TOKEN_ENDPOINT = '/api/token';
    private static readonly REQUEST_TIMEOUT = 30000;
    private static readonly CONTINUOUS_REFRESH_INTERVAL = 300000;

    constructor() {
        this.init();
    }

    private async init(): Promise<void> {
        try {
            const initialToken = await this.fetch();
            this.currentAccessToken = initialToken;
            this.start();
            console.log('Spotify token service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Spotify token service:', error);
        }
    }

    private start(): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }

        // Always refresh every 5 minutes regardless of token expiration
        this.refreshTimer = setTimeout(async () => {
            await this.refresh();
            this.start(); // Schedule next refresh
        }, SpotifyTokenService.CONTINUOUS_REFRESH_INTERVAL);

        console.log(`Continuous token refresh scheduled every ${SpotifyTokenService.CONTINUOUS_REFRESH_INTERVAL / 1000}s`);
    }

    private async refresh(): Promise<void> {
        try {
            const releaseCallback = await this.tokenMutex.lock();
            try {
                const refreshedToken = await this.fetch();
                this.currentAccessToken = refreshedToken;
                console.log('Token refreshed successfully in background');
            } finally {
                releaseCallback();
            }
        } catch (error) {
            console.error('Background token refresh failed:', error);
        }
    }

    private async fetch(cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData> {
        return new Promise<SpotifyTokenData>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Token fetch operation timed out'));
            }, SpotifyTokenService.REQUEST_TIMEOUT);

            this.exec(cookies)
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

    private async exec(cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData> {
        let browser: Browser | null = null;
        let page: Page | null = null;

        try {
            console.log('Opening new browser session for token fetch...');
            browser = await BrowserService.create();
            page = await BrowserService.page(browser);

            let tokenRequestProcessed = false;

            return new Promise<SpotifyTokenData>((resolve, reject) => {
                const fail = async (error: Error) => {
                    page?.removeAllListeners('requestfinished');
                    await this.closeBrowser(browser);
                    reject(error);
                };

                const done = async (tokenData: SpotifyTokenData) => {
                    page?.removeAllListeners('requestfinished');
                    await this.closeBrowser(browser);
                    resolve(tokenData);
                };

                const handle = async (request: Request) => {
                    if (!request.url().includes(SpotifyTokenService.TOKEN_ENDPOINT)) return;

                    tokenRequestProcessed = true;

                    try {
                        const response: Response | null = await request.response();

                        if (!response || !response.ok()) {
                            await fail(new Error('Invalid response from Spotify API'));
                            return;
                        }

                        const responseData = await response.json();
                        const sanitizedData = this.clean(responseData);

                        console.log('Token successfully retrieved, closing browser session...');
                        await done(sanitizedData);
                    } catch (error) {
                        await fail(new Error(`Failed to process token response: ${error}`));
                    }
                };

                page!.on('requestfinished', handle);

                this.nav(page!, cookies).catch(async (error) => {
                    if (!tokenRequestProcessed) {
                        await fail(new Error(`Failed to navigate to Spotify: ${error}`));
                    }
                });
            });
        } catch (error) {
            await this.closeBrowser(browser);
            throw new Error(`Failed to initialize browser session: ${error}`);
        }
    }

    private async nav(page: Page, cookies?: Array<{ name: string, value: string }>): Promise<void> {
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

            await page.context().addCookies(cookieObjects);
            console.log(`Set ${cookies.length} cookies, including sp_dc if provided`);
        }

        await page.goto(SpotifyTokenService.SPOTIFY_OPEN_URL);
    }

    private async closeBrowser(browser: Browser | null): Promise<void> {
        if (browser) {
            try {
                await BrowserService.close(browser);
                console.log('Browser session closed successfully');
            } catch (error) {
                console.warn('Failed to close browser session:', error);
            }
        }
    }

    private clean(rawData: unknown): SpotifyTokenData {
        if (typeof rawData === 'object' && rawData !== null && '_notes' in rawData) {
            delete (rawData as Record<string, unknown>)._notes;
        }
        return rawData as SpotifyTokenData;
    }

    private shouldRefresh(
        cachedToken: SpotifyTokenData | null,
        hasSpDcCookie: boolean
    ): boolean {
        if (!cachedToken) return true;

        if (hasSpDcCookie) {
            console.log('sp_dc cookie provided, forcing fresh token fetch');
            return true;
        }

        if (!cachedToken.isAnonymous) {
            console.log('No sp_dc cookie but current token is authenticated, forcing anonymous token refresh');
            return true;
        }

        const isExpired = (cachedToken.accessTokenExpirationTimestampMs - 10000) <= Date.now();
        if (isExpired) {
            console.log('Token is expired, forcing refresh');
            return true;
        }

        return false;
    }

    public async get(
        forceRefresh = false,
        cookies?: Array<{ name: string, value: string }>
    ): Promise<SpotifyTokenData | null> {
        try {
            const hasSpDcCookie = cookies?.some(cookie => cookie.name === 'sp_dc') || false;
            const cachedToken = this.currentAccessToken;

            const shouldRefresh = forceRefresh || this.shouldRefresh(cachedToken, hasSpDcCookie);

            if (!shouldRefresh && cachedToken) {
                console.log(`Returning cached ${cachedToken.isAnonymous ? 'anonymous' : 'authenticated'} token`);
                return cachedToken;
            }

            const releaseCallback = await this.tokenMutex.lock();
            try {
                const recentToken = this.currentAccessToken;
                const stillShouldRefresh = forceRefresh || this.shouldRefresh(recentToken, hasSpDcCookie);

                if (!stillShouldRefresh && recentToken) {
                    console.log(`Returning recent cached ${recentToken.isAnonymous ? 'anonymous' : 'authenticated'} token`);
                    return recentToken;
                }

                console.log(`Fetching fresh ${hasSpDcCookie ? 'authenticated' : 'anonymous'} token`);
                const freshToken = await this.fetch(cookies);
                this.currentAccessToken = freshToken;

                console.log(`Successfully retrieved ${freshToken.isAnonymous ? 'anonymous' : 'authenticated'} token`);
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

        console.log('Token service cleanup completed');
    }
}