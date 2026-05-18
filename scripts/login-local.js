'use strict';
/**
 * Opens a real Chrome window. Log into Facebook — cookies are saved automatically.
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const puppeteer = (await import('puppeteer')).default;

  console.log('\nOpening Chrome — log into Facebook in the window that appears...\n');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--window-size=1280,900', '--no-sandbox', '--disable-setuid-sandbox'],
  });

  const [page] = await browser.pages();
  await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 60000 });

  console.log('Waiting for you to log in...');

  // Poll until logged in
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    let cookies;
    try {
      cookies = await page.cookies('https://www.facebook.com');
    } catch {
      continue;
    }
    const cUser = cookies.find(c => c.name === 'c_user');
    const url = page.url();
    if (cUser && !url.includes('/login') && !url.includes('/checkpoint')) {
      console.log(`\n✓ Logged in! (c_user = ${cUser.value})`);
      const outPath = path.join(__dirname, '..', 'fb-cookies.json');
      fs.writeFileSync(outPath, JSON.stringify(cookies));
      console.log(`✓ Cookies saved → ${outPath}`);
      await browser.close();
      return;
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
