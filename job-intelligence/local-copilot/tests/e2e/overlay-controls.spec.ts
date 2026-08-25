import { describe, expect, it, vi } from 'vitest';

import {
  captureWithOverlayHidden,
  containOverlayBounds,
  createOverlayControls,
  installOverlayContainment,
} from '../../src/main/windows/overlay-window';

function fakeWindow() {
  return {
    setOpacity: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setContentProtection: vi.fn(),
    setFocusable: vi.fn(),
    hide: vi.fn(),
    showInactive: vi.fn(),
    isVisible: vi.fn(() => true),
    isDestroyed: vi.fn(() => false),
  };
}

describe('overlay native controls', () => {
  it('sets opacity, always-on-top, and instant hide natively', () => {
    const window = fakeWindow();
    const controls = createOverlayControls(window as never);

    controls.setOpacity(0.6);
    controls.setAlwaysOnTop(false);
    controls.hide();

    expect(window.setOpacity).toHaveBeenCalledWith(0.6);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false, 'floating');
    expect(window.setFocusable).toHaveBeenCalledWith(false);
    expect(window.hide).toHaveBeenCalledOnce();
  });

  it('classifies capture protection as best effort rather than guaranteed', () => {
    const window = fakeWindow();
    const controls = createOverlayControls(window as never);

    expect(controls.setCaptureProtection(true)).toEqual({ status: 'best-effort' });
    expect(window.setContentProtection).toHaveBeenCalledWith(true);

    window.setContentProtection.mockImplementationOnce(() => { throw new Error('unsupported'); });
    expect(controls.setCaptureProtection(true)).toEqual({ status: 'unsupported' });
  });

  it('contains bounds inside the matching monitor work area', () => {
    expect(containOverlayBounds(
      { x: 1700, y: -200, width: 900, height: 1200 },
      { x: 1920, y: 0, width: 1920, height: 1080 },
    )).toEqual({ x: 1920, y: 0, width: 900, height: 1080 });
  });

  it('hides through compositor settlement and restores without taking focus', async () => {
    vi.useFakeTimers();
    const window = fakeWindow();
    const capture = vi.fn(async () => 'pixels');

    const result = captureWithOverlayHidden(window as never, capture, 50);
    expect(window.hide).toHaveBeenCalledOnce();
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBe('pixels');
    expect(window.showInactive).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('serializes overlapping capture lifecycles', async () => {
    vi.useFakeTimers();
    const window = fakeWindow();
    let finishFirst!: () => void;
    const firstCapture = vi.fn(() => new Promise<string>((resolve) => { finishFirst = () => resolve('first'); }));
    const secondCapture = vi.fn(async () => 'second');

    const first = captureWithOverlayHidden(window as never, firstCapture, 50);
    const second = captureWithOverlayHidden(window as never, secondCapture, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect(firstCapture).toHaveBeenCalledOnce();
    expect(secondCapture).not.toHaveBeenCalled();

    finishFirst();
    await first;
    await vi.advanceTimersByTimeAsync(50);
    await expect(second).resolves.toBe('second');
    expect(secondCapture).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('recontains on display changes and disposes every listener', () => {
    const listeners = new Map<string, () => void>();
    const display = {
      on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
      off: vi.fn(),
      getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 100, height: 100 } })),
    };
    const window = {
      isDestroyed: () => false,
      getBounds: vi.fn(() => ({ x: 90, y: 90, width: 40, height: 40 })),
      setBounds: vi.fn(),
      on: vi.fn((event: string, listener: () => void) => listeners.set(`window:${event}`, listener)),
      off: vi.fn(),
    };

    const dispose = installOverlayContainment(window as never, display as never);
    listeners.get('display-metrics-changed')?.();
    expect(window.setBounds).toHaveBeenCalledWith({ x: 60, y: 60, width: 40, height: 40 });

    dispose();
    expect(display.off).toHaveBeenCalledTimes(3);
    expect(window.off).toHaveBeenCalledTimes(2);
  });
});
