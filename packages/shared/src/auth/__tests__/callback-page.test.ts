import { describe, expect, it } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { generateCallbackPage } from '../callback-page.ts';

describe('OAuth callback page', () => {
  it('shows the bundled bird logo and a readable, welcoming success heading', () => {
    const html = generateCallbackPage({ title: 'Authorization Complete', isSuccess: true });
    expect(html).toContain('data:image/webp;base64,');
    expect(html).toContain('<h1');
    expect(html).toContain('授权完成啦');
    expect(html).toContain('Thank you for your trust');
    expect(html).toContain('min-height: 100svh');
  });

  it('keeps the app return action available on success and omits it on failure', () => {
    const success = generateCallbackPage({ title: 'Complete', isSuccess: true, deeplinkUrl: 'tokenbird://auth-complete' });
    const failure = generateCallbackPage({ title: 'Failed', isSuccess: false, deeplinkUrl: 'tokenbird://auth-complete' });
    expect(success).toContain('href="tokenbird://auth-complete"');
    expect(success).toContain('window.close()');
    expect(failure).not.toContain('href="tokenbird://auth-complete"');
    expect(failure).not.toContain('window.close()');
    expect(failure).toContain('请回到应用重新试一次');
  });

  it('renders provider text as text and rejects executable return links', () => {
    const html = generateCallbackPage({ title: '</title><script>alert(1)</script>', isSuccess: false, errorDetail: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('</title><script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const unsafe = generateCallbackPage({ title: 'Complete', isSuccess: true, deeplinkUrl: 'javascript:alert(1)' });
    expect(unsafe).not.toContain('javascript:alert(1)');
  });

  it.each([
    ['zh-CN', 'zh-Hans', '授权完成啦'],
    ['zh-TW', 'zh-Hant', '授權完成啦'],
    ['en-US', 'en', "You're all set!"],
  ])('uses the browser language %s for the visible heading', (browserLanguage, language, heading) => {
    const html = generateCallbackPage({ title: 'Complete', isSuccess: true });
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    const headingElement = { dataset: { copy: 'heading' }, textContent: '' };
    const document = {
      documentElement: { lang: '' },
      querySelectorAll: () => [headingElement],
      querySelector: () => ({ hidden: false }),
    };
    runInNewContext(script!, { document, navigator: { language: browserLanguage }, setTimeout: () => {} });
    expect(document.documentElement.lang).toBe(language);
    expect(headingElement.textContent).toBe(heading);
  });
});
