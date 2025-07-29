import { SpotifyBrowser } from './browser';
import type { SpotifyToken, Cookie } from '../types/types';
import { logs } from '../utils/logger';

export class Spotify {
    private browser: SpotifyBrowser;
    private anonymousToken: SpotifyToken | null = null;
    private authenticatedToken: SpotifyToken | null = null;
    private proactiveRefreshTimer: NodeJS.Timeout | null = null;
    private isRefreshing = false;

    private readonly PROACTIVE_REFRESH_BUFFER = 5 * 60 * 1000;
    private readonly CHECK_INTERVAL = 60 * 1000; 

    constructor() {
        this.browser = new SpotifyBrowser();
        this.initializeProactiveRefresh();
        this.getAnonymousToken();
        logs('info', 'Spotify Token Service initialized with proactive refresh enabled');
    }

    /**
     * Get token based on cookie presence
     * - With sp_dc cookie: Returns authenticated token (fetched on-demand)
     * - Without sp_dc cookie: Returns anonymous token (proactively refreshed)
     */
    public async getToken(cookies?: Cookie[]): Promise<SpotifyToken | null> {
        const hasSpDcCookie = this.hasSpDcCookie(cookies);

        if (hasSpDcCookie) {
            return this.getAuthenticatedToken(cookies!);
        } else {
            return this.getAnonymousToken();
        }
    }

    /**
     * Handle authenticated token requests (with sp_dc cookie)
     * Always fetch fresh to ensure latest user permissions
     */
    private async getAuthenticatedToken(cookies: Cookie[]): Promise<SpotifyToken | null> {
        logs('info', 'Fetching fresh authenticated token for sp_dc user');

        try {
            const token = await this.browser.getToken(cookies);

            if (!token.isAnonymous) {
                this.authenticatedToken = token;
                logs('info', 'Successfully obtained authenticated token');
            }

            return token;
        } catch (error) {
            logs('error', 'Authenticated token fetch failed', error instanceof Error ? error.message : error);
            return null;
        }
    }

    /**
     * Handle anonymous token requests (no sp_dc cookie)
     * Use cached token if valid, otherwise fetch new one
     */
    private async getAnonymousToken(): Promise<SpotifyToken | null> {
        if (this.anonymousToken && this.isTokenValid(this.anonymousToken)) {
            logs('debug', 'Returning cached anonymous token');
            return this.anonymousToken;
        }

        if (this.isRefreshing) {
            logs('info', 'Waiting for ongoing refresh to complete');
            await this.waitForRefresh();
            return this.anonymousToken;
        }

        logs('info', 'Fetching fresh anonymous token');
        return this.refreshAnonymousToken();
    }

    /**
     * Refresh anonymous token (used by proactive refresh and on-demand)
     */
    private async refreshAnonymousToken(): Promise<SpotifyToken | null> {
        if (this.isRefreshing) {
            await this.waitForRefresh();
            return this.anonymousToken;
        }

        this.isRefreshing = true;

        try {
            const token = await this.browser.getToken();

            if (token.isAnonymous) {
                this.anonymousToken = token;
                logs('info', 'Anonymous token refreshed successfully');
            } else {
                logs('warn', 'Expected anonymous token but got authenticated token');
            }

            return token;
        } catch (error) {
            logs('error', 'Anonymous token refresh failed', error instanceof Error ? error.message : error);
            return null;
        } finally {
            this.isRefreshing = false;
        }
    }

    /**
     * Initialize proactive refresh system for anonymous tokens only
     */
    private initializeProactiveRefresh(): void {
        const checkAndRefresh = async () => {
            try {
                if (this.anonymousToken && !this.isRefreshing) {
                    const timeUntilExpiry = this.anonymousToken.accessTokenExpirationTimestampMs - Date.now();

                    if (timeUntilExpiry <= this.PROACTIVE_REFRESH_BUFFER) {
                        logs('info', `Anonymous token expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes - proactively refreshing`);
                        await this.refreshAnonymousToken();
                    }
                }
            } catch (error) {
                logs('error', 'Proactive refresh check failed', error);
            }

            this.proactiveRefreshTimer = setTimeout(checkAndRefresh, this.CHECK_INTERVAL);
        };

        this.proactiveRefreshTimer = setTimeout(checkAndRefresh, this.CHECK_INTERVAL);
        logs('info', 'Proactive refresh scheduler started for anonymous tokens');
    }

    /**
     * Utility methods
     */
    private hasSpDcCookie(cookies?: Cookie[]): boolean {
        return cookies?.some(cookie => cookie.name === 'sp_dc') || false;
    }

    private isTokenValid(token: SpotifyToken): boolean {
        const isExpired = token.accessTokenExpirationTimestampMs <= Date.now();
        return !isExpired;
    }

    private async waitForRefresh(): Promise<void> {
        let attempts = 0;
        const maxAttempts = 30;

        while (this.isRefreshing && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
    }

    /**
     * Cleanup resources
     */
    public async cleanup(): Promise<void> {
        if (this.proactiveRefreshTimer) {
            clearTimeout(this.proactiveRefreshTimer);
            this.proactiveRefreshTimer = null;
            logs('info', 'Proactive refresh timer stopped');
        }

        await this.browser.close();
        this.anonymousToken = null;
        this.authenticatedToken = null;
        logs('info', 'Token service cleanup completed');
    }

    /**
     * Get service status for debugging
     */
    public getStatus() {
        return {
            hasAnonymousToken: !!this.anonymousToken,
            hasAuthenticatedToken: !!this.authenticatedToken,
            isRefreshing: this.isRefreshing,
            anonymousTokenExpiry: this.anonymousToken?.accessTokenExpirationTimestampMs,
            authenticatedTokenExpiry: this.authenticatedToken?.accessTokenExpirationTimestampMs,
            anonymousTokenValid: this.anonymousToken ? this.isTokenValid(this.anonymousToken) : false,
            authenticatedTokenValid: this.authenticatedToken ? this.isTokenValid(this.authenticatedToken) : false,
        };
    }
}