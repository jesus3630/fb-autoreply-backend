'use strict';
const path = require('path');
const fs = require('fs');
// puppeteer v21+ is ESM-only; use dynamic import() from CJS to load it at runtime
let _puppeteer = null;
async function getPuppeteer() {
  if (!_puppeteer) _puppeteer = (await import('puppeteer')).default;
  return _puppeteer;
}

const POLL_INTERVAL = 45000;
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--window-size=1280,900',
];


const INPUT_SELECTORS = [
  'div[aria-label="Message"][contenteditable="true"]',
  'div[aria-label="Aa"][contenteditable="true"]',
  'div[data-lexical-editor="true"]',
  'div[role="textbox"][contenteditable="true"]',
  'div[contenteditable="true"][aria-placeholder]',
  'div[contenteditable="true"]',
];

function parseCookies(cookieStr) {
  try {
    const parsed = JSON.parse(cookieStr);
    if (Array.isArray(parsed)) {
      return parsed.map(c => ({ ...c, domain: '.facebook.com' }));
    }
    // Object format: {c_user, xs, datr}
    return Object.entries(parsed).map(([name, value]) => ({
      name, value: String(value), domain: '.facebook.com',
    }));
  } catch {
    throw new Error('Invalid cookie format — must be JSON array or object');
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay() {
  return 5000 + Math.floor(Math.random() * 25000);
}

class MessengerBot {
  constructor(account, db) {
    this.account = account;
    this.db = db;
    this.browser = null;
    this.page = null;
    this.running = false;
    this.consecutiveErrors = 0;
    this._seenThreadIds = new Set(); // accumulated from GraphQL responses
    this.log = (msg) => console.log(`[Bot #${account.id} - ${account.label}] ${msg}`);
  }

  async start() {
    this.running = true;
    this.consecutiveErrors = 0;
    try {
      await this._launch();
      await this._pollLoop();
    } catch (err) {
      this.log(`Fatal error: ${err.message}`);
      this.db.setAccountStatus(this.account.id, 'error', err.message);
      await this._close();
    }
  }

  stop() {
    this.running = false;
    return this._close();
  }

  async _launch() {
    // Persistent profile dir — same fingerprint across restarts, no re-login needed
    const dataDir = process.env.DATA_DIR || '/tmp/fb-profiles';
    const profileDir = path.join(dataDir, `profile-${this.account.id}`);
    const isNewProfile = !fs.existsSync(profileDir);
    fs.mkdirSync(profileDir, { recursive: true });

    this.log(`Launching browser (profile: ${profileDir})...`);
    const puppeteer = await getPuppeteer();
    this.browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      userDataDir: profileDir,
      args: BROWSER_ARGS,
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 900 });
    // Basic stealth — hide automation signals
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      window.chrome = { runtime: {} };
    });


    // Only inject cookies on first launch — after that the profile has them
    if (isNewProfile) {
      this.log('New profile — injecting cookies...');
      const cookies = parseCookies(this.account.cookies);
      await this.page.setCookie(...cookies);
    } else {
      this.log('Existing profile — using saved session');
    }

    this.log('Navigating to Messenger...');
    await this.page.goto('https://www.facebook.com/messages/t/', {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });
    await sleep(3000);

    const url = this.page.url();
    const loginWall = await this.page.evaluate(() =>
      !!(document.querySelector('input[name="email"]') ||
         document.querySelector('input[name="pass"]') ||
         document.querySelector('[data-testid="royal_login_button"]') ||
         document.title.toLowerCase().includes('log in') ||
         document.title.toLowerCase().includes('log into') ||
         document.querySelector('form#login_form'))
    ).catch(() => false);
    if (url.includes('login') || url.includes('checkpoint') || loginWall) {
      throw new Error('Facebook session expired — re-export cookies from browser and update the account');
    }

    // Dismiss PIN/encryption dialog if present
    await this._dismissPinDialog();
    this.log('Session valid, starting poll loop');
    this.db.setAccountStatus(this.account.id, 'running', null);
  }

  async _pollLoop() {
    let pollCount = 0;
    while (this.running) {
      pollCount++;
      try {
        await this._poll(pollCount);
        this.consecutiveErrors = 0;
      } catch (err) {
        const isTransient = (
          err.message.includes('detached Frame') ||
          err.message.includes('frame was detached') ||
          err.message.includes('Navigating frame') ||
          err.message.includes('Execution context was destroyed') ||
          err.message.includes('Session closed') ||
          err.message.includes('Target closed') ||
          err.message.includes('Navigation timeout')
        );

        if (isTransient) {
          // Don't count navigation/frame errors toward the failure limit — just reload and retry
          this.log(`Transient error (ignored): ${err.message}`);
          this.db.setAccountStatus(this.account.id, 'running', `Last error: ${err.message}`);
          try {
            await this.page.goto('https://www.facebook.com/messages/t/', {
              waitUntil: 'networkidle2', timeout: 30000,
            });
          } catch { /* ignore */ }
        } else {
          this.consecutiveErrors++;
          this.log(`Poll error (${this.consecutiveErrors}/3): ${err.message}`);
          this.db.setAccountStatus(this.account.id, 'running', `Last error: ${err.message}`);

          if (this.consecutiveErrors >= 3) {
            throw new Error(`3 consecutive poll failures — stopping. Last: ${err.message}`);
          }
          try {
            await this.page.goto('https://www.facebook.com/messages/t/', {
              waitUntil: 'networkidle2', timeout: 30000,
            });
          } catch { /* ignore */ }
        }
      }
      if (this.running) await sleep(POLL_INTERVAL);
    }
  }

  async _poll(pollCount) {
    this.log(`Poll #${pollCount}: checking inbox...`);

    await this.page.goto('https://www.facebook.com/messages/t/', {
      waitUntil: 'networkidle2', timeout: 30000,
    });
    await sleep(6000);
    await this._dismissPinDialog();

    const currentUrl = this.page.url();
    this.log(`Page URL: ${currentUrl}`);

    // Open Marketplace folder — sidebar items are already newest-first
    const folderUrls = await this._openMarketplaceFolder();
    for (const u of folderUrls) this._seenThreadIds.add(u.match(/\/messages\/t\/([\d]+)/)?.[1] || '');

    // Facebook auto-redirects messages/t/ to the last open thread
    const autoThread = currentUrl.match(/\/messages\/t\/([\d]+)/);
    const autoUrl = autoThread ? [`https://www.facebook.com/messages/t/${autoThread[1]}/`] : [];

    // Collect thread URLs from DOM / data attributes (supplemental)
    const scraped = await this._scrapeConvoUrls();

    // Previously seen thread IDs (older accumulation — check last)
    const seenUrls = [...this._seenThreadIds].filter(Boolean).map(id => `https://www.facebook.com/messages/t/${id}/`);

    // Priority order: Marketplace sidebar (newest first) → auto-thread → scraped → accumulated history
    let convoUrls = [...new Set([...folderUrls, ...autoUrl, ...scraped, ...seenUrls])].slice(0, 50);
    this.log(`Found ${convoUrls.length} conversations: ${JSON.stringify(convoUrls.map(u => u.split('/t/')[1]))}`);

    if (convoUrls.length === 0) {
      const shot = `/tmp/fb-autoreply-inbox-${Date.now()}.png`;
      await this.page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      this.log(`Debug screenshot: ${shot}`);
      return;
    }

    for (const convoUrl of convoUrls) {
      if (!this.running) break;
      // Always normalize to trailing slash so cooldown lookups match regardless of source
      const cleanUrl = convoUrl.split('?')[0].replace(/\/?$/, '/');
      if (await this.db.wasRecentlyReplied(this.account.id, cleanUrl)) {
        this.log(`Skipping (replied recently): ${cleanUrl}`);
        continue;
      }
      const replied = await this._replyToConvo(cleanUrl);
      if (replied) break;
    }
  }

  // Click the Marketplace folder then discover all visible buyer thread URLs
  // by clicking each sidebar conversation item (sidebar stays visible, no full reload needed)
  async _openMarketplaceFolder() {
    const discovered = [];
    try {
      // Step 1: find Marketplace CHAT FOLDER in left sidebar — return center coords, don't click
      // from inside evaluate() because React requires real mouse events (page.mouse.click).
      // No timestamp requirement: the folder shows without a timestamp when all messages are read.
      const coords = await this.page.evaluate(() => {
        const candidates = [];
        const seenY = new Set();
        for (const el of document.querySelectorAll('*')) {
          const rect = el.getBoundingClientRect();
          // Left sidebar region: x must start near 0 and not extend past 370, y must be below nav
          if (rect.left > 370 || rect.right < 50 || rect.top < 200 || rect.top > 800) continue;
          if (rect.width < 80 || rect.height < 30 || rect.height > 150) continue;
          const text = (el.innerText || '').trim();
          if (!text.startsWith('Marketplace')) continue;
          if (text.length > 200) continue;
          const yKey = Math.round(rect.top / 10) * 10;
          if (seenY.has(yKey)) continue;
          seenY.add(yKey);
          candidates.push({
            cx: rect.left + rect.width / 2,
            cy: rect.top + rect.height / 2,
            area: rect.width * rect.height,
            text: text.slice(0, 80),
          });
        }
        candidates.sort((a, b) => a.area - b.area);
        return candidates[0] || null;
      }).catch(() => null);

      if (!coords) {
        // Log sidebar text to help debug future failures
        const sidebarTexts = await this.page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('*')) {
            const rect = el.getBoundingClientRect();
            if (rect.left > 370 || rect.right < 50 || rect.top < 100 || rect.top > 700) continue;
            if (rect.width < 80 || rect.height < 30 || rect.height > 120) continue;
            const text = (el.innerText || '').trim();
            if (text.length > 5 && text.length < 80) out.push(text.split('\n')[0]);
          }
          return [...new Set(out)].slice(0, 10);
        }).catch(() => []);
        this.log(`Marketplace folder not found in sidebar. Sidebar items: ${sidebarTexts.join(' | ')}`);
        return discovered;
      }

      this.log(`Clicking Marketplace folder: "${coords.text.split('\n')[0]}" at (${Math.round(coords.cx)}, ${Math.round(coords.cy)})`);
      await this.page.mouse.click(coords.cx, coords.cy);
      await sleep(3000);

      // Debug: screenshot + URL after folder click
      const afterUrl = this.page.url();
      this.log(`URL after Marketplace click: ${afterUrl}`);
      const shot = `/tmp/fb-autoreply-marketplace-${Date.now()}.png`;
      await this.page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      this.log(`Marketplace screenshot: ${shot}`);

      // Step 2: capture URL from this first click (most recent thread)
      if (/\/messages\/t\/\d+/.test(afterUrl)) discovered.push(afterUrl.split('?')[0].replace(/\/?$/, '/'));

      // Step 3: find buyer conversation items in the sidebar
      // Pattern: "BuyerName · ListingTitle · 2h" or "· now" or "· just now" for new messages
      const items = await this.page.evaluate(() => {
        const results = [];
        const seenY = new Set();
        for (const el of document.querySelectorAll('*')) {
          const rect = el.getBoundingClientRect();
          if (rect.left > 370 || rect.right < 10) continue;
          if (rect.width < 100 || rect.height < 40 || rect.height > 150) continue;
          const text = (el.innerText || '').trim();
          // Must contain middle dot (Marketplace buyer thread indicator)
          if (!text.includes('\xb7') && !text.includes('·')) continue;
          // Accept numeric timestamp OR "now"/"just now" for brand-new messages
          if (!text.match(/(\d+[hmdsw]|now|just now)\s*$/i)) continue;
          if (text.startsWith('Marketplace\n')) continue;
          if (text.length < 5 || text.length > 200) continue;
          const yKey = Math.round(rect.top / 15) * 15;
          if (seenY.has(yKey)) continue;
          seenY.add(yKey);
          results.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: text.slice(0, 60) });
        }
        return results.slice(0, 15);
      }).catch(() => []);

      this.log(`Buyer conversation items: ${items.map(i => i.text.split('\n')[0]).join(' | ')}`);

      // Step 4: click each item and capture its URL
      for (const item of items) {
        await this.page.mouse.click(item.x, item.y);
        await sleep(800);
        const url = this.page.url();
        if (/\/messages\/t\/\d+/.test(url)) discovered.push(url.split('?')[0].replace(/\/?$/, '/'));
      }

      this.log(`Marketplace folder discovery: ${[...new Set(discovered)].length} threads`);
    } catch (err) {
      this.log(`_openMarketplaceFolder error: ${err.message}`);
    }
    return [...new Set(discovered)];
  }

  async _scrapeConvoUrls() {
    return this.page.evaluate(() => {
      const found = new Set();

      // 1. Standard <a href> tags
      for (const a of document.querySelectorAll('a[href]')) {
        const m = a.href.match(/\/messages\/t\/([\d]+)/);
        if (m) found.add(`https://www.facebook.com/messages/t/${m[1]}/`);
      }

      // 2. Elements with data-uri / data-href (Facebook uses these for SPA links)
      for (const el of document.querySelectorAll('[data-uri],[data-href],[data-url]')) {
        for (const attr of ['data-uri', 'data-href', 'data-url']) {
          const v = el.getAttribute(attr) || '';
          const m = v.match(/\/messages\/t\/([\d]+)/);
          if (m) found.add(`https://www.facebook.com/messages/t/${m[1]}/`);
        }
      }

      // 3. role="link" elements that carry an href attribute
      for (const el of document.querySelectorAll('[role="link"][href]')) {
        const m = (el.getAttribute('href') || '').match(/\/messages\/t\/([\d]+)/);
        if (m) found.add(`https://www.facebook.com/messages/t/${m[1]}/`);
      }

      // 4. Mine thread IDs from embedded JSON in <script> tags (Facebook bootstraps data here)
      for (const s of document.querySelectorAll('script')) {
        const c = s.textContent || '';
        if (!c.includes('thread_fbid') && !c.includes('thread_key')) continue;
        for (const m of c.matchAll(/"thread_fbid"\s*:\s*"(\d+)"/g)) found.add(`https://www.facebook.com/messages/t/${m[1]}/`);
        for (const m of c.matchAll(/"threadFbid"\s*:\s*"(\d+)"/g)) found.add(`https://www.facebook.com/messages/t/${m[1]}/`);
        // also numeric IDs stored directly as integers
        for (const m of c.matchAll(/"thread_id"\s*:\s*(\d{10,})/g)) found.add(`https://www.facebook.com/messages/t/${m[1]}/`);
      }

      return [...found];
    }).catch(() => []);
  }

  async _replyToConvo(convoUrl) {
    this.log(`Opening convo: ${convoUrl}`);

    await this.page.goto(convoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(4000); // extra wait for Messenger's React tree to mount

    // Only reply to Marketplace threads — look for listing card at top of conversation
    const isMarketplace = await this.page.evaluate(() => {
      return !!(
        document.querySelector('a[href*="/marketplace/item/"]') ||
        document.querySelector('a[href*="/marketplace/"]') ||
        document.querySelector('[aria-label*="Marketplace"]') ||
        document.querySelector('[data-testid*="marketplace"]') ||
        // Listing price/title card shown at top of Marketplace threads
        Array.from(document.querySelectorAll('a[href]')).some(a =>
          a.href.includes('/marketplace/') && !a.href.includes('/messages/')
        )
      );
    }).catch(() => false);

    this.log(`isMarketplace=${isMarketplace} for ${convoUrl}`);
    if (!isMarketplace) {
      this.log(`Skipping non-Marketplace thread: ${convoUrl}`);
      return false;
    }

    // Detect if the last message in the conversation is from us (outgoing).
    // Outgoing bubbles are right-aligned; incoming are left-aligned.
    // We find visible message text bubbles via dir="auto" and check their center x position.
    const { lastIsFromUs: lastIsFromUs, debugBubble } = await this.page.evaluate(() => {
      const vpWidth = document.documentElement.clientWidth || window.innerWidth || 1280;
      const vpHeight = document.documentElement.clientHeight || window.innerHeight || 900;
      const bubbles = Array.from(document.querySelectorAll('[dir="auto"]')).filter(el => {
        if (el.getAttribute('contenteditable')) return false;
        if (el.getAttribute('role') === 'textbox') return false;
        const text = (el.textContent || '').trim();
        if (!text) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 30 && rect.width < 700 && rect.height > 14 &&
               rect.top > 100 && rect.bottom < (vpHeight - 80) &&
               rect.left > 300 &&
               rect.left < 900; // exclude right-side listing details panel (starts ~x=900+)
      });
      if (!bubbles.length) return { lastIsFromUs: false, debugBubble: 'NO_BUBBLES' };
      const last = bubbles[bubbles.length - 1];
      const rect = last.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      // Message thread column is ~360-860px wide. Outgoing bubbles are right-aligned
      // within it, so their center is typically 600-820. Incoming are 400-600.
      // Use 55% of viewport (704px) as the outgoing threshold — above the midpoint of the thread.
      const isFromUs = centerX > (vpWidth * 0.55);
      return {
        lastIsFromUs: isFromUs,
        debugBubble: `text="${(last.textContent||'').trim().slice(0,40)}" rect={l:${Math.round(rect.left)},r:${Math.round(rect.right)},w:${Math.round(rect.width)},cx:${Math.round(centerX)}} vpW=${vpWidth} total=${bubbles.length}`,
      };
    }).catch(() => ({ lastIsFromUs: false, debugBubble: 'EVAL_ERROR' }));

    this.log(`lastIsFromUs=${lastIsFromUs} [${debugBubble}] for ${convoUrl}`);
    if (lastIsFromUs) {
      this.log(`Last message is from us — skipping: ${convoUrl}`);
      // Mark as replied so we don't revisit for 5 min
      this.db.markReplied(this.account.id, convoUrl, null);
      return false;
    }

    // Pick next template
    const template = await this.db.getNextTemplate();
    this.log(`Template: ${template ? `#${template.id} "${template.body.slice(0, 40)}..."` : 'NONE'}`);
    if (!template) {
      this.log('No templates configured — skipping');
      return false;
    }

    // Human-like delay
    const delay = randomDelay();
    this.log(`Picked template #${template.id} (use_count=${template.use_count}), waiting ${(delay / 1000).toFixed(1)}s...`);
    await sleep(delay);

    if (!this.running) return false;

    // Facebook may SPA-navigate during the delay — re-navigate to the target thread if needed
    const postDelayUrl = this.page.url().split('?')[0];
    if (!postDelayUrl.includes(convoUrl.replace('https://www.facebook.com', ''))) {
      this.log(`Page drifted to ${postDelayUrl} during delay — re-navigating to ${convoUrl}`);
      await this.page.goto(convoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await sleep(3000);
    }

    // Find message input
    let inputEl = null;
    for (const selector of INPUT_SELECTORS) {
      try {
        inputEl = await this.page.waitForSelector(selector, { timeout: 8000 });
        if (inputEl) { this.log(`Input found with selector: ${selector}`); break; }
      } catch {
        // try next selector
      }
    }

    if (!inputEl) {
      // Screenshot for debugging
      const shot = `/tmp/fb-autoreply-debug-${Date.now()}.png`;
      await this.page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      // Log all contenteditable divs found on page
      const editables = await this.page.evaluate(() =>
        Array.from(document.querySelectorAll('[contenteditable]')).map(el => ({
          tag: el.tagName,
          role: el.getAttribute('role'),
          aria: el.getAttribute('aria-label'),
          placeholder: el.getAttribute('aria-placeholder'),
          lexical: el.getAttribute('data-lexical-editor'),
        }))
      ).catch(() => []);
      this.log(`Debug screenshot: ${shot}`);
      this.log(`Contenteditable elements found: ${JSON.stringify(editables)}`);
      this.db.insertLog(
        this.account.id, this.account.label, convoUrl,
        template.id, template.body, 'error', 'Could not locate message input'
      );
      return false;
    }

    await inputEl.click();
    await sleep(500);

    // Type with natural per-character delay
    await this.page.keyboard.type(template.body, { delay: 30 + Math.random() * 40 });
    await sleep(500);
    await this.page.keyboard.press('Enter');
    await sleep(2000);

    // Update DB
    this.db.markReplied(this.account.id, convoUrl, template.id);
    this.db.incrementTemplateUse(template.id);
    this.db.insertLog(
      this.account.id, this.account.label, convoUrl,
      template.id, template.body, 'sent', null
    );

    this.log(`Replied to ${convoUrl} with template #${template.id}`);
    return true;
  }

  async _dismissPinDialog() {
    try {
      for (let i = 0; i < 10; i++) {
        const hasDialog = await this.page.$('div[role="dialog"]').catch(() => null);
        if (!hasDialog) break;

        // Only handle dialogs that are PIN/encryption related — ignore notification popups, etc.
        const isPinDialog = await this.page.evaluate(() => {
          for (const d of document.querySelectorAll('div[role="dialog"]')) {
            const t = (d.innerText || '').toLowerCase();
            if (t.includes('restore messages') || t.includes('encryption') ||
                t.includes('continue without') || t.includes('end-to-end') ||
                t.includes('pin') || t.includes("don't restore")) return true;
          }
          return false;
        }).catch(() => false);

        if (!isPinDialog) break;

        // Look for the confirmation layer "Continue without restoring?" and click "Don't restore messages"
        const confirmCoords = await this.page.evaluate(() => {
          for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
            const dialogText = (dialog.innerText || '');
            if (!dialogText.includes('Continue without restoring')) continue;
            // Scan all elements; find one whose innerText IS exactly the button text (short, visible)
            for (const el of dialog.querySelectorAll('*')) {
              const elText = (el.innerText || '').trim();
              if (!elText.includes('restore messages') || elText.length > 25) continue;
              if (el.getAttribute('aria-hidden') === 'true') continue;
              const rect = el.getBoundingClientRect();
              if (rect.width < 10 || rect.height < 10) continue;
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, text: elText };
            }
          }
          return null;
        }).catch(() => null);

        if (confirmCoords) {
          this.log(`Clicking "Don't restore messages" at (${Math.round(confirmCoords.x)}, ${Math.round(confirmCoords.y)})`);
          await this.page.mouse.click(confirmCoords.x, confirmCoords.y);
          await sleep(3000);
          continue;
        }

        // Log all role=button / button elements for debugging
        const buttons = await this.page.evaluate(() => {
          const d = document.querySelector('div[role="dialog"]');
          if (!d) return [];
          return Array.from(d.querySelectorAll('[role="button"], button')).map(b => ({
            text: (b.innerText || '').trim().slice(0, 80),
            aria: b.getAttribute('aria-label'),
          }));
        }).catch(() => []);
        this.log('Dialog buttons: ' + JSON.stringify(buttons));

        // Click the Close/X button to advance to the confirmation layer
        const clickedClose = await this.page.evaluate(() => {
          const d = document.querySelector('div[role="dialog"]');
          if (!d) return false;
          const close = d.querySelector('[aria-label="Close"], [aria-label="close"]');
          if (close) { close.click(); return true; }
          for (const btn of d.querySelectorAll('[role="button"]')) {
            const lbl = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (lbl.includes('close') || lbl.includes('dismiss')) {
              btn.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (clickedClose) {
          this.log('Clicked X on PIN dialog — waiting for confirmation layer');
          await sleep(2000);
          continue;
        }

        // Escape key as last resort
        this.log('Dialog: pressing Escape');
        await this.page.keyboard.press('Escape');
        await sleep(2000);
      }
    } catch (err) {
      this.log(`_dismissPinDialog error: ${err.message}`);
    }
  }

  async _close() {
    if (this.browser) {
      try { await this.browser.close(); } catch {}
      this.browser = null;
      this.page = null;
    }
  }
}

module.exports = MessengerBot;
