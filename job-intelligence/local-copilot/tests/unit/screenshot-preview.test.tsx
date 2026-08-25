import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ScreenshotPreview } from '../../src/renderer/features/session/screenshot-preview';

describe('ScreenshotPreview', () => {
  it('renders an accessible preview with crop, redact, confirm, and remove controls', () => {
    const html = renderToStaticMarkup(<ScreenshotPreview
      preview={{ id: 'shot-1', dataUrl: 'data:image/png;base64,AAAA', width: 100, height: 80 }}
      onConfirm={vi.fn()}
      onRemove={vi.fn()}
    />);

    expect(html).toContain('alt="Screenshot preview"');
    expect(html).toContain('aria-label="Crop left"');
    expect(html).toContain('aria-label="Redaction left"');
    expect(html).toContain('>Confirm screenshot<');
    expect(html).toContain('>Remove screenshot<');
  });
});
