import { test, expect } from '@playwright/test';

/**
 * API endpoints smoke: response shape + auth enforcement.
 */

test.describe('API auth enforcement', () => {
  test('GET /api/account/delete senza auth → 401', async ({ request }) => {
    const r = await request.get('/api/account/delete');
    expect(r.status()).toBe(401);
  });

  test('POST /api/account/delete senza auth → 401', async ({ request }) => {
    const r = await request.post('/api/account/delete');
    expect(r.status()).toBe(401);
  });

  test('POST /api/returns/create senza auth → 401', async ({ request }) => {
    const r = await request.post('/api/returns/create', {
      data: { orderId: '00000000-0000-0000-0000-000000000000', reason: 'OTHER' },
    });
    expect(r.status()).toBe(401);
  });

  test('POST /api/chat/messages senza auth → 401', async ({ request }) => {
    const r = await request.post('/api/chat/messages', {
      data: { conversationId: 'x', body: 'hi' },
    });
    expect(r.status()).toBe(401);
  });

  test('POST /api/cron/process-deletions senza CRON_SECRET → 401', async ({ request }) => {
    const r = await request.post('/api/cron/process-deletions');
    expect(r.status()).toBe(401);
  });

  test('POST /api/cron/operational-alerts senza CRON_SECRET → 401', async ({ request }) => {
    const r = await request.post('/api/cron/operational-alerts');
    expect(r.status()).toBe(401);
  });
});

test.describe('API error shape', () => {
  test('401 ritorna formato standard ApiErrors', async ({ request }) => {
    const r = await request.post('/api/account/delete');
    expect(r.status()).toBe(401);
    const body = await r.json();
    // Format: { ok: false, error: { code, message } }
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: expect.any(String),
        message: expect.any(String),
      },
    });
  });
});

test.describe('Public endpoints (no auth)', () => {
  test('GET /api/health → 200/503 con JSON', async ({ request }) => {
    const r = await request.get('/api/health');
    expect([200, 503]).toContain(r.status());
    expect(r.headers()['content-type']).toContain('application/json');
  });

  test('POST /api/contact senza body → 400 (invalid)', async ({ request }) => {
    const r = await request.post('/api/contact', { data: {} });
    expect([400, 429]).toContain(r.status());
  });
});
