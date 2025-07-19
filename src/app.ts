import Elysia from "elysia";
import { Logestic } from "logestic";
import { SpotifyTokenService } from "./services/spotify-token.service";
import { TokenController } from "./controllers/token.controller";
import { ErrorMiddleware } from "./middleware/error.middleware";

const PORT = parseInt(Bun.env.PORT || '3000', 10);

class App {
    private readonly app: Elysia;
    private readonly service: SpotifyTokenService;
    private readonly controller: TokenController;

    constructor() {
        this.service = new SpotifyTokenService();
        this.controller = new TokenController(this.service);
        this.app = this.init();
    }

    private init(): Elysia {
        return new Elysia()
            .use(Logestic.preset('common'))
            .decorate({
                controller: this.controller
            })
            .get('/api/token', async ({
                query,
                headers,
                set,
                controller
            }: {
                query: { force?: string },
                headers: Record<string, string | undefined>,
                set: { status?: number },
                controller: TokenController
            }) => {
                const cookies = this.parseCookies(headers.cookie);
                return await controller.handle(query, cookies, (status) => {
                    set.status = status;
                });
            })
            .get('/health', () => ({
                status: 'healthy',
                timestamp: Date.now(),
                uptime: process.uptime(),
                version: `Bun v${Bun.version}`,
                message: 'Server running'
            }))
            .onError(({ code, error, set }) => {
                return ErrorMiddleware.handle(code, error, (status) => {
                    set.status = status;
                });
            });
    }

    private parseCookies(header?: string): Record<string, string> | undefined {
        if (!header) return undefined;

        const cookies: Record<string, string> = {};
        header.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            if (name && value) {
                cookies[name] = decodeURIComponent(value);
            }
        });

        return Object.keys(cookies).length > 0 ? cookies : undefined;
    }

    public start(): void {
        this.app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Health: http://localhost:${PORT}/health`);
            console.log(`Token: http://localhost:${PORT}/api/token`);
            console.log('Send sp_dc cookie for authentication');
        });

        this.setupShutdown();
        this.setupErrorHandling();
    }

    private setupShutdown(): void {
        const shutdown = (signal: string) => {
            console.log(`\nReceived ${signal}. Shutting down...`);
            this.service.cleanup();
            console.log('Shutdown completed');
            process.exit(0);
        };

        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
    }

    private setupErrorHandling(): void {
        process.on('uncaughtException', (error) => {
            console.error('[UncaughtException]:', error);
            this.service.cleanup();
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('[UnhandledRejection]:', reason, promise);
            this.service.cleanup();
            process.exit(1);
        });
    }
}

const app = new App();
app.start();