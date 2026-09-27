import React from 'react';
import { ExternalLink, FileText, Download } from 'lucide-react';

interface MarkdownMessageProps {
  content: string;
  suffix?: React.ReactNode;
  onMentionClick?: (mention: string) => void;
  onChannelClick?: (channelName: string) => void;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ 
  content, 
  suffix,
  onMentionClick,
  onChannelClick
}) => {
  // Check for CloudTether tag: [CloudTether:google|Quantum Telemetry.pdf|https://...|1.4 MB]
  const cloudTetherRegex = /\[CloudTether:([a-z]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/g;
  const cloudMatches = Array.from(content.matchAll(cloudTetherRegex));

  // Check for Attachment tag: [Attachment: filename.png (120 KB)|url] or [Attachment: filename.png (120 KB)]
  const attachmentRegex = /\[Attachment:\s*([^|\]]+)(?:\|([^\]]+))?\]/g;
  const attachmentMatches = Array.from(content.matchAll(attachmentRegex));

  // Strip embed tags from primary text flow to render clean markdown, then render cards below
  let cleanedContent = content
    .replace(cloudTetherRegex, '')
    .replace(attachmentRegex, '')
    .trim();

  const hasCards = cloudMatches.length > 0 || attachmentMatches.length > 0;

  return (
    <div className={hasCards ? "space-y-2" : "inline"}>
      {cleanedContent && renderContentBody(cleanedContent, suffix, { onMentionClick, onChannelClick })}
      {!cleanedContent && suffix}

      {/* Render Cloud Drive Tethers */}
      {cloudMatches.map((match, idx) => {
        const [, provider, title, url, size] = match;
        const meta = {
          google: { name: 'Google Drive', color: '#4285F4', icon: '📁' },
          onedrive: { name: 'OneDrive', color: '#0078D4', icon: '☁️' },
          dropbox: { name: 'Dropbox', color: '#0061FF', icon: '📦' },
        }[provider] || { name: 'Cloud Drive', color: '#00f0ff', icon: '☁️' };

        return (
          <div
            key={`cloud-${idx}`}
            className="my-2 max-w-md bg-[#111214] border border-[#1f2024] hover:border-[#00f0ff]/50 rounded-[8px] p-3 flex items-center justify-between gap-3 shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-[8px] bg-[#16171a] flex items-center justify-center text-lg shrink-0 border border-[#2b2d31]">
                {meta.icon}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate group-hover:text-[#00f0ff] transition-colors">
                  {title}
                </div>
                <div className="text-[10px] text-[#949ba4] flex items-center gap-2">
                  <span className="font-semibold text-[#dbdee1]">{meta.name}</span>
                  <span>•</span>
                  <span>{size}</span>
                </div>
              </div>
            </div>

            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-[#1a1b1e] hover:bg-[#00f0ff] text-[#dbdee1] hover:text-black text-xs font-bold transition-all shrink-0 shadow"
            >
              <span>View</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        );
      })}

      {/* Render Direct Upload Attachments */}
      {attachmentMatches.map((match, idx) => {
        const [, filenameAndSize, downloadUrl] = match;
        const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(filenameAndSize);

        if (isImage && downloadUrl) {
          return (
            <div key={`att-${idx}`} className="my-2 max-w-md rounded-[8px] overflow-hidden border border-[#1f2024] bg-[#111214]">
              <img
                src={downloadUrl}
                alt={filenameAndSize}
                className="max-h-72 w-auto object-cover rounded-[6px]"
                loading="lazy"
              />
              <div className="px-3 py-1.5 text-[11px] text-[#949ba4] flex items-center justify-between">
                <span className="truncate">{filenameAndSize}</span>
                <a href={downloadUrl} download className="hover:text-white flex items-center gap-1">
                  <Download className="w-3 h-3" />
                </a>
              </div>
            </div>
          );
        }

        return (
          <div
            key={`att-${idx}`}
            className="my-2 max-w-sm bg-[#111214] border border-[#1f2024] rounded-[8px] p-3 flex items-center justify-between gap-3 shadow-md"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-[6px] bg-[#16171a] flex items-center justify-center text-[#00f0ff] shrink-0 border border-[#2b2d31]">
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">{filenameAndSize}</div>
                <div className="text-[10px] text-[#949ba4]">Subspace Vault Object</div>
              </div>
            </div>

            {downloadUrl && (
              <a
                href={downloadUrl}
                download
                className="p-1.5 rounded-[4px] hover:bg-[#1a1b1e] text-[#949ba4] hover:text-white transition-colors"
                title="Download file"
              >
                <Download className="w-4 h-4" />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
};

interface MarkdownHandlers {
  onMentionClick?: (mention: string) => void;
  onChannelClick?: (channelName: string) => void;
}

function renderContentBody(content: string, suffix?: React.ReactNode, handlers?: MarkdownHandlers): React.ReactNode {
  // If content contains code blocks ```lang ... ```
  if (content.includes('```')) {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return (
      <div className="space-y-1.5">
        {parts.map((part, i) => {
          if (part.startsWith('```') && part.endsWith('```')) {
            const raw = part.slice(3, -3);
            const firstLineBreak = raw.indexOf('\n');
            let lang = '';
            let code = raw;
            if (firstLineBreak !== -1) {
              const possibleLang = raw.slice(0, firstLineBreak).trim();
              if (possibleLang && !possibleLang.includes(' ') && possibleLang.length < 15) {
                lang = possibleLang;
                code = raw.slice(firstLineBreak + 1);
              }
            }
            return (
              <div key={i} className="my-1.5 rounded-[8px] overflow-hidden border border-[#1f2024] bg-[#0c0d0e]">
                {lang && (
                  <div className="px-3 py-1 bg-[#141518] text-[10px] uppercase font-mono text-[#80848e] border-b border-[#1f2024] flex items-center justify-between">
                    <span>{lang}</span>
                    <button
                      onClick={() => navigator.clipboard?.writeText(code)}
                      className="hover:text-white transition-colors"
                      title="Copy code"
                    >
                      Copy
                    </button>
                  </div>
                )}
                <pre className="p-3 font-mono text-xs text-[#00f0ff] overflow-x-auto selection:bg-[#5865f2] selection:text-white leading-relaxed">
                  <code>{code}</code>
                </pre>
              </div>
            );
          }
          const isLast = i === parts.length - 1;
          return (
            <React.Fragment key={i}>
              {renderMarkdownLines(part, handlers)}
              {isLast && suffix}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {renderMarkdownLines(content, handlers)}
      {suffix}
    </>
  );
}

function renderMarkdownLines(text: string, handlers?: MarkdownHandlers): React.ReactNode {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Subtext: -# text
    if (line.startsWith('-# ')) {
      elements.push(
        <div key={`line-${i}`} className="text-xs text-[#949ba4] mt-0.5 leading-normal">
          {renderInlineMarkdown(line.slice(3), handlers)}
        </div>
      );
      i++;
      continue;
    }

    // Headers: # Header, ## Header, ### Header
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`line-${i}`} className="text-xl font-extrabold text-white my-1 leading-tight">
          {renderInlineMarkdown(line.slice(2), handlers)}
        </h1>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`line-${i}`} className="text-lg font-bold text-white my-1 leading-tight">
          {renderInlineMarkdown(line.slice(3), handlers)}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`line-${i}`} className="text-base font-bold text-white my-0.5 leading-snug">
          {renderInlineMarkdown(line.slice(4), handlers)}
        </h3>
      );
      i++;
      continue;
    }

    // Blockquotes: consecutive lines starting with >
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i].startsWith('> ') ? lines[i].slice(2) : '');
        i++;
      }
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="border-l-4 border-[#4e5058] pl-3 py-0.5 my-1 text-[#dbdee1] bg-[#111214]/50 rounded-r text-xs leading-relaxed"
        >
          {quoteLines.map((ql, qidx) => (
            <div key={qidx}>{renderInlineMarkdown(ql, handlers) || '\u00A0'}</div>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered lists: - or *
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const listItems: string[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        listItems.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1 text-xs text-[#dbdee1]">
          {listItems.map((item, lidx) => (
            <li key={lidx}>{renderInlineMarkdown(item, handlers)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered lists: 1. 2. ...
    if (/^\d+\.\s/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const itemText = lines[i].replace(/^\d+\.\s/, '');
        listItems.push(itemText);
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-1 text-xs text-[#dbdee1]">
          {listItems.map((item, lidx) => (
            <li key={lidx}>{renderInlineMarkdown(item, handlers)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line / paragraph spacing
    if (!line.trim()) {
      elements.push(<div key={`blank-${i}`} className="h-1" />);
      i++;
      continue;
    }

    // Standard text line
    elements.push(
      <div key={`line-${i}`} className="text-xs text-[#dbdee1] leading-relaxed break-words">
        {renderInlineMarkdown(line, handlers)}
      </div>
    );
    i++;
  }

  return <>{elements}</>;
}

interface SpoilerBoxProps {
  content: string;
  handlers?: MarkdownHandlers;
}

const SpoilerBox: React.FC<SpoilerBoxProps> = ({ content, handlers }) => {
  const [revealed, setRevealed] = React.useState(false);

  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setRevealed(!revealed);
      }}
      className={`rounded px-1.5 py-0.5 cursor-pointer transition-all inline-block font-sans ${
        revealed
          ? 'bg-[#2b2d31] text-[#dbdee1]'
          : 'bg-[#202225] hover:bg-[#27292d] text-transparent select-none shadow-sm'
      }`}
      title={revealed ? 'Click to conceal spoiler' : 'Click to reveal spoiler'}
    >
      {renderInlineMarkdown(content, handlers)}
    </span>
  );
};

function renderInlineMarkdown(text: string, handlers?: MarkdownHandlers): React.ReactNode {
  if (!text) return null;

  // Regex tokens:
  // 1. Spoilers: ||spoiler||
  // 2. Code: `code`
  // 3. Bold: **bold**
  // 4. Underline: __underline__
  // 5. Italic: *italic* or _italic_
  // 6. Strikethrough: ~~strikethrough~~
  // 7. Markdown Link: [label](url)
  // 8. Raw URL: https://...
  // 9. Mentions: @username, @everyone, @here, #channel
  const tokenRegex = /((?:\|\|[\s\S]+?\|\|)|(?:`[^`]+`)|(?:\*\*[^*]+\*\*)|(?:__[^_]+__)|(?:\*[^*]+\*)|(?:_[^_]+_)|(?:~~[^~]+~~)|(?:\[[^\]]+\]\([^)]+\))|(?:https?:\/\/[^\s]+)|(?:@(?:everyone|here|[a-zA-Z0-9_.-]+))|(?:#[a-zA-Z0-9_.-]+))/g;

  const parts = text.split(tokenRegex).filter(p => p !== undefined && p !== '');

  return parts.map((part, idx) => {
    // Spoilers: ||text||
    if (part.startsWith('||') && part.endsWith('||') && part.length >= 4) {
      return <SpoilerBox key={idx} content={part.slice(2, -2)} handlers={handlers} />;
    }

    // Inline Code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={idx}
          className="bg-[#1e1f22] text-[#00f0ff] px-1.5 py-0.5 rounded font-mono text-xs border border-[#2b2d31]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold: **bold**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={idx} className="font-bold text-white">{renderInlineMarkdown(part.slice(2, -2), handlers)}</strong>;
    }

    // Underline: __underline__
    if (part.startsWith('__') && part.endsWith('__') && part.length >= 4) {
      return <span key={idx} className="underline underline-offset-2">{renderInlineMarkdown(part.slice(2, -2), handlers)}</span>;
    }

    // Strikethrough: ~~strikethrough~~
    if (part.startsWith('~~') && part.endsWith('~~') && part.length >= 4) {
      return <del key={idx} className="line-through text-[#80848e]">{renderInlineMarkdown(part.slice(2, -2), handlers)}</del>;
    }

    // Italic: *italic* or _italic_
    if ((part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
        (part.startsWith('_') && part.endsWith('_') && part.length >= 2)) {
      return <em key={idx} className="italic text-[#dbdee1]">{renderInlineMarkdown(part.slice(1, -1), handlers)}</em>;
    }

    // Markdown link: [label](url)
    const mdLinkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (mdLinkMatch) {
      return (
        <a
          key={idx}
          href={mdLinkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-[#00f0ff] hover:underline"
        >
          {mdLinkMatch[1]}
        </a>
      );
    }

    // Raw autolink: https://...
    if (part.startsWith('http://') || part.startsWith('https://')) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-[#00f0ff] hover:underline break-all"
        >
          {part}
        </a>
      );
    }

    // Mentions: @user, @role, @everyone, @here
    if (part.startsWith('@')) {
      return (
        <span
          key={idx}
          onClick={(e) => {
            e.stopPropagation();
            handlers?.onMentionClick?.(part.slice(1));
          }}
          className="bg-[#5865f2]/20 hover:bg-[#5865f2]/30 text-[#c9cdfb] font-medium px-1 py-0.5 rounded cursor-pointer transition-colors"
        >
          {part}
        </span>
      );
    }

    // Channel mentions: #channel
    if (part.startsWith('#')) {
      return (
        <span
          key={idx}
          onClick={(e) => {
            e.stopPropagation();
            handlers?.onChannelClick?.(part.slice(1));
          }}
          className="bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 text-[#00f0ff] font-medium px-1 py-0.5 rounded cursor-pointer transition-colors font-mono text-xs"
        >
          {part}
        </span>
      );
    }

    return part;
  });
}
