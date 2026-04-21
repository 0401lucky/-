import { describe, expect, it } from 'vitest';
import { getSafeRedirectPath } from '@/lib/navigation';

describe('getSafeRedirectPath', () => {
  it('allows same-site relative paths', () => {
    expect(getSafeRedirectPath('/admin')).toBe('/admin');
    expect(getSafeRedirectPath('/project/abc?tab=records')).toBe('/project/abc?tab=records');
    expect(getSafeRedirectPath('/')).toBe('/');
  });

  it('falls back for empty or non-relative redirects', () => {
    expect(getSafeRedirectPath(undefined)).toBe('/');
    expect(getSafeRedirectPath('')).toBe('/');
    expect(getSafeRedirectPath('https://evil.example')).toBe('/');
    expect(getSafeRedirectPath('javascript:alert(1)')).toBe('/');
  });

  it('rejects protocol-relative and encoded external redirects', () => {
    expect(getSafeRedirectPath('//evil.example')).toBe('/');
    expect(getSafeRedirectPath('/%2F%2Fevil.example')).toBe('/');
  });

  it('rejects control characters and backslashes', () => {
    expect(getSafeRedirectPath('/admin\nattack')).toBe('/');
    expect(getSafeRedirectPath('/admin\\evil')).toBe('/');
  });

  it('supports custom fallback', () => {
    expect(getSafeRedirectPath('https://evil.example', '/login')).toBe('/login');
  });
});
