import * as React from 'react';
import { createRoot } from 'react-dom/client';
import * as JsxRuntime from 'react/jsx-runtime';
import { startToolSandbox } from './bootstrap';

/**
 * F080: the entry of the sandbox runtime bundle.
 *
 * The bundle is built ahead of time (React, ReactDOM and the JSX runtime inlined) and served as
 * a static script the host inlines into the frame document. That is what lets the frame run with
 * `default-src 'none'`: it never fetches anything, so a generated package cannot use the runtime
 * loader as a network path.
 */

interface SandboxScope {
  __TOOL_SANDBOX__?: unknown;
  __TOOL_SANDBOX_START__?: () => void;
}

const scope = globalThis as unknown as SandboxScope;

scope.__TOOL_SANDBOX__ = { React, JsxRuntime, createRoot };

scope.__TOOL_SANDBOX_START__ = () => {
  try {
    startToolSandbox();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const target = document.getElementById('root');
    if (target) target.textContent = `เครื่องมือนี้เริ่มทำงานไม่ได้: ${message}`;
    window.parent.postMessage({ protocol: 1, kind: 'log', nonce: '0'.repeat(32), level: 'error', message }, '*');
  }
};
