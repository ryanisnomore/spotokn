import Elysia from "elysia";
import { Logestic } from "logestic";
import { SpotifyTokenService } from "./services/spotify-token.service";
import { TokenController } from "./controllers/token.controller";
import { ErrorMiddleware } from "./middleware/error.middleware";

const SERVER_PORT = parseInt(Bun.env.PORT || '3000', 10);

class ApplicationServer {
    private readonly app: Elysia;
    private readonly tokenService: SpotifyTokenService;
    private readonly tokenController: TokenController;

    constructor() {
        this.tokenService = new SpotifyTokenService();
        this.tokenController = new TokenController(this.tokenService);
        this.app = this.initializeApplication();
    }

    private initializeApplication(): Elysia {
        return new Elysia()
            .use(Logestic.preset('common'))
            .decorate({
                tokenController: this.tokenController
            })
            .get('/api/token', async ({
                query,
                headers,
                set,
                tokenController
            }: {
                query: { force?: string },
                headers: Record<string, string | undefined>,
                set: { status?: number },
                tokenController: TokenController
            }) => {
                const cookies = this.parseCookies(headers.cookie);

                return await tokenController.handleTokenRequest(
                    query,
                    cookies,
                    (status) => {
                        set.status = status;
                    }
                );
            })
            .get('/health', () => ({
                status: 'healthy',
                timestamp: Date.now(),
                uptime: process.uptime(),
                version: `Bun v${Bun.version}`,
                message: 'Server is running smoothly'
            }))
            .onError(({ code, error, set }) => {
                return ErrorMiddleware.handleGlobalError(code, error, (status) => {
                    set.status = status;
                });
            });
    }

    private parseCookies(cookieHeader?: string): Record<string, string> | undefined {
        if (!cookieHeader) return undefined;

        const cookies: Record<string, string> = {};

        cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            if (name && value) {
                cookies[name] = decodeURIComponent(value);
            }
        });

        return Object.keys(cookies).length > 0 ? cookies : undefined;
    }

    public startServer(): void {
        this.app.listen(SERVER_PORT, () => {
            console.log(`Server running on port ${SERVER_PORT}`);
            console.log(`Health check: http://localhost:${SERVER_PORT}/health`);
            console.log(`Token endpoint: http://localhost:${SERVER_PORT}/api/token`);
            console.log(`Send cookies (especially sp_dc) in requests for authentication`);
        });

        this.setupGracefulShutdown();
        this.setupGlobalErrorHandling();
    }

    private setupGracefulShutdown(): void {
        const gracefulShutdown = (signal: string) => {
            console.log(`\nReceived ${signal}. Initiating graceful shutdown...`);
            this.tokenService.cleanup();
            console.log('Service shutdown completed');
            process.exit(0);
        };

        process.on("SIGINT", () => gracefulShutdown("SIGINT"));
        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    }

    private setupGlobalErrorHandling(): void {
        process.on('uncaughtException', (error) => {
            console.error('[UncaughtException] Application crashed due to unhandled exception:', error);
            this.tokenService.cleanup();
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('[UnhandledRejection] Application crashed due to unhandled promise rejection:', reason, promise);
            this.tokenService.cleanup();
            process.exit(1);
        });
    }
}

const server = new ApplicationServer();
server.startServer();
