/**
 * Parser user-agent dependency-free.
 *
 * Niente librerie esterne (coerente col repo: rate-limiter, consent, ecc. fatti
 * a mano). Heuristica a regex: sufficiente a distinguere device/browser/OS e i
 * bot per la dashboard di sorveglianza admin. Non è una fingerprint forense.
 */

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';

export type ParsedUA = {
  deviceType: DeviceType;
  browser: string;
  os: string;
  isBot: boolean;
};

const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|preview|facebookexternalhit|whatsapp|telegrambot|embedly|quora link|pinterest|semrush|ahrefs|mj12|dotbot|petalbot|gptbot|claudebot|ccbot|python-requests|curl|wget|axios|node-fetch/i;

function detectOS(ua: string): string {
  if (/windows nt/i.test(ua)) return 'Windows';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/android/i.test(ua)) return 'Android';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Sconosciuto';
}

function detectBrowser(ua: string): string {
  // ordine importante: Edge/Samsung/Opera prima di Chrome (contengono "Chrome")
  if (/edg(e|a|ios)?\//i.test(ua)) return 'Edge';
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/chrome|crios/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Sconosciuto';
}

function detectDevice(ua: string): DeviceType {
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua))
    return 'mobile';
  if (/windows nt|macintosh|mac os x|cros|linux|x11/i.test(ua)) return 'desktop';
  return 'unknown';
}

export function parseUserAgent(ua: string | null | undefined): ParsedUA {
  const s = (ua ?? '').trim();
  if (!s) {
    return { deviceType: 'unknown', browser: 'Sconosciuto', os: 'Sconosciuto', isBot: false };
  }
  if (BOT_RE.test(s)) {
    return { deviceType: 'bot', browser: 'Bot/Crawler', os: detectOS(s), isBot: true };
  }
  return {
    deviceType: detectDevice(s),
    browser: detectBrowser(s),
    os: detectOS(s),
    isBot: false,
  };
}
