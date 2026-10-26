import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'tests', 'ui', 'tool-room-explore');
const OUT = path.join(ROOT, 'test-results', 'tool-room-explore');
const VARIANTS = ['variant-a', 'variant-b', 'variant-c'];
const UNAVAILABLE = 'ไม่พร้อมใช้ — เชื่อมใหม่';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const steps = [
  {
    key: '1-focus-budget',
    async act(page, mode) {
      await activate(page, 'table-budget', mode);
    },
    async check(page) {
      assert(await attr(page, 'table-budget', 'aria-pressed') === 'true', 'table-budget aria-pressed should be true');
      assert(await attr(page, 'table-mine', 'aria-pressed') === 'false', 'table-mine should not stay pressed');
      const tag = page.locator('[data-table="budget"] .tag');
      assert(await tag.isVisible(), 'visible "กำลังดู" tag missing on budget table');
      assert((await tag.innerText()).trim() === 'กำลังดู', 'budget tag text mismatch');
      const width = await page.$eval('[data-table="budget"]', (el) => parseFloat(getComputedStyle(el).borderTopWidth));
      assert(width >= 3, `focused budget border should thicken, got ${width}px`);
      const mineTagVisible = await page.locator('[data-table="mine"] .tag').isVisible();
      assert(mineTagVisible === false, 'old table tag must hide after refocus');
    }
  },
  {
    key: '2-connect-ports',
    async act(page, mode) {
      assert(await page.locator('[data-testid="create-shared-tool"]').isDisabled(), 'create button should start disabled');
      await activate(page, 'port-price', mode);
      await activate(page, 'port-devices', mode);
    },
    async check(page) {
      assert(await attr(page, 'port-price', 'aria-pressed') === 'true', 'port-price aria-pressed should be true');
      assert(await attr(page, 'port-devices', 'aria-pressed') === 'true', 'port-devices aria-pressed should be true');
      assert((await page.locator('[data-testid="port-price"] .port-state').innerText()).trim() === 'เปิด', 'port-price text state should read เปิด');
      assert(await page.locator('[data-testid="create-shared-tool"]').isEnabled(), 'create button should enable after two ports');
    }
  },
  {
    key: '3-create-tool',
    async act(page, mode) {
      await activate(page, 'create-shared-tool', mode);
    },
    async check(page) {
      assert(await page.locator('[data-testid="shared-tool"]').isVisible(), 'shared tool panel should appear');
      assert(await page.locator('[data-testid="tool-empty"]').isVisible() === false, 'empty state should disappear');
      const sources = await page.locator('[data-testid="shared-sources"]').innerText();
      assert(sources.includes('ผังกิจกรรม · rev 3'), 'shared sources missing ผังกิจกรรม rev 3');
      assert(sources.includes('งบประมาณ · rev 7'), 'shared sources missing งบประมาณ rev 7');
      const price = await page.locator('[data-testid="value-price"]').innerText();
      assert(/[0-9]/.test(price), 'live price value should contain a number');
      assert((await page.locator('[data-testid="status-budget"] .status-text').innerText()).trim() === 'เชื่อมอยู่ · ใช้งานได้', 'live state text mismatch');
      assert((await page.locator('[data-testid="status-budget"] .shape').innerText()).trim() === '●', 'live state should show a filled circle shape');
    }
  },
  {
    key: '4-status',
    async act(page, mode) {
      await activate(page, 'status-refresh', mode);
    },
    async check(page) {
      assert((await page.locator('[data-testid="status-budget"] .shape').innerText()).trim() === '▲', 'stale state should show a triangle shape');
      assert((await page.locator('[data-testid="status-budget"] .status-text').innerText()).trim() === 'ข้อมูลเก่า · ค้าง 1 วัน', 'stale state text mismatch');
    }
  },
  {
    key: '5-back-mine',
    async act(page, mode) {
      await activate(page, 'table-mine', mode);
    },
    async check(page) {
      assert(await attr(page, 'table-mine', 'aria-pressed') === 'true', 'table-mine aria-pressed should be true');
      assert(await attr(page, 'table-budget', 'aria-pressed') === 'false', 'table-budget aria-pressed should be false');
      assert(await page.locator('[data-table="mine"] .tag').isVisible(), 'mine tag should be visible after returning');
      const mine = await page.locator('[data-testid="mine-values"]').innerText();
      assert(mine.includes('ซุ้มอาหาร') && mine.includes('8 ซุ้ม'), 'my own table lost its data');
    }
  },
  {
    key: '6-disconnect',
    async act(page, mode) {
      await activate(page, 'disconnect-budget', mode);
    },
    async check(page) {
      assert((await page.locator('[data-testid="status-budget"] .status-text').innerText()).trim() === 'ถูกถอน', 'status text should read ถูกถอน');
      assert((await page.locator('[data-testid="status-budget"] .shape').innerText()).trim() === '✕', 'revoked state should show a cross shape');
      assert(await page.locator('[data-testid="shared-tool"]').isVisible(), 'shared tool must stay visible after revoke');
      const price = (await page.locator('[data-testid="value-price"]').innerText()).trim();
      const devices = (await page.locator('[data-testid="value-devices"]').innerText()).trim();
      assert(price === UNAVAILABLE && devices === UNAVAILABLE, `revoked values should read "${UNAVAILABLE}", got "${price}" / "${devices}"`);
      assert(!/[0-9]/.test(price) && !/[0-9]/.test(devices), 'revoked state still renders a number');
      const toolText = await page.locator('[data-testid="shared-tool"]').innerText();
      assert(!toolText.includes('1,240'), 'old price is still visible after revoke');
      assert(!toolText.includes('6 ชุด'), 'old device count is still visible after revoke');
      const sources = await page.locator('[data-testid="shared-sources"]').innerText();
      assert(sources.includes('ผังกิจกรรม · rev 3') && sources.includes('งบประมาณ · rev 7'), 'sources list changed after revoke');
    }
  }
];

async function attr(page, testid, name) {
  return (await page.getAttribute(`[data-testid="${testid}"]`, name)) ?? '';
}

async function activate(page, testid, mode) {
  if (mode === 'keyboard') {
    const reached = await focusByTab(page, testid);
    assert(reached, `keyboard: could not reach [data-testid="${testid}"] with Tab`);
    const outlined = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = getComputedStyle(el);
      return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) || 0 };
    });
    assert(outlined && outlined.outlineStyle !== 'none' && outlined.outlineWidth >= 2, `keyboard: no visible focus outline on ${testid}`);
    await page.keyboard.press('Enter');
  } else {
    await page.locator(`[data-testid="${testid}"]`).click();
  }
}

async function focusByTab(page, testid) {
  const isFocused = () => page.evaluate((id) => {
    const el = document.activeElement;
    return !!el && el.getAttribute('data-testid') === id;
  }, testid);
  if (await isFocused()) return true;
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press('Tab');
    if (await isFocused()) return true;
  }
  return false;
}

async function shoot(page, name, full = false) {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 80, fullPage: full });
}

async function runSteps(page, variant, mode, result) {
  await page.goto(variant.url);
  const started = Date.now();
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    await step.act(page, mode);
    await step.check(page);
    await shoot(page, `${variant.name}-${mode === 'keyboard' ? 'keyboard-' : ''}${step.key}`, true);
    if (mode === 'mouse') result.stepsCompleted = index + 1;
    else result.keyboardStepsCompleted = index + 1;
  }
  return Date.now() - started;
}

async function checkWidth(page, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.waitForTimeout(120);
  const measured = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  return { overflow: measured.scrollWidth > measured.innerWidth, measured };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = { status: 'FAIL', generatedAt: new Date().toISOString(), viewport: '1280x800', variants: {} };

  for (const name of VARIANTS) {
    const result = {
      stepsCompleted: 0,
      totalMs: 0,
      keyboardTotalMs: 0,
      overflow320: false,
      overflow414: false,
      failures: [],
      keyboardStepsCompleted: 0,
      measured: {}
    };
    const variant = { name, url: pathToFileURL(path.join(DIR, `${name}.html`)).href };
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => result.failures.push(`pageerror: ${error.message}`));

    try {
      result.totalMs = await runSteps(page, variant, 'mouse', result);
    } catch (error) {
      result.failures.push(`mouse: ${error.message}`);
    }

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      result.keyboardTotalMs = await runSteps(page, variant, 'keyboard', result);
    } catch (error) {
      result.failures.push(`keyboard: ${error.message}`);
    }

    try {
      const at414 = await checkWidth(page, 414);
      result.overflow414 = at414.overflow;
      await shoot(page, `${name}-414`, true);
      const at320 = await checkWidth(page, 320);
      result.overflow320 = at320.overflow;
      await shoot(page, `${name}-320`, true);
      result.measured = {
        scrollWidth414: at414.measured.scrollWidth,
        innerWidth414: at414.measured.innerWidth,
        scrollWidth320: at320.measured.scrollWidth,
        innerWidth320: at320.measured.innerWidth
      };
      const focusMode = await page.evaluate(() => {
        const mine = document.querySelector('[data-testid="mine-values"]');
        const budget = document.querySelector('[data-testid="budget-values"]');
        const mineOpen = !!mine && mine.offsetParent !== null;
        const budgetOpen = !!budget && budget.offsetParent !== null;
        return { mineOpen, budgetOpen };
      });
      assert(focusMode.mineOpen && !focusMode.budgetOpen, 'mobile single-table focus mode should hide the unfocused table data');
      assert(result.overflow320 === false, `horizontal overflow at 320px`);
      assert(result.overflow414 === false, `horizontal overflow at 414px`);
    } catch (error) {
      result.failures.push(`responsive: ${error.message}`);
    }

    try {
      const reduced = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      const reducedPage = await reduced.newPage();
      await reducedPage.goto(variant.url);
      const longest = await reducedPage.evaluate(() => {
        let max = 0;
        document.querySelectorAll('*').forEach((el) => {
          const style = getComputedStyle(el);
          const parts = style.transitionDuration.split(',').map((value) => parseFloat(value) || 0);
          parts.forEach((value) => { max = Math.max(max, value); });
        });
        return max;
      });
      assert(longest === 0, `prefers-reduced-motion still leaves a ${longest}s transition`);
      await reduced.close();
    } catch (error) {
      result.failures.push(`reduced-motion: ${error.message}`);
    }

    report.variants[name] = result;
    await context.close();
  }

  await browser.close();

  const variants = Object.values(report.variants);
  const ok = variants.every((item) => item.failures.length === 0
    && item.stepsCompleted === 6
    && item.keyboardStepsCompleted === 6
    && item.overflow320 === false
    && item.overflow414 === false);
  report.status = ok ? 'PASS' : 'FAIL';

  await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`status=${report.status}`);
  for (const [name, item] of Object.entries(report.variants)) {
    console.log(`${name} steps=${item.stepsCompleted}/6 keyboard=${item.keyboardStepsCompleted}/6 mouseMs=${item.totalMs} keyboardMs=${item.keyboardTotalMs} overflow320=${item.overflow320} overflow414=${item.overflow414} failures=${item.failures.length}`);
    for (const failure of item.failures) console.log(`  FAIL ${failure}`);
  }
  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`driver crashed: ${error.stack}`);
  process.exitCode = 1;
});
