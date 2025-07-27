export interface SpotifyToken {
    accessToken: string;
    accessTokenExpirationTimestampMs: number;
    clientId: string;
    isAnonymous: boolean;
}

export interface Cookie {
    name: string;
    value: string;
}