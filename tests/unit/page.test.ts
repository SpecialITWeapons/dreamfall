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

describe('hud controls', () => {
  it('reports sound, volume and view, and disables sound when unavailable', () => {
    const hud = createHud(document);
    const onMute = vi.fn(),
      onVolume = vi.fn(),
      onView = vi.fn();
    hud.onMute(onMute);
    hud.onVolume(onVolume);
    hud.onView(onView);
    const mute = document.getElementById('muteBtn') as HTMLButtonElement,
      volume = document.getElementById('volume') as HTMLInputElement,
      view = document.getElementById('viewBtn') as HTMLButtonElement;
    hud.setMuted(false);
    expect(mute.textContent).toBe('sound on');
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    hud.setMuted(true);
    expect(mute.textContent).toBe('sound off');
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(mute.getAttribute('aria-label')).toBe('Unmute sound');
    hud.setMuted(false, false);
    expect(mute.textContent).toBe('sound unavailable');
    expect(mute.disabled).toBe(true);
    hud.setMuted(true, true);
    expect(mute.disabled).toBe(false);
    mute.click();
    expect(onMute).toHaveBeenCalledTimes(1);
    hud.setVolume(0.25);
    expect(volume.value).toBe('0.25');
    volume.value = '0.7';
    volume.dispatchEvent(new Event('input'));
    expect(onVolume).toHaveBeenLastCalledWith(0.7);
    hud.setView('tpp');
    expect(view.textContent).toBe('view: behind');
    expect(view.getAttribute('aria-pressed')).toBe('false');
    hud.setView('fpp');
    expect(view.textContent).toBe('view: eyes');
    expect(view.getAttribute('aria-pressed')).toBe('true');
    view.click();
    expect(onView).toHaveBeenCalledTimes(1);
  });
  it('says when the flight is by hand and offers it back', () => {
    const hud = createHud(document);
    const onAutopilot = vi.fn();
    hud.onAutopilot(onAutopilot);
    const button = document.getElementById('autopilotBtn') as HTMLButtonElement,
      note = document.getElementById('manual')!;
    // the notice starts hidden in the markup, for a flight that starts on the autopilot
    expect(note.hasAttribute('hidden')).toBe(true);
    hud.setAutopilot(false);
    expect(button.textContent).toBe('resume autopilot');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(note.hasAttribute('hidden')).toBe(false);
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toContain('autopilot off');
    hud.setAutopilot(true);
    expect(button.textContent).toBe('autopilot on');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(note.hasAttribute('hidden')).toBe(true);
    button.click();
    expect(onAutopilot).toHaveBeenCalledTimes(1);
  });
  it('dims after a while without the pointer and wakes on hover, never while inert', () => {
    vi.useFakeTimers();
    try {
      const hud = createHud(document, { idleMs: 100 });
      const el = document.getElementById('hud')!;
      el.dispatchEvent(new Event('pointerenter'));
      vi.advanceTimersByTime(200);
      expect(el.classList.contains('is-idle')).toBe(false);
      hud.enable();
      vi.advanceTimersByTime(200);
      expect(el.classList.contains('is-idle')).toBe(true);
      el.dispatchEvent(new Event('pointerenter'));
      expect(el.classList.contains('is-idle')).toBe(false);
      expect(el.classList.contains('is-awake')).toBe(true);
      el.dispatchEvent(new Event('pointerleave'));
      vi.advanceTimersByTime(200);
      expect(el.classList.contains('is-idle')).toBe(true);
      hud.wake();
      expect(el.classList.contains('is-awake')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
