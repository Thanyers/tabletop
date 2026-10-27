import type { CompiledToolPackage } from '../../runtime/tools/compile';
import type { ToolHostMessage } from '../../shared/tool-protocol';
import { TOOL_SANDBOX_BOOT_ELEMENT_ID } from './frame-message';

/**
 * F080: the document a tool instance runs in.
 *
 * Everything is inline and the CSP is closed, so the frame has no network, no storage and no
 * same-origin access to the host. The `sandbox` attribute (set by the host, without
 * `allow-same-origin`) is what makes the origin opaque; this document only has to avoid
 * reopening a path that the attribute already closed.
 */

/**
 * The frame CSP.
 *
 * `'unsafe-eval'` is required here and only here: a package's modules are compiled text that has
 * to be instantiated as functions inside the frame. That is not a weakening of the host boundary,
 * because this document has an opaque origin (no `allow-same-origin`), no cookies, no storage and
 * no network — `unsafe-eval` lets the sandbox run the code it was handed, and nothing else.
 *
 * `frame-ancestors` is omitted deliberately: a meta-delivered CSP ignores it (the browser warns).
 */
export const TOOL_SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Serialise a value for an inline `<script type="application/json">` block. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c').replace(/\u2028|\u2029/gu, character => (character === '\u2028' ? '\\u2028' : '\\u2029'));
}

export interface ToolSandboxDocumentInput {
  /** The bundled runtime text; must not be able to close the inline script tag. */
  runtimeScript: string;
  compiled: Pick<CompiledToolPackage, 'modules' | 'uiEntry'>;
  init: Extract<ToolHostMessage, { kind: 'init' }>;
}

export class ToolSandboxDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolSandboxDocumentError';
  }
}

export function buildToolSandboxDocument(input: ToolSandboxDocumentInput): string {
  if (/<\/script/iu.test(input.runtimeScript)) {
    throw new ToolSandboxDocumentError('The sandbox runtime contains a closing script tag and would break out of its document.');
  }
  const lang = input.init.presentation.locale === 'th' ? 'th' : 'en';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${TOOL_SANDBOX_CSP}">
<title>${escapeHtml(input.init.packageId)}</title>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="${TOOL_SANDBOX_BOOT_ELEMENT_ID}">${embedJson({ modules: input.compiled.modules, uiEntry: input.compiled.uiEntry, init: input.init })}</script>
<script>${input.runtimeScript}</script>
<script>window.__TOOL_SANDBOX_START__ && window.__TOOL_SANDBOX_START__();</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => (
    character === '&' ? '&amp;'
      : character === '<' ? '&lt;'
        : character === '>' ? '&gt;'
          : character === '"' ? '&quot;'
            : '&#39;'
  ));
}
