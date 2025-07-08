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
                set,
                tokenController
            }: {
                query: { force?: string },
                set: { status?: number },
                tokenController: TokenController
            }) => {
                return await tokenController.handleTokenRequest(query, (status) => {
                    set.status = status;
                });
            })
            .get('/health', () => ({
                status: 'healthy',
                timestamp: Date.now(),
                uptime: process.uptime(),
            }))
            .onError(({ code, error, set }) => {
                return ErrorMiddleware.handleGlobalError(code, error, (status) => {
                    set.status = status;
                });
            });
    }

    public startServer(): void {
        this.app.listen(SERVER_PORT, () => {
            console.log(`Server running on port ${SERVER_PORT}`);
            console.log(`Health check: http://localhost:${SERVER_PORT}/health`);
            console.log(`Token endpoint: http://localhost:${SERVER_PORT}/api/token`);
        });

        this.setupGracefulShutdown();
    }

    private setupGracefulShutdown(): void {
        const gracefulShutdown = () => {
            console.log('\nInitiating graceful shutdown...');
            this.tokenService.cleanup();
            console.log('Service shutdown completed');
            process.exit(0);
        };

        process.on("SIGINT", gracefulShutdown);
        process.on("SIGTERM", gracefulShutdown);
    }
}


const server = new ApplicationServer();
server.startServer();
