'use strict';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FbAccount } from '../accounts/fb-account.entity';

const VIEWPORT = { width: 1280, height: 900 };
const BROWSER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,900',
];

interface Session {
  browser: any;
  page: any;
  userId: string;
}

@Injectable()
export class LoginSessionsService {
  private sessions = new Map<string, Session>();

  constructor(
    @InjectRepository(FbAccount) private accounts: Repository<FbAccount>,
  ) {}

  async start(userId: string, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Account not found');

    await this.close(userId, accountId);

    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      (window as any).chrome = { runtime: {} };
    });
    await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 45000 });

    this.sessions.set(accountId, { browser, page, userId });
    return { status: 'started' };
  }

  async getScreenshot(userId: string, accountId: string): Promise<Buffer> {
    const s = this.require(userId, accountId);
    return s.page.screenshot({ type: 'jpeg', quality: 65 }) as Promise<Buffer>;
  }

  async click(userId: string, accountId: string, x: number, y: number) {
    const s = this.require(userId, accountId);
    await s.page.mouse.click(x, y);
    return { ok: true };
  }

  async type(userId: string, accountId: string, text: string) {
    const s = this.require(userId, accountId);
    await s.page.keyboard.type(text, { delay: 40 });
    return { ok: true };
  }

  async press(userId: string, accountId: string, key: string) {
    const s = this.require(userId, accountId);
    await s.page.keyboard.press(key);
    return { ok: true };
  }

  async getStatus(userId: string, accountId: string) {
    const s = this.require(userId, accountId);
    const url: string = s.page.url();
    const cookies: any[] = await s.page.cookies();
    const cUser = cookies.find((c) => c.name === 'c_user');
    const loggedIn = !!cUser && !url.includes('/login') && !url.includes('/checkpoint');

    if (loggedIn) {
      await this.accounts.update(accountId, { cookies: JSON.stringify(cookies) });
    }

    return { loggedIn, url };
  }

  async close(userId: string, accountId: string) {
    const s = this.sessions.get(accountId);
    if (s && s.userId === userId) {
      try { await s.browser.close(); } catch {}
      this.sessions.delete(accountId);
    }
    return { ok: true };
  }

  private require(userId: string, accountId: string): Session {
    const s = this.sessions.get(accountId);
    if (!s || s.userId !== userId) throw new NotFoundException('No active login session');
    return s;
  }
}
