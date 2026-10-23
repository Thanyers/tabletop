import { describe, expect, it } from 'vitest';
import type { TableSource } from '../shared/table-contracts';
import { webSourceMeta, webSourceStatusLabel } from './table-source-view';

const webSource = (patch: Partial<Pick<TableSource, 'url' | 'publishedAt' | 'authority'>> = {}): Pick<TableSource, 'url' | 'publishedAt' | 'authority'> => ({
  url: 'https://example.go.th/x',
  publishedAt: '2026-07-26T16:00:00+00:00',
  authority: 4,
  ...patch,
});

describe('web source card labels (F064 slice C)', () => {
  it('labels every review status and treats a row without one as provided', () => {
    expect(webSourceStatusLabel('provided')).toBe('Provided');
    expect(webSourceStatusLabel('verified')).toBe('Verified');
    expect(webSourceStatusLabel('rejected')).toBe('Rejected');
    expect(webSourceStatusLabel(undefined)).toBe('Provided');
  });

  it('keeps the safe host link, date only, and authority for a valid source', () => {
    expect(webSourceMeta(webSource())).toEqual({
      href: 'https://example.go.th/x',
      host: 'example.go.th',
      dateLabel: '26 Jul 2026',
      authorityLabel: 'authority 4',
    });
  });

  it('drops an unusable date and refuses to link an unsafe URL', () => {
    expect(webSourceMeta(webSource({ publishedAt: 'not-a-date' })).dateLabel).toBe('');
    expect(webSourceMeta(webSource({ publishedAt: null })).dateLabel).toBe('');
    expect(webSourceMeta(webSource({ publishedAt: '2026-07-26' })).dateLabel).toBe('26 Jul 2026');
    expect(webSourceMeta(webSource({ url: 'javascript:alert(1)' }))).toMatchObject({ href: null, host: '' });
    expect(webSourceMeta(webSource({ url: 'https://localhost/x' })).href).toBeNull();
  });

  it('shows an authority only inside the 0-4 range, including zero', () => {
    expect(webSourceMeta(webSource({ authority: 0 })).authorityLabel).toBe('authority 0');
    expect(webSourceMeta(webSource({ authority: 2 })).authorityLabel).toBe('authority 2');
    expect(webSourceMeta(webSource({ authority: 9 })).authorityLabel).toBe('');
    expect(webSourceMeta(webSource({ authority: -1 })).authorityLabel).toBe('');
    expect(webSourceMeta(webSource({ authority: undefined })).authorityLabel).toBe('');
  });
});
