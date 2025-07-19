import { chromium, type Browser, type LaunchOptions, type Page } from "playwright";

export class BrowserService {
    private static readonly TIMEOUT = 45000;
    private static readonly ARGS = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--single-process'
    ];

    static async create(): Promise<Browser> {
        const execPath = Bun.env.BROWSER_PATH?.trim();
        const headless = Bun.env.HEADLESS !== 'false';

        const config: LaunchOptions = {
            headless,
            args: this.ARGS,
            timeout: this.TIMEOUT,
            devtools: false,
            slowMo: 100, 
            chromiumSandbox: false
        };

        if (execPath) {
            config.executablePath = execPath;
        }

        console.log(`Launching browser (headless: ${headless})`);

        try {
            const browser = await chromium.launch(config);

            const testPage = await browser.newPage();
            await testPage.close();

            return browser;
        } catch (error) {
            console.error('Browser launch failed:', error);
            throw new Error(`Browser init failed: ${error}`);
        }
    }

    static async newPage(browser: Browser): Promise<Page> {
        const page = await browser.newPage();
        await page.setDefaultTimeout(this.TIMEOUT);

        await page.setViewportSize({ width: 1280, height: 720 });

        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        return page;
    }

    static async close(browser: Browser): Promise<void> {
        try {
            await browser.close();
        } catch (error) {
            console.warn('Browser close failed:', error);
        }
    }
}