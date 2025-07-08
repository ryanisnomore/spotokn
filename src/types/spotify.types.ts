export interface SpotifyTokenData {
    accessToken: string;
    accessTokenExpirationTimestampMs: number;
    clientId: string;
    isAnonymous: boolean;
}

export interface ApiErrorResponse {
    success: false;
    error: string;
    timestamp: number;
    details?: string;
}

export interface ApiSuccessResponse<T> {
    success: true;
    data: T;
    timestamp: number;
  }