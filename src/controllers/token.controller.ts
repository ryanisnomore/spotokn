import type { SpotifyTokenService } from '../services/spotify-token.service';
import type { ApiErrorResponse, SpotifyTokenData } from '../types/spotify.types';

export class TokenController {
    constructor(private readonly tokenService: SpotifyTokenService) { }

    async handle(
        queryParams: { force?: string },
        cookies: Record<string, string> | undefined,
        setStatus: (status: number) => void
    ): Promise<SpotifyTokenData | ApiErrorResponse> {
        const force = this.parseForce(queryParams.force);
        const cookieArray = this.extract(cookies);

        const spDcCookie = cookieArray.find(c => c.name === 'sp_dc');
        if (spDcCookie) {
            console.log('sp_dc cookie received for authentication');
        }

        try {
            const tokenData = await this.tokenService.get(
                force,
                cookieArray.length > 0 ? cookieArray : undefined
            );

            if (!tokenData) {
                setStatus(503);
                return {
                    success: false,
                    error: 'Token service temporarily unavailable',
                    timestamp: Date.now()
                };
            }

            return tokenData;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            setStatus(500);
            return {
                success: false,
                error: errorMessage,
                timestamp: Date.now()
            };
        }
    }

    private parseForce(forceParam?: string): boolean {
        if (!forceParam) return false;

        const truthy = ["1", "yes", "true", "on"];
        return truthy.includes(forceParam.toLowerCase());
    }

    private extract(cookies?: Record<string, string>): Array<{ name: string, value: string }> {
        if (!cookies) return [];

        return Object.entries(cookies).map(([name, value]) => ({
            name,
            value
        }));
    }
}