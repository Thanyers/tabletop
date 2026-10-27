import * as React from 'react';
import { createRoot } from 'react-dom/client';
import * as JsxRuntime from 'react/jsx-runtime';
import { parseToolHostMessage, type ToolHostMessage, type ToolPortSnapshot } from '../../shared/tool-protocol';
import { TOOL_SANDBOX_BOOT_ELEMENT_ID } from './frame-message';
import { createToolSdk, type ToolSdk, type ToolSdkControl } from './sdk';

/**
 * F080: the frame-side runtime.
 *
 * This file runs inside the sandboxed iframe and nowhere else. Package modules are CommonJS
 * text produced by the compile step; they are instantiated here with `Function`, which is safe
 * only because this realm is the sandbox: it has an opaque origin, no cookies, no storage, no
 * network (CSP `default-src 'none'`) and no reference to host state. Never import this module
 * from host code.
 */

export interface ToolSandboxBoot {
  modules: Record<string, string>;
  uiEntry: string;
  init: ToolHostMessage;
}

interface SandboxGlobals {
  React: typeof React;
  JsxRuntime: typeof JsxRuntime;
  createRoot: typeof createRoot;
}

function sandboxGlobals(): SandboxGlobals {
  const scope = globalThis as unknown as { __TOOL_SANDBOX__?: SandboxGlobals };
  if (!scope.__TOOL_SANDBOX__) throw new Error('The tool sandbox runtime is missing.');
  return scope.__TOOL_SANDBOX__;
}

/** Join `fromPath` with a relative specifier, refusing to leave the package. */
function resolveRelative(fromPath: string, specifier: string, has: (path: string) => boolean): string | undefined {
  const base = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const stack: string[] = [];
  for (const part of (base ? `${base}/${specifier}` : specifier).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return undefined;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join('/');
  for (const candidate of [joined, `${joined}.ts`, `${joined}.tsx`, `${joined}.js`]) {
    if (has(candidate)) return candidate;
  }
  return undefined;
}

function readBoot(): ToolSandboxBoot {
  const element = document.getElementById(TOOL_SANDBOX_BOOT_ELEMENT_ID);
  if (!element || !element.textContent) throw new Error('The tool sandbox has no boot payload.');
  return JSON.parse(element.textContent) as ToolSandboxBoot;
}

function createRegistry(boot: ToolSandboxBoot, sdk: ToolSdk, globals: SandboxGlobals) {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const has = (path: string): boolean => Object.hasOwn(boot.modules, path);
  const provided: Record<string, unknown> = {
    react: globals.React,
    'react/jsx-runtime': globals.JsxRuntime,
    'react-dom/client': { createRoot: globals.createRoot },
    '@tabletop/tool-sdk': { sdk },
  };
  const load = (path: string): Record<string, unknown> => {
    const cached = cache.get(path);
    if (cached) return cached.exports;
    const source = boot.modules[path];
    if (source === undefined) throw new Error(`The package has no module "${path}".`);
    const module = { exports: {} as Record<string, unknown> };
    cache.set(path, module);
    const localRequire = (specifier: string): unknown => {
      if (!specifier.startsWith('.')) {
        if (!Object.hasOwn(provided, specifier)) throw new Error(`"${specifier}" is not provided by the sandbox.`);
        return provided[specifier];
      }
      const target = resolveRelative(path, specifier, has);
      if (!target) throw new Error(`"${specifier}" does not resolve inside the package.`);
      return load(target);
    };
    const factory = new Function('module', 'exports', 'require', `${source}\n//# sourceURL=${path}`) as (
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
      require: (specifier: string) => unknown,
    ) => void;
    factory(module, module.exports, localRequire);
    return module.exports;
  };
  return { load, has };
}

function pickComponent(exports: Record<string, unknown>): React.ComponentType<Record<string, unknown>> {
  const candidate = exports.default ?? exports.Tool ?? Object.values(exports).find(value => typeof value === 'function');
  if (typeof candidate !== 'function') throw new Error('The UI entry exports no component.');
  return candidate as React.ComponentType<Record<string, unknown>>;
}

function installStyles(): void {
  const style = document.createElement('style');
  style.textContent = 'html,body{margin:0;padding:0;background:transparent;font:inherit;color:inherit}#root{display:block}*{box-sizing:border-box}@media (prefers-reduced-motion: reduce){*{animation-duration:0.01ms !important;transition-duration:0.01ms !important}}';
  document.head.appendChild(style);
}

/** Mount the package and start talking to the host. Called once per frame. */
export function startToolSandbox(): void {
  const boot = readBoot();
  const parsedInit = parseToolHostMessage(boot.init);
  if (!parsedInit.ok || parsedInit.message.kind !== 'init') throw new Error('The tool sandbox received an invalid init message.');
  const init = parsedInit.message;
  installStyles();
  const globals = sandboxGlobals();

  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('The tool sandbox has no root element.');
  const root = globals.createRoot(rootElement);
  let currentPorts: ToolPortSnapshot[] = init.ports;

  const control: ToolSdkControl = createToolSdk({
    nonce: init.nonce,
    post: message => {
      window.parent.postMessage(message, '*');
    },
    onRender: ports => {
      currentPorts = ports;
      render();
    },
  });

  let component: React.ComponentType<Record<string, unknown>> | undefined;
  const render = (): void => {
    try {
      if (!component) return;
      root.render(React.createElement(component, { sdk: control.sdk, ports: currentPorts, presentation: init.presentation }));
    } catch (error) {
      reportError(error);
    }
  };

  const reportError = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    control.sdk.log('error', message);
    root.render(React.createElement('pre', { role: 'alert', style: { color: '#b3261e', whiteSpace: 'pre-wrap' } }, `เครื่องมือนี้แสดงผลไม่ได้: ${message}`));
  };

  window.addEventListener('error', event => reportError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => reportError(event.reason));
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const message = parseToolHostMessage(event.data);
    if (!message.ok) return;
    if (message.message.kind === 'dispose') {
      control.abandonAll('disposed');
      root.unmount();
      return;
    }
    control.receive(message.message);
  });

  try {
    const registry = createRegistry(boot, control.sdk, globals);
    component = pickComponent(registry.load(boot.uiEntry));
    render();
  } catch (error) {
    reportError(error);
    return;
  }

  // Report the content height so the host can size the frame without guessing.
  const measure = (): void => {
    control.sdk.resize(Math.ceil(document.documentElement.getBoundingClientRect().height));
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(document.body);
  measure();
  control.sdk.log('info', 'ready');
  window.parent.postMessage({ protocol: 1, kind: 'ready', nonce: init.nonce }, '*');
}

declare global {
  // The bootstrap is invoked by an inline script the host writes after the runtime bundle.
  var __TOOL_SANDBOX_START__: (() => void) | undefined;
}
