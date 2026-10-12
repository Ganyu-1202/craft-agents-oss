/** Browser-safe, self-contained OAuth callback page for the server and preview. */
import { TOKENBIRD_CALLBACK_LOGO } from './callback-logo.ts';
import { classifyExternalUrl } from '../utils/url-safety.ts';

export type AppType = 'terminal' | 'electron';

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function generateCallbackPage(options: {
  title: string;
  isSuccess: boolean;
  errorDetail?: string;
  appType?: AppType;
  deeplinkUrl?: string;
}): string {
  const { title, isSuccess, errorDetail, deeplinkUrl } = options;
  const returnUrl = isSuccess && deeplinkUrl && classifyExternalUrl(deeplinkUrl).kind === 'internal-deeplink'
    ? escapeHtml(deeplinkUrl) : undefined;
  const copy = {
    en: {
      heading: isSuccess ? "You're all set!" : "Let's try that again",
      description: isSuccess ? 'Thank you for your trust. Your little bird is ready to help!' : 'Sorry, we couldn’t complete authorization this time. Please return to the app and try again.',
      hint: isSuccess ? 'You can return to the app now and safely close this tab.' : 'You can close this tab whenever you’re ready.',
      action: 'Back to TokenBird', detail: 'View error details', brand: 'TokenBird',
    },
    'zh-Hans': {
      heading: isSuccess ? '授权完成啦' : '这次没能完成授权',
      description: isSuccess ? '谢谢您的信任，小鸟已经准备好啦。' : '抱歉，这次授权没有完成。请回到应用重新试一次，小鸟会在这里等您。',
      hint: isSuccess ? '现在可以回到应用继续使用了，放心关闭这个页面就好。' : '您可以先关闭这个页面，再从应用发起授权。',
      action: '回到词元鸟', detail: '查看错误详情', brand: '词元鸟',
    },
    'zh-Hant': {
      heading: isSuccess ? '授權完成啦' : '這次沒能完成授權',
      description: isSuccess ? '謝謝您的信任，小鳥已經準備好啦。' : '抱歉，這次授權沒有完成。請回到應用程式再試一次，小鳥會在這裡等您。',
      hint: isSuccess ? '現在可以回到應用程式繼續使用了，放心關閉這個頁面就好。' : '您可以先關閉這個頁面，再從應用程式發起授權。',
      action: '回到詞元鳥', detail: '查看錯誤詳情', brand: '詞元鳥',
    },
  };

  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="referrer" content="no-referrer">
  <title>TokenBird - ${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    :root {
      color-scheme: light dark;
      --background: #f8f7fc; --surface: #ffffff; --text: #292339;
      --muted: #645e73; --border: #e8e3f1; --accent: #7451a8;
      --glow: #e9def8; --badge: ${isSuccess ? '#e6f5ec' : '#fff0e1'};
      --badge-text: ${isSuccess ? '#277349' : '#965019'};
    }
    body {
      margin: 0; min-height: 100vh; min-height: 100svh; padding: 32px 20px;
      display: grid; place-items: center; color: var(--text);
      background: radial-gradient(ellipse at 50% 35%, var(--glow), transparent 65%), var(--background);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      line-height: 1.6; overflow-wrap: anywhere;
    }
    .card {
      width: min(100%, 560px); padding: 40px 36px 32px; text-align: center;
      background: var(--surface); border: 1px solid var(--border); border-radius: 28px;
      box-shadow: 0 20px 80px #39214e0d;
    }
    .brand { display: flex; align-items: center; justify-content: center; gap: 9px; color: var(--muted); }
    .brand strong { font-size: 18px; font-weight: 600; }
    .brand span { font-size: 15px; }
    .logo { display: block; width: 132px; height: 132px; object-fit: contain; margin: 22px auto 18px; }
    .badge {
      display: grid; place-items: center; width: 38px; height: 38px; margin: -36px auto 24px;
      position: relative; left: 51px; border: 4px solid var(--surface); border-radius: 50%;
      background: var(--badge); color: var(--badge-text);
    }
    .badge svg { width: 20px; height: 20px; }
    h1 { margin: 0 0 16px; font-size: clamp(28px, 5vw, 36px); font-weight: 700; line-height: 1.3; letter-spacing: -0.025em; }
    .description { margin: 0; font-size: 19px; line-height: 1.8; color: var(--muted); }
    .return-link {
      display: inline-flex; justify-content: center; align-items: center; gap: 10px;
      min-height: 52px; margin-top: 28px; padding: 12px 28px; border-radius: 14px;
      background: var(--accent); color: #ffffff; text-decoration: none; font-size: 18px; font-weight: 600;
    }
    .return-link:hover { background: #634292; }
    .return-link:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 5px; }
    .hint { margin: 28px 0 0; padding-top: 24px; border-top: 1px solid var(--border); font-size: 16px; color: var(--muted); }
    details { margin-top: 24px; text-align: left; color: var(--muted); font-size: 16px; }
    summary { cursor: pointer; }
    .error-detail { margin: 12px 0 0; white-space: pre-wrap; max-height: 180px; overflow: auto; }
    @media (max-width: 480px) { .card { padding: 28px 22px; border-radius: 22px; } .return-link { width: 100%; } }
    @media (prefers-color-scheme: dark) {
      :root {
        --background: #17151d; --surface: #24212d; --text: #f5f1fc;
        --muted: #c0b8ce; --border: #3a3447; --accent: #7953b0; --glow: #30233f;
        --badge: ${isSuccess ? '#243e30' : '#493222'}; --badge-text: ${isSuccess ? '#a3e0b9' : '#f7c396'};
      }
    }
  </style>
</head>
<body>
  <main class="card" aria-labelledby="status-heading">
    <div class="brand"><strong data-copy="brand">词元鸟</strong><span class="brand-english" aria-hidden="true">· TokenBird</span></div>
    <img class="logo" src="${TOKENBIRD_CALLBACK_LOGO}" width="132" height="132" alt="TokenBird">
    <div class="badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${isSuccess ? '<path d="m5 12 4 4L19 6"/>' : '<path d="M12 7v6m0 4h.01"/>'}</svg></div>
    <h1 id="status-heading" data-copy="heading">${copy['zh-Hans'].heading}</h1>
    <p class="description" data-copy="description">${copy['zh-Hans'].description}</p>
    ${returnUrl ? `<a href="${returnUrl}" class="return-link"><span data-copy="action">${copy['zh-Hans'].action}</span><span aria-hidden="true">↗</span></a>` : ''}
    ${!isSuccess && errorDetail ? `<details><summary data-copy="detail">${copy['zh-Hans'].detail}</summary><p class="error-detail">${escapeHtml(errorDetail)}</p></details>` : ''}
    <p class="hint" data-copy="hint">${copy['zh-Hans'].hint}</p>
  </main>
  <script>
    const messages = ${JSON.stringify(copy)};
    const browserLanguage = navigator.language.toLowerCase();
    let language = 'en';
    if (browserLanguage.startsWith('zh')) {
      language = /hant|tw|hk|mo/.test(browserLanguage) ? 'zh-Hant' : 'zh-Hans';
    }
    document.documentElement.lang = language;
    document.querySelectorAll('[data-copy]').forEach(element => {
      element.textContent = messages[language][element.dataset.copy];
    });
    document.querySelector('.brand-english').hidden = language === 'en';
    ${isSuccess ? `setTimeout(() => {
      const returnLink = document.querySelector('.return-link');
      if (returnLink) window.location.href = returnLink.href;
      window.close();
    }, 1500);` : ''}
  </script>
</body>
</html>`;
}
