// Loads every page of a running server (demo mode) in both themes at desktop and phone sizes, walks the
// main flows (investigate an IP, review a suggested rule, query language), saves screenshots to
// e2e/out, and exits non-zero on any page error or failed API call.
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
        const tag = `${theme}/${device}`;
        page.on("pageerror", (e) => problems.push(`${tag}: ${e.message}`));
        page.on("console", (m) => m.type() === "error" && problems.push(`${tag} console: ${m.text()}`));
        page.on("response", (r) => r.url().includes("/api/") && r.status() >= 400 && problems.push(`${tag}: ${r.status()} ${r.url()}`));
        const shot = async (name) => {
            // Viewport capture first: a full-page capture resizes the viewport, which re-renders the WebGL globe.
            await page.screenshot({ path: `${out}${theme}-${device}-${name}.png` });
            if (device === "phone") await page.screenshot({ path: `${out}${theme}-${device}-${name}-full.png`, fullPage: true });
        };

        for (const tab of ["map", "explore", "policies", "alerts", "settings"]) {
            await page.goto(`${base}/?tab=${tab}`);
            await page.waitForTimeout(tab === "map" ? 6000 : 2000);
            await shot(tab);
        }
        if (device !== "desktop") {
            await ctx.close();
            continue;
        }

        // Query language: a search that should return denied scanner traffic.
        await page.goto(`${base}/?q=${encodeURIComponent("verdict:deny path:/wp-*")}`);
        await page.waitForTimeout(4000);
        if ((await page.locator("table.data-table tbody tr.click").count()) === 0) problems.push(`${tag}: query "verdict:deny path:/wp-*" returned no rows`);
        await shot("query");

        // Investigate the first IP in the table.
        await page.locator("table.data-table tbody tr.click button[title^='Investigate']").first().click();
        await page.waitForTimeout(1500);
        await shot("entity");
        await page.keyboard.press("Escape");

        // Event detail.
        await page.locator("table.data-table tbody tr.click").first().click();
        await page.waitForTimeout(800);
        await shot("event");
        await page.keyboard.press("Escape");

        // Drag the events panel up and the group-by panel wider; both should grow.
        const split = page.getByRole("separator", { name: "Resize events panel" });
        const sb = await split.boundingBox();
        await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
        await page.mouse.down();
        await page.mouse.move(sb.x + sb.width / 2, sb.y - 250, { steps: 8 });
        await page.mouse.up();
        const side = await page.getByRole("separator", { name: "Resize group-by panel" }).boundingBox();
        await page.mouse.move(side.x + side.width / 2, side.y + 300);
        await page.mouse.down();
        await page.mouse.move(side.x - 120, side.y + 300, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(800);
        const after = (await split.boundingBox()).y;
        if (after > sb.y - 200) problems.push(`${tag}: events panel did not resize (${sb.y} -> ${after})`);
        await shot("resized");

        // Review the first suggested rule: the composer should load an impact preview.
        await page.goto(`${base}/?tab=policies`);
        await page.waitForTimeout(2500);
        const review = page.getByRole("button", { name: /Review/ }).first();
        if (await review.count()) {
            await review.click();
            await page.getByText(/newly blocked/i).first().waitFor({ timeout: 10000 }).catch(() => problems.push(`${tag}: rule preview never loaded`));
            await shot("composer");
        } else problems.push(`${tag}: no rule suggestions in demo`);
        await ctx.close();
    }
}
await browser.close();

if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
}
console.log(`ok: screenshots in ${out}`);
