import type { SpotifyTokenService } from '../services/spotify-token.service';
import type { ApiErrorResponse, SpotifyTokenData } from '../types/spotify.types';

export class TokenController {
    constructor(private readonly tokenService: SpotifyTokenService) { }

    async handleTokenRequest(
        queryParams: { force?: string },
        setStatus: (status: number) => void
    ): Promise<SpotifyTokenData | ApiErrorResponse> {
        const shouldForceRefresh = this.parseForceParameter(queryParams.force);

        try {
            const tokenData = await this.tokenService.retrieveAccessToken(shouldForceRefresh);

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

    private parseForceParameter(forceParam?: string): boolean {
        if (!forceParam) return false;

        const truthy = ["1", "yes", "true", "on"];
        return truthy.includes(forceParam.toLowerCase());
    }
}
