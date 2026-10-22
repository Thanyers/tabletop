// F052: renders docs/showcase/og-card.html to public/og-image.png (1200×630 share card).
// Usage: node scripts/render-og-image.mjs  (BROWSER_CHANNEL=chrome to use an installed Chrome)
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(new URL('docs/showcase/og-card.html', root).href);
  await page.evaluate(() => document.fonts.ready);
  const missing = await page.evaluate(() => [500, 800].filter((weight) => !document.fonts.check(`${weight} 20px Manrope`)));
  if (missing.length) throw new Error(`Manrope ${missing.join(', ')} did not load; run npm ci first.`);
  await page.screenshot({ path: fileURLToPath(new URL('public/og-image.png', root)), type: 'png' });
} finally {
  await browser.close();
}
