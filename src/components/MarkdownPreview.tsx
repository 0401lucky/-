'use client';

import type { ReactNode } from 'react';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
  emptyText?: string;
}

const BLOCK_START_RE = /^(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+|`{3,}|-{3,}\s*$)/;

function safeHref(value: string): string {
  const href = value.trim();
  if (/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href)) return href;
  return '#';
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?[\s:-]+\|[\s|:-]*$/.test(trimmed) && /-{3,}/.test(trimmed);
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /(\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-inline-${tokenIndex}`;
    if (match[2] && match[3]) {
      const href = safeHref(match[3]);
      nodes.push(
        <a
          key={key}
          href={href}
          target={href.startsWith('http') ? '_blank' : undefined}
          rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
          className="font-semibold text-cyan-700 underline decoration-cyan-300 underline-offset-2 hover:text-cyan-900"
        >
          {renderInline(match[2], `${key}-link`)}
        </a>,
      );
    } else if (match[4]) {
      nodes.push(
        <code key={key} className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.92em] text-rose-600">
          {match[4]}
        </code>,
      );
    } else if (match[5] || match[6]) {
      nodes.push(
        <strong key={key} className="font-bold text-stone-900">
          {renderInline(match[5] || match[6] || '', `${key}-strong`)}
        </strong>,
      );
    } else if (match[7] || match[8]) {
      nodes.push(
        <em key={key} className="italic text-stone-700">
          {renderInline(match[7] || match[8] || '', `${key}-em`)}
        </em>,
      );
    }

    tokenIndex += 1;
    lastIndex = tokenRe.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderInlineWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  return text.split('\n').flatMap((line, index) => {
    const nodes = renderInline(line, `${keyPrefix}-${index}`);
    if (index === 0) return nodes;
    return [<br key={`${keyPrefix}-br-${index}`} />, ...nodes];
  });
}

function renderHeading(level: number, key: string, children: ReactNode) {
  const sizeClass = level === 1 ? 'text-xl' : level === 2 ? 'text-lg' : 'text-base';
  const className = `${sizeClass} font-bold leading-snug text-stone-950`;

  if (level === 1) return <h1 key={key} className={className}>{children}</h1>;
  if (level === 2) return <h2 key={key} className={className}>{children}</h2>;
  if (level === 3) return <h3 key={key} className={className}>{children}</h3>;
  return <h4 key={key} className={className}>{children}</h4>;
}

function renderBlocks(lines: string[], keyPrefix: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const key = `${keyPrefix}-block-${index}`;

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <div key={key} className="overflow-hidden rounded-lg border border-stone-800 bg-stone-950">
          {language && (
            <div className="border-b border-stone-800 px-3 py-1.5 text-xs font-semibold text-stone-400">
              {language}
            </div>
          )}
          <pre className="overflow-x-auto p-3 text-xs leading-6 text-stone-100">
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 4);
      blocks.push(renderHeading(level, key, renderInline(heading[2], `${key}-heading`)));
      index += 1;
      continue;
    }

    if (/^-{3,}\s*$/.test(trimmed)) {
      blocks.push(<hr key={key} className="border-stone-200" />);
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={key} className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-stone-50 text-stone-700">
              <tr>
                {headers.map((header, cellIndex) => (
                  <th key={`${key}-th-${cellIndex}`} className="border-b border-stone-200 px-3 py-2 font-bold">
                    {renderInline(header, `${key}-th-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${key}-tr-${rowIndex}`} className="border-t border-stone-100">
                  {headers.map((_, cellIndex) => (
                    <td key={`${key}-td-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top text-stone-700">
                      {renderInline(row[cellIndex] ?? '', `${key}-td-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push(
        <blockquote key={key} className="border-l-4 border-cyan-300 bg-cyan-50/60 py-2 pl-4 pr-3 text-stone-700">
          {renderBlocks(quoteLines, `${key}-quote`)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ul key={key} className="list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`${key}-li-${itemIndex}`}>{renderInline(item, `${key}-li-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      blocks.push(
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`${key}-li-${itemIndex}`}>{renderInline(item, `${key}-li-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !BLOCK_START_RE.test(lines[index]) &&
      !(lines[index].includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]))
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(
      <p key={key} className="text-sm leading-7 text-stone-700">
        {renderInlineWithBreaks(paragraphLines.join('\n'), `${key}-p`)}
      </p>,
    );
  }

  return blocks;
}

export default function MarkdownPreview({
  content,
  className = '',
  emptyText = '暂无内容',
}: MarkdownPreviewProps) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!normalized) {
    return (
      <div className={`rounded-lg border border-dashed border-stone-200 bg-stone-50 p-4 text-sm text-stone-400 ${className}`}>
        {emptyText}
      </div>
    );
  }

  return (
    <div className={`markdown-preview space-y-3 whitespace-normal break-words ${className}`}>
      {renderBlocks(normalized.split('\n'), 'markdown')}
    </div>
  );
}
