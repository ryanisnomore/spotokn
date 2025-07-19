export class MutexLock {
    private isLocked = false;
    private pendingResolvers: Array<(releaseCallback: () => void) => void> = [];

    async lock(): Promise<() => void> {
        if (this.isLocked) {
            return new Promise((resolve) => {
                this.pendingResolvers.push(resolve);
            });
        }

        this.isLocked = true;
        return this.release();
    }

    private release = (): (() => void) => {
        return () => {
            const nextResolver = this.pendingResolvers.shift();
            if (nextResolver) {
                nextResolver(this.release());
            } else {
                this.isLocked = false;
            }
        };
    };
}