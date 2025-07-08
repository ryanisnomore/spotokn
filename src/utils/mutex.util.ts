export class MutexLock {
    private isLocked = false;
    private pendingResolvers: Array<(releaseCallback: () => void) => void> = [];

    async acquireLock(): Promise<() => void> {
        if (this.isLocked) {
            return new Promise((resolve) => {
                this.pendingResolvers.push(resolve);
            });
        }

        this.isLocked = true;
        return this.createReleaseCallback();
    }

    private createReleaseCallback = (): (() => void) => {
        return () => {
            const nextResolver = this.pendingResolvers.shift();
            if (nextResolver) {
                nextResolver(this.createReleaseCallback());
            } else {
                this.isLocked = false;
            }
        };
    };
}