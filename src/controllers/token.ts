import type { Spotify } from '../services/spotify';
import type { Cookie } from '../types/types';
import { logs } from '../utils/logger';

export class TokenController {
    constructor(private readonly tokenService: Spotify) { }

    public async handle(
        queryParams: { force?: string; debug?: string },
        cookies: Record<string, string> | undefined,
        setStatus: (status: number) => void
    ) {
        try {
            // Debug endpoint
            if (queryParams.debug === 'true') {
                logs('info', 'Debug status requested');
                return this.tokenService.getStatus();
            }

            // Extract cookies
            const cookieArray = this.extractCookies(cookies);
            const hasSpDc = cookieArray.some(c => c.name === 'sp_dc');

            if (hasSpDc) {
                logs('info', 'Processing request with sp_dc cookie - will fetch authenticated token');
            } else {
                logs('debug', 'Processing anonymous request - will use cached/proactively refreshed token');
            }

            // Get token
            const token = await this.tokenService.getToken(cookieArray);

            if (!token) {
                setStatus(503);
                logs('error', 'Token service returned null - service temporarily unavailable');
                return this.createErrorResponse('Token service temporarily unavailable');
            }

            // Log success
            logs('info', `Returned ${token.isAnonymous ? 'anonymous' : 'authenticated'} token successfully`);
            return token;

        } catch (error) {
            logs('error', 'Token controller error', error);
            setStatus(500);
            return this.createErrorResponse('Internal server error');
        }
    }

    private extractCookies(cookies?: Record<string, string>): Cookie[] {
        if (!cookies) return [];

        return Object.entries(cookies).map(([name, value]) => ({
            name,
            value
        }));
    }

    private createErrorResponse(error: string) {
        return {
            success: false,
            error,
            timestamp: Date.now()
        };
    }
}