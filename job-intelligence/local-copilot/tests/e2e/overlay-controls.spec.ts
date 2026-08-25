import { describe, expect, it, vi } from 'vitest';

import {
  captureWithOverlayHidden,
  containOverlayBounds,
  createOverlayControls,
} from '../../src/main/windows/overlay-window';

function fakeWindow() {
  return {
    setOpacity: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
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
  it('sets opacity, click-through, always-on-top, and instant hide natively', () => {
    const window = fakeWindow();
    const controls = createOverlayControls(window as never);

    controls.setOpacity(0.6);
    controls.setClickThrough(true);
    controls.setAlwaysOnTop(false);
    controls.hide();

    expect(window.setOpacity).toHaveBeenCalledWith(0.6);
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
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
});
