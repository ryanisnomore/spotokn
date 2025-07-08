export class ErrorMiddleware {
    static handleGlobalError(
        code: string,
        error: unknown,
        setStatus: (status: number) => void
    ) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        console.error(`[GlobalErrorHandler] ${code}: ${errorMessage}`);

        switch (code) {
            case 'NOT_FOUND':
                setStatus(404);
                return {
                    error: 'Endpoint not found',
                    suggestion: 'Check the API documentation for valid endpoints',
                    timestamp: Date.now()
                };

            case 'VALIDATION':
                setStatus(400);
                return {
                    error: 'Request validation failed',
                    details: errorMessage,
                    timestamp: Date.now()
                };

            case 'PARSE':
                setStatus(400);
                return {
                    error: 'Invalid request format',
                    details: 'Please check your request body and headers',
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