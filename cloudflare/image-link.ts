import { AuthorityError } from '../server/errors.js';
import { sniffImageType, type CanvasImageType } from '../src/tabletop/shared/canvas-images.js';

/**
 * F092: fetch a picture a member points at, so it can be pinned like an uploaded one.
 *
 * The link may be the picture itself or a page (a publisher's book page): a page gives its
 * `og:image` / `twitter:image`. The server fetches on the member's behalf without their cookies,
 * only over plain http(s) to public host names, following at most a few redirects that are each
 * checked again. Bytes are typed by their magic number, never by the declared Content-Type. Nothing
 * is stored here: the browser resizes the picture and stores it through the ordinary upload route.
 */

export const MAX_LINK_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_LINK_PAGE_BYTES = 512 * 1024;
export const MAX_LINK_REDIRECTS = 3;
export const LINK_FETCH_TIMEOUT_MS = 10_000;
const MAX_LINK_CHARS = 2_000;

export interface LinkedImage {
  bytes: Uint8Array;
  mime: CanvasImageType;
  /** The address the picture finally came from, for the caption's attribution. */
  imageUrl: string;
}

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.test', '.invalid', '.example', '.lan', '.home', '.corp'];

/** A public http(s) address, or null. IP literals, single-label and private-looking names are refused. */
export function publicLinkUrl(raw: string, base?: URL): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LINK_CHARS) return null;
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (!host.includes('.') || host === 'localhost') return null;
  // IPv6 literals arrive bracketed; IPv4 literals are all digits and dots (also refuses decimal forms like 2130706433.x).
  if (host.startsWith('[') || /^[\d.]+$/u.test(host) || /^0x/iu.test(host)) return null;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return null;
  url.hash = '';
  return url;
}

/** The first `og:image`-style picture a page declares, resolved against the page address. */
export function pageImageUrl(html: string, page: URL): URL | null {
  const metas = html.match(/<meta\b[^>]*>/giu) ?? [];
  const wanted = ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'];
  const found = new Map<string, string>();
  for (const tag of metas) {
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1];
    if (key && content && wanted.includes(key) && !found.has(key)) found.set(key, decodeEntities(content.trim()));
  }
  for (const key of wanted) {
    const value = found.get(key);
    const url = value ? publicLinkUrl(value, page) : null;
    if (url) return url;
  }
  const link = /<link\b[^>]*\brel\s*=\s*["']image_src["'][^>]*>/iu.exec(html)?.[0];
  const href = link ? /\bhref\s*=\s*["']([^"']+)["']/iu.exec(link)?.[1] : undefined;
  return href ? publicLinkUrl(decodeEntities(href.trim()), page) : null;
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/gu, '&').replace(/&#38;/gu, '&').replace(/&quot;/gu, '"').replace(/&#39;/gu, "'");
}

async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    void response.body?.cancel().catch(() => undefined);
    throw new AuthorityError('IMAGE_LINK_TOO_LARGE', 'That picture is too large to add (8 MiB at most).', 413);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel().catch(() => undefined);
      throw new AuthorityError('IMAGE_LINK_TOO_LARGE', 'That picture is too large to add (8 MiB at most).', 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readPrefix(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const bytes = new Uint8Array(max);
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.byteLength, max - size);
    bytes.set(value.subarray(0, take), size);
    size += take;
  }
  void reader.cancel().catch(() => undefined);
  return bytes.subarray(0, size);
}

/** One GET that follows redirects by hand, re-checking every hop. */
async function fetchPublic(start: URL, fetchImpl: typeof fetch, signal: AbortSignal): Promise<{ response: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_LINK_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,text/html;q=0.8,*/*;q=0.1', 'user-agent': 'TabletopImageLink/1 (+link preview)' },
      });
    } catch {
      throw new AuthorityError(signal.aborted ? 'IMAGE_LINK_TIMEOUT' : 'IMAGE_LINK_UNREACHABLE', signal.aborted ? 'That link took too long to answer.' : 'That link could not be reached.', 422);
    }
    if (response.status >= 300 && response.status < 400) {
      const next = publicLinkUrl(response.headers.get('location') ?? '', url);
      void response.body?.cancel().catch(() => undefined);
      if (!next) throw new AuthorityError('IMAGE_LINK_INVALID', 'That link redirects somewhere a picture cannot be fetched from.', 422);
      url = next;
      continue;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new AuthorityError('IMAGE_LINK_UNREACHABLE', `That link answered ${response.status}.`, 422);
    }
    return { response, url };
  }
  throw new AuthorityError('IMAGE_LINK_INVALID', 'That link redirects too many times.', 422);
}

export async function fetchImageFromLink(raw: string, options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<LinkedImage> {
  const start = publicLinkUrl(typeof raw === 'string' ? raw.trim() : '');
  if (!start) throw new AuthorityError('IMAGE_LINK_INVALID', 'Use a public http(s) link to a picture or a web page.', 422);
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LINK_FETCH_TIMEOUT_MS);
  try {
    let { response, url } = await fetchPublic(start, fetchImpl, controller.signal);
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('text/html') || type.includes('application/xhtml')) {
      // A long page still declares og:image in its head, so read only the start of it.
      const page = await readPrefix(response, MAX_LINK_PAGE_BYTES);
      const image = pageImageUrl(new TextDecoder().decode(page), url);
      if (!image) throw new AuthorityError('IMAGE_LINK_NO_IMAGE', 'That page does not name a picture to use. Open the picture itself and copy its address instead.', 422);
      ({ response, url } = await fetchPublic(image, fetchImpl, controller.signal));
    }
    const bytes = await readCapped(response, MAX_LINK_IMAGE_BYTES);
    const mime = sniffImageType(bytes);
    if (!mime) throw new AuthorityError('UNSUPPORTED_IMAGE', 'That link is not a JPEG, PNG or WebP picture.', 415);
    return { bytes, mime, imageUrl: url.toString() };
  } finally {
    clearTimeout(timer);
  }
}
