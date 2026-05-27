import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env — vi.mock hoists so factory must be self-contained
vi.mock('@/lib/env', () => ({
  env: {
    turnstileSecretKey: vi.fn(() => ''),
  },
}));

// Mock global fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { verifyTurnstileToken } from '@/lib/captcha';
import { env } from '@/lib/env';

// Re-cast per accesso al mock dopo l'import
const envMock = env as unknown as { turnstileSecretKey: ReturnType<typeof vi.fn> };

describe('verifyTurnstileToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips verification when secret not configured', async () => {
    envMock.turnstileSecretKey.mockReturnValue('');
    const result = await verifyTurnstileToken('any-token');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns CAPTCHA mancante when secret set but no token', async () => {
    envMock.turnstileSecretKey.mockReturnValue('test-secret');
    const result = await verifyTurnstileToken(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/mancante/i);
  });

  it('verifies token successfully', async () => {
    envMock.turnstileSecretKey.mockReturnValue('test-secret');
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    } as unknown as Response);

    const result = await verifyTurnstileToken('valid-token');
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects invalid token', async () => {
    envMock.turnstileSecretKey.mockReturnValue('test-secret');
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ success: false, 'error-codes': ['invalid-input-response'] }),
    } as unknown as Response);

    const result = await verifyTurnstileToken('bad-token');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/non valid/i);
  });

  it('handles network errors gracefully', async () => {
    envMock.turnstileSecretKey.mockReturnValue('test-secret');
    fetchMock.mockRejectedValue(new Error('Network down'));

    const result = await verifyTurnstileToken('token');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/fallita/i);
  });

  it('includes remoteIp in request body when provided', async () => {
    envMock.turnstileSecretKey.mockReturnValue('test-secret');
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ success: true }),
    } as unknown as Response);

    await verifyTurnstileToken('token', '1.2.3.4');

    const call = fetchMock.mock.calls[0];
    const body = call[1].body as string;
    expect(body).toContain('remoteip=1.2.3.4');
  });
});
