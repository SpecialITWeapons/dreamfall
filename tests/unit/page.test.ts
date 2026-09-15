// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGate } from '../../src/page/Gate';
import { createHud } from '../../src/page/Hud';
import { createVeil } from '../../src/page/Veil';

// Resolve the page path through node:url and node:path, not the global URL:
// under jsdom the global URL is jsdom's own class, which node:fs rejects.
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>'));

beforeEach(() => {
  document.body.innerHTML = body;
});

describe('veil', () => {
  it('lifts by class, so the CSS fade can run', () => {
    createVeil(document).lift();
    expect(document.getElementById('loading')!.classList.contains('gone')).toBe(true);
  });
});

describe('gate', () => {
  it('ignores clicks until enabled, then begins once and leaves the tab order', () => {
    const gate = createGate(document);
    const begun = vi.fn();
    gate.onBegin(begun);
    const button = document.getElementById('beginBtn') as HTMLButtonElement;
    button.click();
    expect(begun).not.toHaveBeenCalled();
    gate.enable();
    expect(button.disabled).toBe(false);
    expect(document.getElementById('begin')!.classList.contains('ready')).toBe(true);
    button.click();
    button.click();
    expect(begun).toHaveBeenCalledTimes(1);
    expect(gate.begun).toBe(true);
    const panel = document.getElementById('begin')!;
    expect(panel.classList.contains('gone')).toBe(true);
    expect(panel.hasAttribute('inert')).toBe(true);
  });
});

describe('hud', () => {
  it('stays inert until enabled and reports backend, share link and pause state', () => {
    const hud = createHud(document);
    const onPause = vi.fn();
    hud.onPause(onPause);
    hud.setBackend('webgpu');
    hud.setShare('https://x.test/?seed=42');
    expect(document.getElementById('backendLabel')!.textContent).toBe('webgpu');
    expect((document.getElementById('shareLink') as HTMLAnchorElement).getAttribute('href')).toBe(
      'https://x.test/?seed=42',
    );
    const pause = document.getElementById('pauseBtn') as HTMLButtonElement;
    expect(document.getElementById('hud')!.hasAttribute('inert')).toBe(true);
    expect(pause.disabled).toBe(true);
    hud.enable();
    expect(document.getElementById('hud')!.hasAttribute('inert')).toBe(false);
    expect(pause.disabled).toBe(false);
    pause.click();
    expect(onPause).toHaveBeenCalledTimes(1);
    hud.setPaused(true);
    expect(pause.textContent).toBe('resume');
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    expect(pause.title).toBe('Resume flight');
    hud.setPaused(false);
    expect(pause.textContent).toBe('pause');
    expect(pause.getAttribute('aria-pressed')).toBe('false');
  });
});
