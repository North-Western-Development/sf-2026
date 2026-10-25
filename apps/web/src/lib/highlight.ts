// highlight.js loads the first time something names a language (messages and the editor share it).
type Hljs = typeof import('highlight.js/lib/common').default;

let hljs: Hljs | null = null;
let loading: Promise<Hljs> | null = null;

export function loadHljs(): Promise<Hljs> {
  return (loading ??= import('highlight.js/lib/common').then((m) => (hljs = m.default)));
}

export const hljsReady = () => hljs !== null;

/** Highlighted HTML for code, or null while highlight.js is still loading or the language is unknown. */
export function highlightNow(code: string, lang: string): string | null {
  if (!hljs || !lang || !hljs.getLanguage(lang)) return null;
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}
