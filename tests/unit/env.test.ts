import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env, requireSupabasePublic, requireSupabaseService } from '@/lib/env';

const SNAPSHOT_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_APP_URL',
  'RESEND_FROM',
  'VAPID_SUBJECT',
  'SDI_PROVIDER',
  'KYC_PROVIDER',
  'BG_REMOVAL_PROVIDER',
];

describe('env', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {};
    for (const k of SNAPSHOT_KEYS) original[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of SNAPSHOT_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('returns undefined for unset vars', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(env.supabaseUrl()).toBeUndefined();
  });

  it('trims whitespace and returns undefined for empty strings', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '   ';
    expect(env.supabaseUrl()).toBeUndefined();
  });

  it('returns trimmed value for set vars', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '  https://example.supabase.co  ';
    expect(env.supabaseUrl()).toBe('https://example.supabase.co');
  });

  it('has default for appUrl', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(env.appUrl()).toBe('http://localhost:3000');
  });

  it('has default for resendFrom', () => {
    delete process.env.RESEND_FROM;
    expect(env.resendFrom()).toContain('@');
  });

  it('has default for sdiProvider (fattureincloud)', () => {
    delete process.env.SDI_PROVIDER;
    expect(env.sdiProvider()).toBe('fattureincloud');
  });

  it('has default for kycProvider (mock)', () => {
    delete process.env.KYC_PROVIDER;
    expect(env.kycProvider()).toBe('mock');
  });

  it('has default for bgRemovalProvider (mock)', () => {
    delete process.env.BG_REMOVAL_PROVIDER;
    expect(env.bgRemovalProvider()).toBe('mock');
  });
});

describe('requireSupabasePublic', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    };
  });

  afterEach(() => {
    if (original.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original.url;
    if (original.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = original.key;
  });

  it('throws when URL missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'key';
    expect(() => requireSupabasePublic()).toThrow(/Supabase/);
  });

  it('throws when key missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(() => requireSupabasePublic()).toThrow(/Supabase/);
  });

  it('returns url+key when both set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    expect(requireSupabasePublic()).toEqual({ url: 'https://x.supabase.co', key: 'anon-key' });
  });
});

describe('requireSupabaseService', () => {
  let original: Record<string, string | undefined>;

  beforeEach(() => {
    original = {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
  });

  afterEach(() => {
    if (original.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = original.url;
    if (original.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = original.key;
  });

  it('throws when service key missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => requireSupabaseService()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('returns url+key when both set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    expect(requireSupabaseService()).toEqual({ url: 'https://x.supabase.co', key: 'service-key' });
  });
});
