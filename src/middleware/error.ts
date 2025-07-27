import { logs } from '../utils/logger';

export class ErrorMiddleware {
    static handle(code: string, error: unknown, setStatus: (status: number) => void) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logs('error', `Global error handler - ${code}`, errorMessage);

        switch (code) {
            case 'NOT_FOUND':
                setStatus(404);
                return {
                    success: false,
                    error: 'Endpoint not found',
                    timestamp: Date.now()
                };

            case 'VALIDATION':
                setStatus(400);
                return {
                    success: false,
                    error: 'Request validation failed',
                    details: errorMessage,
                    timestamp: Date.now()
                };

            default:
                setStatus(500);
                return {
                    success: false,
                    error: 'Internal server error',
                    timestamp: Date.now()
                };
        }
    }
}