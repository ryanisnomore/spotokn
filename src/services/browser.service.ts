import { chromium, type Browser, type LaunchOptions, type Page } from "playwright";

export class BrowserService {
    private static readonly DEFAULT_TIMEOUT = 30000;
    private static readonly LAUNCH_ARGS = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
    ];

    static async create(): Promise<Browser> {
        const customExecutablePath = Bun.env.BROWSER_PATH?.trim();
        const headlessMode = Bun.env.HEADLESS !== 'false';

        const launchConfig: LaunchOptions = {
            headless: headlessMode,
            args: this.LAUNCH_ARGS,
            timeout: this.DEFAULT_TIMEOUT,
            devtools: false
        };

        if (customExecutablePath) {
            launchConfig.executablePath = customExecutablePath;
        }

        console.log(`Launching browser in ${headlessMode ? 'headless' : 'non-headless'} mode`);
        return await chromium.launch(launchConfig);
    }

    static async page(browser: Browser): Promise<Page> {
        const page = await browser.newPage();
        await page.setDefaultTimeout(this.DEFAULT_TIMEOUT);

        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        return page;
    }

    static async close(browser: Browser): Promise<void> {
        try {
            await browser.close();
        } catch (error) {
            console.warn('Failed to close browser gracefully:', error);
        }
    }
}