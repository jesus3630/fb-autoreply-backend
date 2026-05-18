'use strict';
/**
 * End-to-end test of bot reply logic against a local mock Messenger page.
 * Proves: Marketplace detection, outgoing-message detection, input finding, type+send.
 * No Facebook credentials required.
 */
const http = require('http');

const MOCK_HTML = `<!DOCTYPE html>
<html>
<head><title>Messages</title><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Helvetica,sans-serif;">
<!-- Top navigation bar (mirrors Facebook's ~56px header) -->
<div style="height:56px;background:#1877f2;width:100%;flex-shrink:0;"></div>
<div style="display:flex;width:1280px;height:844px;overflow:hidden;">

  <!-- Sidebar: 360px wide (mirrors Facebook layout) -->
  <div style="width:360px;flex-shrink:0;background:#f5f5f5;padding:10px;box-sizing:border-box;">
    <div style="padding:12px;font-weight:bold;font-size:16px;">Marketplace</div>
    <div style="padding:12px;cursor:pointer;background:#fff;border-radius:8px;">
      Turin · 2009 Jeep Wrangler Unlimited Sport · 2h
    </div>
  </div>

  <!-- Chat area: remaining 920px -->
  <div style="flex:1;display:flex;flex-direction:column;background:#fff;min-width:0;">
    <!-- Marketplace listing card at top of thread -->
    <div style="padding:16px;border-bottom:1px solid #eee;font-size:13px;">
      <a href="/marketplace/item/987654321/">2009 Jeep Wrangler Unlimited Sport &mdash; $12,500</a>
    </div>

    <!-- Message bubbles -->
    <div id="messages" style="flex:1;padding:16px 24px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;">
      <!-- Buyer's incoming message — left-aligned (not from us) -->
      <div style="display:flex;align-items:flex-end;gap:8px;justify-content:flex-start;">
        <div style="width:28px;height:28px;border-radius:50%;background:#bbb;flex-shrink:0;"></div>
        <div dir="auto"
             style="background:#f0f0f0;padding:9px 14px;border-radius:18px;max-width:320px;font-size:14px;line-height:1.4;">
          Is this Jeep still available? What&#39;s the lowest you&#39;d take?
        </div>
      </div>
    </div>

    <!-- Compose bar at bottom -->
    <div style="padding:10px 16px;border-top:1px solid #eee;display:flex;align-items:center;">
      <div id="msg-input"
           contenteditable="true"
           aria-label="Message"
           dir="auto"
           style="flex:1;border:1px solid #ccc;padding:9px 14px;border-radius:20px;min-height:36px;
                  max-height:120px;outline:none;font-size:14px;line-height:1.4;overflow-y:auto;">
      </div>
    </div>
  </div>
</div>

<script>
  window._replySent = false;
  window._sentText  = '';

  const input = document.getElementById('msg-input');

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var text = input.innerText.trim();
      if (!text) return;

      /* Append sent bubble (right-aligned) so next lastIsFromUs check returns true */
      var row  = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:flex-end;';
      var bbl  = document.createElement('div');
      bbl.dir  = 'auto';
      bbl.style.cssText = 'background:#0084ff;color:#fff;padding:9px 14px;border-radius:18px;' +
                          'max-width:320px;font-size:14px;line-height:1.4;';
      bbl.innerText = text;
      row.appendChild(bbl);
      document.getElementById('messages').appendChild(row);
      input.innerText = '';

      window._replySent = true;
      window._sentText  = text;
      document.title    = 'REPLY_SENT';
    }
  });

  /* Simulate being inside a Messenger thread URL */
  history.pushState({}, '', '/messages/t/987654321/');
</script>
</body>
</html>`;

async function runTest() {
  /* ── Start local mock server ── */
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MOCK_HTML);
  });
  await new Promise(r => server.listen(9876, r));
  console.log('\nMock Messenger server → http://localhost:9876');

  const puppeteer = (await import('puppeteer')).default;
  const browser   = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('http://localhost:9876/messages/t/987654321/', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 800));

    /* ── Test 1: Marketplace detection ── */
    const isMarketplace = await page.evaluate(() => !!(
      document.querySelector('a[href*="/marketplace/item/"]') ||
      document.querySelector('a[href*="/marketplace/"]') ||
      document.querySelector('[aria-label*="Marketplace"]') ||
      Array.from(document.querySelectorAll('a[href]'))
            .some(a => a.href.includes('/marketplace/') && !a.href.includes('/messages/'))
    ));
    console.log(`\n[1] isMarketplace = ${isMarketplace}  (expected: true)`);
    if (!isMarketplace) throw new Error('Marketplace detection failed');

    /* ── Test 2: Outgoing-message detection (should be FALSE — buyer messaged last) ── */
    const lastIsFromUs = await page.evaluate(() => {
      const vpWidth  = document.documentElement.clientWidth  || 1280;
      const vpHeight = document.documentElement.clientHeight || 900;
      const bubbles  = Array.from(document.querySelectorAll('[dir="auto"]')).filter(el => {
        if (el.getAttribute('contenteditable')) return false;   // exclude compose box
        if (el.getAttribute('role') === 'textbox') return false;
        const text = (el.textContent || '').trim();
        if (!text) return false;
        const r = el.getBoundingClientRect();
        return r.width > 30 && r.width < 700 && r.height > 14 &&
               r.top > 100 && r.bottom < (vpHeight - 80) && r.left > 300;
      });
      if (!bubbles.length) return null; // no bubbles found
      const last = bubbles[bubbles.length - 1];
      const r    = last.getBoundingClientRect();
      return (r.left + r.width / 2) > (vpWidth * 0.6);
    });
    console.log(`[2] lastIsFromUs  = ${lastIsFromUs}  (expected: false — buyer's message is last)`);
    if (lastIsFromUs !== false) throw new Error(`Outgoing-message detection wrong: ${lastIsFromUs}`);

    /* ── Test 3: Find message input ── */
    const INPUT_SELECTORS = [
      'div[aria-label="Message"][contenteditable="true"]',
      'div[aria-label="Aa"][contenteditable="true"]',
      'div[data-lexical-editor="true"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][aria-placeholder]',
      'div[contenteditable="true"]',
    ];
    let inputEl = null;
    let usedSelector = '';
    for (const sel of INPUT_SELECTORS) {
      try {
        inputEl = await page.waitForSelector(sel, { timeout: 2000 });
        if (inputEl) { usedSelector = sel; break; }
      } catch {}
    }
    console.log(`[3] Input found   = ${!!inputEl}  selector: "${usedSelector}"`);
    if (!inputEl) throw new Error('Message input not found');

    /* ── Test 4: Type template + send ── */
    const TEMPLATE = "Hey! Thanks for reaching out about my listing. It's still available! When would you like to take a look?";
    await inputEl.click();
    await new Promise(r => setTimeout(r, 150));
    await page.keyboard.type(TEMPLATE, { delay: 8 });
    await new Promise(r => setTimeout(r, 150));
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 400));

    const { sent, sentText } = await page.evaluate(() => ({
      sent:     window._replySent,
      sentText: window._sentText,
    }));
    console.log(`[4] Reply sent    = ${sent}  (expected: true)`);
    if (sent) console.log(`    Message: "${sentText.slice(0, 80)}..."`);
    if (!sent) throw new Error('Reply was not sent');

    /* ── All passed ── */
    console.log('\n✅  ALL TESTS PASSED');
    console.log('   Bot correctly:');
    console.log('   1. Identified the Marketplace thread');
    console.log('   2. Detected last message is from buyer (not from us)');
    console.log('   3. Located the message compose box');
    console.log('   4. Typed and sent the reply template via Enter key');
  } finally {
    await browser.close();
    server.close();
  }
}

runTest().catch(err => {
  console.error('\n❌  TEST FAILED:', err.message);
  process.exit(1);
});
