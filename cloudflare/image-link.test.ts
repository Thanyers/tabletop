import { describe, expect, it, vi } from 'vitest';
import { fetchImageFromLink, MAX_LINK_IMAGE_BYTES, pageImageUrl, publicLinkUrl } from './image-link';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function routes(map: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
    const route = map[url];
    return route ? route() : new Response('missing', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('F092 image from a link', () => {
  it('accepts only public http(s) names', () => {
    expect(publicLinkUrl('https://books.example.co.jp/cover.png#x')?.toString()).toBe('https://books.example.co.jp/cover.png');
    for (const bad of ['ftp://a.com/x', 'http://localhost/x', 'http://127.0.0.1/x', 'http://[::1]/x', 'http://10.0.0.1/x', 'http://2130706433/x', 'http://intranet/x',
      'http://printer.local/x', 'https://user:pw@a.com/x', 'https://a.com:8443/x', 'javascript:alert(1)', 'http://0x7f.0.0.1/x']) {
      expect(publicLinkUrl(bad), bad).toBeNull();
    }
  });

  it('reads the og:image of a page, resolved against the page address', () => {
    const page = new URL('https://shop.example.com/book/42');
    expect(pageImageUrl('<head><meta content="/img/c.jpg?w=600&amp;h=900" property="og:image"></head>', page)?.toString())
      .toBe('https://shop.example.com/img/c.jpg?w=600&h=900');
    expect(pageImageUrl('<meta name="twitter:image" content="https://cdn.example.com/t.png">', page)?.toString()).toBe('https://cdn.example.com/t.png');
    expect(pageImageUrl('<meta property="og:image" content="http://127.0.0.1/x.png">', page)).toBeNull();
    expect(pageImageUrl('<p>no picture</p>', page)).toBeNull();
  });

  it('fetches a picture directly and types it by its bytes', async () => {
    const { fetchImpl } = routes({ 'https://cdn.example.com/c.png': () => new Response(png, { headers: { 'content-type': 'text/plain' } }) });
    const image = await fetchImageFromLink('https://cdn.example.com/c.png', { fetchImpl });
    expect(image.mime).toBe('image/png');
    expect(image.imageUrl).toBe('https://cdn.example.com/c.png');
  });

  it('follows a page to its og:image, re-checking every redirect', async () => {
    const { fetchImpl, calls } = routes({
      'https://shop.example.com/book/42': () => new Response(null, { status: 302, headers: { location: '/b/42' } }),
      'https://shop.example.com/b/42': () => new Response('<meta property="og:image" content="https://cdn.example.com/c.png">', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      'https://cdn.example.com/c.png': () => new Response(png),
    });
    const image = await fetchImageFromLink('https://shop.example.com/book/42', { fetchImpl });
    expect(image.imageUrl).toBe('https://cdn.example.com/c.png');
    expect(calls).toEqual(['https://shop.example.com/book/42', 'https://shop.example.com/b/42', 'https://cdn.example.com/c.png']);
  });

  it('refuses a redirect into a private address, a page without a picture, a non-image and an oversized picture', async () => {
    await expect(fetchImageFromLink('https://a.example.com/x', routes({ 'https://a.example.com/x': () => new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest' } }) })))
      .rejects.toMatchObject({ code: 'IMAGE_LINK_INVALID' });
    await expect(fetchImageFromLink('https://a.example.com/p', routes({ 'https://a.example.com/p': () => new Response('<p>hi</p>', { headers: { 'content-type': 'text/html' } }) })))
      .rejects.toMatchObject({ code: 'IMAGE_LINK_NO_IMAGE' });
    await expect(fetchImageFromLink('https://a.example.com/f', routes({ 'https://a.example.com/f': () => new Response('GIF89a....', { headers: { 'content-type': 'image/gif' } }) })))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    await expect(fetchImageFromLink('https://a.example.com/big', routes({ 'https://a.example.com/big': () => new Response(png, { headers: { 'content-length': String(MAX_LINK_IMAGE_BYTES + 1) } }) })))
      .rejects.toMatchObject({ code: 'IMAGE_LINK_TOO_LARGE' });
    await expect(fetchImageFromLink('http://localhost/x', {})).rejects.toMatchObject({ code: 'IMAGE_LINK_INVALID' });
  });
});
