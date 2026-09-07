import React from 'react';
import { ExternalLink, FileText, Download } from 'lucide-react';

interface MarkdownMessageProps {
  content: string;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
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

  return (
    <div className="space-y-2">
      {cleanedContent && renderContentBody(cleanedContent)}

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

function renderContentBody(content: string): React.ReactNode {
  // If content contains code blocks ```...```
  if (content.includes('```')) {
    const parts = content.split(/(```[\s\S]*?```)/g);
    return (
      <div className="space-y-1">
        {parts.map((part, i) => {
          if (part.startsWith('```') && part.endsWith('```')) {
            const inner = part.slice(3, -3).replace(/^[a-z0-9]+\n/i, '');
            return (
              <pre
                key={i}
                className="bg-[#111214] border border-[#1f2024] rounded-[6px] p-3 font-mono text-xs text-[#00f0ff] overflow-x-auto my-1 selection:bg-[#5865f2]"
              >
                <code>{inner}</code>
              </pre>
            );
          }
          return <span key={i}>{renderInlineMarkdown(part)}</span>;
        })}
      </div>
    );
  }

  // If quote block
  if (content.startsWith('> ')) {
    const lines = content.split('\n');
    const quotes = lines.filter(l => l.startsWith('> ')).map(l => l.slice(2)).join('\n');
    const rest = lines.filter(l => !l.startsWith('> ')).join('\n');
    return (
      <div>
        <blockquote className="border-l-4 border-[#35373c] pl-3 text-[#949ba4] italic text-xs mb-1 bg-[#111214]/50 py-0.5 rounded-r">
          {renderInlineMarkdown(quotes)}
        </blockquote>
        {rest && <div>{renderInlineMarkdown(rest)}</div>}
      </div>
    );
  }

  return <>{renderInlineMarkdown(content)}</>;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Parse inline `code`, **bold**, *italic*, ~~strikethrough~~, __underline__, and URLs
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|__[^_]+__|https?:\/\/[^\s]+)/g);

  return tokens.map((token, idx) => {
    if (token.startsWith('`') && token.endsWith('`')) {
      return (
        <code
          key={idx}
          className="bg-[#1e1f22] text-[#e0e1e5] px-1.5 py-0.5 rounded font-mono text-xs border border-[#2b2d31]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    if (token.startsWith('**') && token.endsWith('**')) {
      return <strong key={idx} className="font-bold text-white">{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('__') && token.endsWith('__')) {
      return <span key={idx} className="underline underline-offset-2">{token.slice(2, -2)}</span>;
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={idx} className="italic text-[#dbdee1]">{token.slice(1, -1)}</em>;
    }
    if (token.startsWith('~~') && token.endsWith('~~')) {
      return <del key={idx} className="line-through text-[#80848e]">{token.slice(2, -2)}</del>;
    }
    if (token.startsWith('http://') || token.startsWith('https://')) {
      return (
        <a
          key={idx}
          href={token}
          target="_blank"
          rel="noreferrer"
          className="text-[#00f0ff] hover:underline break-all"
        >
          {token}
        </a>
      );
    }
    return token;
  });
}
