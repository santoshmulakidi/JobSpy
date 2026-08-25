import { createElement, type ReactElement, type ReactNode } from 'react';

export interface StreamingMarkdownProps {
  readonly content: string;
}

export function StreamingMarkdown({ content }: StreamingMarkdownProps): ReactElement {
  return <div className="streaming-markdown">{parseBlocks(content)}</div>;
}

function parseBlocks(content: string): ReactNode[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    if (!line) {
      index += 1;
      continue;
    }

    const fence = /^```([\w-]*)\s*$/.exec(line);
    if (fence) {
      let end = index + 1;
      while (end < lines.length && !/^```\s*$/.test(lines[end] ?? '')) end += 1;
      const streaming = end === lines.length;
      const language = fence[1]?.toLowerCase() ?? '';
      const code = lines.slice(index + 1, end).join('\n');
      blocks.push(
        <pre key={`block-${index}`} data-streaming={streaming || undefined}>
          <code className={language ? `language-${language}` : undefined}>{highlight(code, language)}</code>
        </pre>,
      );
      index = streaming ? lines.length : end + 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(createElement(`h${heading[1]!.length}`, { key: `block-${index}` }, parseInline(heading[2]!)));
      index += 1;
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(line);
    if (unordered) {
      const start = index;
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^[-*]\s+(.+)$/.exec(lines[index] ?? '');
        if (!item) break;
        items.push(<li key={`item-${index}`}>{parseInline(item[1]!)}</li>);
        index += 1;
      }
      blocks.push(<ul key={`block-${start}`}>{items}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    const start = index;
    while (index < lines.length && lines[index] && !isBlockStart(lines[index]!, index > start)) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    blocks.push(<p key={`block-${start}`}>{parseInline(paragraph.join('\n'))}</p>);
  }

  return blocks;
}

function isBlockStart(line: string, afterFirstLine: boolean): boolean {
  return afterFirstLine && (/^```/.test(line) || /^#{1,6}\s+/.test(line) || /^[-*]\s+/.test(line));
}

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+(?:\([^)]*\))?\))/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const value = match[0];
    if (value.startsWith('`')) {
      nodes.push(<code key={index}>{value.slice(1, -1)}</code>);
    } else if (value.startsWith('**')) {
      nodes.push(<strong key={index}>{value.slice(2, -2)}</strong>);
    } else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(value)!;
      const href = safeHref(link[2]!);
      nodes.push(href ? <a key={index} href={href}>{link[1]}</a> : link[1]);
    }
    cursor = index + value.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function safeHref(value: string): string | undefined {
  try {
    const protocol = new URL(value).protocol.toLowerCase();
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:' ? value : undefined;
  } catch {
    return undefined;
  }
}

function highlight(code: string, language: string): ReactNode {
  if (!['js', 'javascript', 'ts', 'typescript'].includes(language)) return code;
  const keywords = /\b(const|let|var|function|return|if|else|for|while|async|await|class|new|import|export|from)\b/g;
  const keywordSet = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'class', 'new', 'import', 'export', 'from']);
  return code.split(keywords).map((part, index) => (
    keywordSet.has(part) ? <span className="token keyword" key={index}>{part}</span> : part
  ));
}
