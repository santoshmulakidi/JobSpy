import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ScreenshotPreview,
  createScreenshotObjectUrl,
} from '../../src/renderer/features/session/screenshot-preview';

describe('ScreenshotPreview', () => {
  it('renders an accessible preview with crop, redact, confirm, and remove controls', () => {
    const html = renderToStaticMarkup(<ScreenshotPreview
      preview={{ id: 'shot-1', mediaType: 'image/png', bytes: new Uint8Array([1]), width: 100, height: 80 }}
      onConfirm={vi.fn()}
      onRemove={vi.fn()}
    />);

    expect(html).toContain('alt="Screenshot preview"');
    expect(html).toContain('aria-label="Crop left"');
    expect(html).not.toContain('aria-label="Redaction left"');
    expect(html).toContain('>Add redaction<');
    expect(html).toContain('>Confirm screenshot<');
    expect(html).toContain('>Remove screenshot<');
  });

  it('zeros preview bytes and revokes its object URL', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const urls = { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() };
    const preview = createScreenshotObjectUrl(bytes, 'image/png', urls);

    expect(preview.src).toBe('blob:preview');
    expect([...bytes]).toEqual([0, 0, 0]);
    preview.dispose();
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});
