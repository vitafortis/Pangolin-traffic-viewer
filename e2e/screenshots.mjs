// Loads every page of a running server (demo mode) in both themes at desktop and phone sizes,
// saves screenshots to e2e/out, and exits non-zero on any page error or failed API call.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const problems = [];

for (const theme of ["dark", "light"]) {
    for (const [device, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
        const ctx = await browser.newContext({ viewport, deviceScaleFactor: device === "phone" ? 2 : 1, colorScheme: theme });
        await ctx.addInitScript((t) => localStorage.setItem("ptv-theme", t), theme);
        const page = await ctx.newPage();
        page.on("pageerror", (e) => problems.push(`${theme}/${device}: ${e.message}`));
        page.on("console", (m) => m.type() === "error" && problems.push(`${theme}/${device} console: ${m.text()}`));
        page.on("response", (r) => r.url().includes("/api/") && r.status() >= 400 && problems.push(`${theme}/${device}: ${r.status()} ${r.url()}`));
        for (const tab of ["map", "alerts", "settings"]) {
            await page.goto(`${base}/#${tab}`);
            await page.reload();
            await page.waitForTimeout(tab === "map" ? 6000 : 1500);
            // Viewport capture first: a full-page capture resizes the viewport, which re-renders the WebGL globe.
            await page.screenshot({ path: `${out}${theme}-${device}-${tab}.png` });
            if (device === "phone") await page.screenshot({ path: `${out}${theme}-${device}-${tab}-full.png`, fullPage: true });
        }
        if (device === "desktop") {
            await page.goto(`${base}/#map`);
            await page.reload();
            await page.waitForTimeout(4000);
            await page.locator("table.data-table tbody tr.click").last().click();
            await page.waitForTimeout(800);
            await page.screenshot({ path: `${out}${theme}-desktop-event.png` });
        }
        await ctx.close();
    }
}
await browser.close();

if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
}
console.log(`ok: screenshots in ${out}`);
