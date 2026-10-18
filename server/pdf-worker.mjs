// Runs in a disposable, memory-bounded child. PDF bytes never become browser markup.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
process.once('message', async message => {
  let task;
  try {
    task = getDocument({ data: new Uint8Array(Buffer.from(message.data, 'base64')), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true, maxImageSize: 1, useWasm: false });
    const document = await task.promise;
    if (document.numPages > 20) throw new Error('PDF_PAGE_LIMIT');
    if (await document.getJSActions() || await document.getAttachments() || await document.getOpenAction()) throw new Error('PDF_ACTIVE_CONTENT');
    const pages = []; let characters = 0;
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      if (await page.getJSActions()) throw new Error('PDF_ACTIVE_CONTENT');
      const annotations = await page.getAnnotations();
      if (annotations.some(a => a.actions || a.jsActions || a.unsafeUrl || a.file || a.subtype === 'RichMedia')) throw new Error('PDF_ACTIVE_CONTENT');
      const text = (await page.getTextContent()).items.filter(x => typeof x.str === 'string').map(x => x.str + (x.hasEOL ? '\n' : ' ')).join('').replace(/ +\n/g, '\n').trim();
      characters += text.length;
      if (characters > 250000 || text.length > 100000) throw new Error('PDF_TEXT_LIMIT');
      pages.push({ number: n, text });
      page.cleanup();
    }
    if (pages.every(p => !p.text.trim())) throw new Error('PDF_SCANNED_UNSUPPORTED');
    process.send?.({ ok: true, pages });
  } catch (error) {
    const known = ['PDF_PAGE_LIMIT','PDF_ACTIVE_CONTENT','PDF_TEXT_LIMIT','PDF_SCANNED_UNSUPPORTED'];
    const code = error?.name === 'PasswordException' ? 'PDF_ENCRYPTED' : known.includes(error?.message) ? error.message : 'PDF_UNSUPPORTED';
    process.send?.({ ok: false, code });
  } finally { await task?.destroy(); process.disconnect?.() }
});
