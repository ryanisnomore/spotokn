import { BrowserService } from './browser.service';
import { MutexLock } from '../utils/mutex.util';
import type { SpotifyTokenData } from '../types/spotify.types';
import type { Request, Response, Browser, Page } from 'playwright';

export class SpotifyTokenService {
    private readonly mutex = new MutexLock();
    private token: SpotifyTokenData | null = null;
    private timer: NodeJS.Timeout | null = null;
    private isShuttingDown = false;

    private static readonly URL = 'https://open.spotify.com/';
    private static readonly ENDPOINT = '/api/token';
    private static readonly TIMEOUT = 45000;
    private static readonly REFRESH_INTERVAL = 300000;
    private static readonly MAX_RETRIES = 3;

    constructor() {
        this.init();
    }

    private async init(): Promise<void> {
        if (this.isShuttingDown) return;

        try {
            console.log('Initializing token service...');
            const token = await this.fetchWithRetry();
            this.token = token;
            this.startRefresh();
            console.log('Token service initialized');
        } catch (error) {
            console.error('Token service init failed:', error);
            setTimeout(() => this.init(), 30000);
        }
    }

    private startRefresh(): void {
        if (this.isShuttingDown) return;

        if (this.timer) {
            clearTimeout(this.timer);
        }

        this.timer = setTimeout(async () => {
            await this.bgRefresh();
            this.startRefresh();
        }, SpotifyTokenService.REFRESH_INTERVAL);

        console.log('Token refresh scheduled');
    }

    private async bgRefresh(): Promise<void> {
        if (this.isShuttingDown) return;

        try {
            const release = await this.mutex.acquireLock();
            try {
                const token = await this.fetchWithRetry();
                this.token = token;
                console.log('Token refreshed in background');
            } finally {
                release();
            }
        } catch (error) {
            console.error('Background refresh failed:', error);
        }
    }

    private async fetchWithRetry(cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= SpotifyTokenService.MAX_RETRIES; attempt++) {
            if (this.isShuttingDown) {
                throw new Error('Service shutting down');
            }

            try {
                console.log(`Token fetch attempt ${attempt}/${SpotifyTokenService.MAX_RETRIES}`);
                return await this.fetchToken(cookies);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                console.warn(`Attempt ${attempt} failed:`, lastError.message);

                if (attempt < SpotifyTokenService.MAX_RETRIES) {
                    const delay = attempt * 2000; // Progressive delay
                    console.log(`Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError || new Error('All fetch attempts failed');
    }

    private async fetchToken(cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData> {
        return new Promise<SpotifyTokenData>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Token fetch timeout'));
            }, SpotifyTokenService.TIMEOUT);

            this.browserFetch(cookies)
                .then((data) => {
                    clearTimeout(timeoutId);
                    resolve(data);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    private async browserFetch(cookies?: Array<{ name: string, value: string }>): Promise<SpotifyTokenData> {
        let browser: Browser | null = null;
        let page: Page | null = null;

        try {
            console.log('Opening browser...');
            browser = await BrowserService.create();
            page = await BrowserService.newPage(browser);

            let processed = false;

            return new Promise<SpotifyTokenData>((resolve, reject) => {
                const cleanup = async (error?: Error) => {
                    if (processed) return;
                    processed = true;

                    page?.removeAllListeners('requestfinished');
                    await this.closeBrowser(browser);

                    if (error) {
                        reject(error);
                    }
                };

                const success = async (data: SpotifyTokenData) => {
                    if (processed) return;
                    processed = true;

                    page?.removeAllListeners('requestfinished');
                    await this.closeBrowser(browser);
                    resolve(data);
                };

                const onRequest = async (request: Request) => {
                    if (!request.url().includes(SpotifyTokenService.ENDPOINT)) return;
                    if (processed) return;

                    try {
                        const response: Response | null = await request.response();

                        if (!response || !response.ok()) {
                            await cleanup(new Error('Invalid API response'));
                            return;
                        }

                        const data = await response.json();
                        const clean = this.cleanData(data);

                        console.log('Token retrieved successfully');
                        await success(clean);
                    } catch (error) {
                        await cleanup(new Error(`Response processing failed: ${error}`));
                    }
                };

                page!.on('requestfinished', onRequest);

                // Set timeout for the entire operation
                setTimeout(async () => {
                    await cleanup(new Error('Browser operation timeout'));
                }, SpotifyTokenService.TIMEOUT - 5000);

                this.setCookiesAndGo(page!, cookies).catch(async (error) => {
                    await cleanup(new Error(`Navigation failed: ${error}`));
                });
            });
        } catch (error) {
            await this.closeBrowser(browser);
            throw new Error(`Browser session failed: ${error}`);
        }
    }

    private async setCookiesAndGo(page: Page, cookies?: Array<{ name: string, value: string }>): Promise<void> {
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
            console.log(`Set ${cookies.length} cookies`);
        }

        await page.goto(SpotifyTokenService.URL, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
    }

    private async closeBrowser(browser: Browser | null): Promise<void> {
        if (browser) {
            try {
                await BrowserService.close(browser);
                console.log('Browser closed');
            } catch (error) {
                console.warn('Browser close failed:', error);
            }
        }
    }

    private cleanData(raw: unknown): SpotifyTokenData {
        if (typeof raw === 'object' && raw !== null && '_notes' in raw) {
            delete (raw as Record<string, unknown>)._notes;
        }
        return raw as SpotifyTokenData;
    }

    private shouldRefresh(cached: SpotifyTokenData | null, hasSpDc: boolean): boolean {
        if (!cached) return true;

        if (hasSpDc) {
            console.log('sp_dc cookie provided, forcing fresh token');
            return true;
        }

        if (!cached.isAnonymous) {
            console.log('Switching to anonymous token');
            return true;
        }

        const expired = (cached.accessTokenExpirationTimestampMs - 10000) <= Date.now();
        if (expired) {
            console.log('Token expired, refreshing');
            return true;
        }

        return false;
    }

    public async getToken(
        force = false,
        cookies?: Array<{ name: string, value: string }>
    ): Promise<SpotifyTokenData | null> {
        if (this.isShuttingDown) {
            return null;
        }

        try {
            const hasSpDc = cookies?.some(c => c.name === 'sp_dc') || false;
            const cached = this.token;

            const needRefresh = force || this.shouldRefresh(cached, hasSpDc);

            if (!needRefresh && cached) {
                console.log(`Returning cached ${cached.isAnonymous ? 'anonymous' : 'authenticated'} token`);
                return cached;
            }

            const release = await this.mutex.acquireLock();
            try {
                const recent = this.token;
                const stillNeed = force || this.shouldRefresh(recent, hasSpDc);

                if (!stillNeed && recent) {
                    console.log(`Returning recent ${recent.isAnonymous ? 'anonymous' : 'authenticated'} token`);
                    return recent;
                }

                console.log(`Fetching fresh ${hasSpDc ? 'authenticated' : 'anonymous'} token`);
                const fresh = await this.fetchWithRetry(cookies);
                this.token = fresh;

                console.log(`Retrieved ${fresh.isAnonymous ? 'anonymous' : 'authenticated'} token`);
                return fresh;
            } finally {
                release();
            }
        } catch (error) {
            console.error('Token retrieval failed:', error);
            return null;
        }
    }

    public cleanup(): void {
        console.log('Cleaning up token service...');
        this.isShuttingDown = true;

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        console.log('Token service cleanup completed');
    }
}