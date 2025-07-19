import type { SpotifyTokenService } from '../services/spotify-token.service';
import type { ApiErrorResponse, SpotifyTokenData } from '../types/spotify.types';

export class TokenController {
    constructor(private readonly service: SpotifyTokenService) { }

    async handle(
        query: { force?: string },
        cookies: Record<string, string> | undefined,
        setStatus: (status: number) => void
    ): Promise<SpotifyTokenData | ApiErrorResponse> {
        const force = this.parseForce(query.force);
        const cookieArray = this.getCookies(cookies);

        const spDc = cookieArray.find(c => c.name === 'sp_dc');
        if (spDc) {
            console.log('sp_dc cookie received');
        }

        try {
            const token = await this.service.getToken(force, cookieArray.length > 0 ? cookieArray : undefined);

            if (!token) {
                setStatus(503);
                return {
                    success: false,
                    error: 'Token service unavailable',
                    timestamp: Date.now()
                };
            }

            return token;
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            setStatus(500);
            return {
                success: false,
                error: msg,
                timestamp: Date.now()
            };
        }
    }

    private parseForce(param?: string): boolean {
        if (!param) return false;
        const truthy = ["1", "yes", "true", "on"];
        return truthy.includes(param.toLowerCase());
    }

    private getCookies(cookies?: Record<string, string>): Array<{ name: string, value: string }> {
        if (!cookies) return [];
        return Object.entries(cookies).map(([name, value]) => ({ name, value }));
    }
}