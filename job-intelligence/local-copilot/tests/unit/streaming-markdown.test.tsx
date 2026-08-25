import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StreamingMarkdown } from '../../src/renderer/features/session/streaming-markdown';

function render(content: string): string {
  return renderToStaticMarkup(<StreamingMarkdown content={content} />);
}

describe('StreamingMarkdown', () => {
  it('renders raw HTML as inert text', () => {
    const html = render('<script>alert(1)</script>\n<img src=x onerror=alert(2)>');

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
  ])('renders a dangerous %s link without an href', (url) => {
    const html = render(`[open](${url})`);

    expect(html).toContain('open');
    expect(html).not.toContain('href=');
  });

  it('keeps allowlisted absolute links clickable', () => {
    expect(render('[docs](https://example.com/docs)')).toContain('href="https://example.com/docs"');
  });

  it('renders an incomplete fence as streaming code without executing it', () => {
    const html = render('Before\n\n```ts\nconst value = "<img onerror=alert(1)>";');

    expect(html).toContain('<pre data-streaming="true">');
    expect(html).toContain('&lt;img onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });

  it('remains safe for every partial prefix of an adversarial stream', () => {
    const stream = '<script>alert(1)</script>\n\n[x](javascript:alert(2))\n\n```js\nreturn data';

    for (let length = 0; length <= stream.length; length += 1) {
      const html = render(stream.slice(0, length));
      expect(html).not.toContain('<script>');
      expect(html).not.toMatch(/href="(?:javascript|data):/i);
    }
  });

  it('uses local keyword spans for fenced JavaScript without remote assets', () => {
    const html = render('```js\nconst answer = () => { return 42; };\n```');

    expect(html).toContain('class="token keyword">const</span>');
    expect(html).toContain('class="token keyword">return</span>');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<script');
  });
});
