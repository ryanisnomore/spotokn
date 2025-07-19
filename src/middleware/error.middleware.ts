export class ErrorMiddleware {
    static handle(code: string, error: unknown, setStatus: (status: number) => void) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Error] ${code}: ${msg}`);

        switch (code) {
            case 'NOT_FOUND':
                setStatus(404);
                return {
                    error: 'Endpoint not found',
                    suggestion: 'Check API docs',
                    timestamp: Date.now()
                };

            case 'VALIDATION':
                setStatus(400);
                return {
                    error: 'Validation failed',
                    details: msg,
                    timestamp: Date.now()
                };

            case 'PARSE':
                setStatus(400);
                return {
                    error: 'Invalid request format',
                    details: 'Check headers and body',
                    timestamp: Date.now()
                };

            default:
                setStatus(500);
                return {
                    error: 'Internal server error',
                    requestId: Math.random().toString(36).substr(2, 9),
                    timestamp: Date.now()
                };
        }
    }
}