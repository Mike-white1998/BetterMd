import { ChangeEvent, DragEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import mermaid from 'mermaid';
import {
  UploadCloud,
  FileText,
  Trash2,
  CloudDownload,
  ClipboardPaste,
  Search,
  ZoomOut,
  ZoomIn,
  Sun,
  Moon,
  Monitor,
  Maximize,
  Minimize,
  PanelRight,
  PanelRightClose,
  Copy,
  Download,
  CheckCircle2,
  FileBox,
  Key,
  ChevronUp,
  ChevronDown,
  Pencil,
  Save,
  X,
} from 'lucide-react';

type WidthMode = 'narrow' | 'wide';
type ThemeMode = 'system' | 'light' | 'dark';

type FileRecord = {
  id: string;
  name: string;
  content: string;
  source: 'file' | 'paste' | 'sample' | 'remote';
};

type HeadingItem = {
  id: string;
  level: number;
  text: string;
};

type Preferences = {
  fontSize: number;
  widthMode: WidthMode;
  theme: ThemeMode;
};

const STORAGE_KEY = 'better-md-viewer-preferences';
const SAMPLE_MARKDOWN = `# Better MD Viewer

一个更适合技术文档阅读的 Markdown 站点。

## 亮点

- 本地读取，默认不上传文档内容
- Mermaid 流程图、KaTeX 公式、代码高亮
- GitHub Raw 导入、目录导航、全文搜索
- 主题切换、宽度切换、字体调整、导出 HTML

## Mermaid 示例

\`\`\`mermaid
flowchart TD
  A[上传文档] --> B[前端解析]
  B --> C[渲染目录和内容]
  C --> D[导出静态 HTML]
\`\`\`

## KaTeX 示例

行内公式：$E = mc^2$

块公式：

$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$

## 代码示例

\`\`\`ts
function greet(name: string) {
  return \`hello, \${name}\`;
}
\`\`\`

## 表格

| 能力 | 支持 |
| --- | --- |
| Mermaid | 是 |
| KaTeX | 是 |
| GitHub 导入 | 是 |

> 所有渲染都在浏览器端完成，适合部署到静态站点。
`;

const marked = new Marked({
  gfm: true,
  breaks: true,
});

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('jsx', javascript);

marked.use(markedKatex({ throwOnError: false, nonStandard: true }));
marked.setOptions({
  async: false,
  pedantic: false,
});

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\u4e00-\u9fa5- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

const normalizeLanguage = (language: string) => {
  const normalized = language.toLowerCase();
  const aliasMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    html: 'xml',
    md: 'markdown',
    text: 'plaintext',
    txt: 'plaintext',
    shell: 'bash',
    sh: 'bash',
    yml: 'yaml',
  };
  return aliasMap[normalized] ?? normalized;
};

const isExternalUrl = (value: string) => /^([a-z0-9+.-]+):/i.test(value);

const normalizeAnchorTarget = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  const withoutQuery = withoutHash.split('?')[0].split('&')[0];
  const withoutPath = withoutQuery.split('/').filter(Boolean).pop() ?? withoutQuery;
  try {
    return decodeURIComponent(withoutPath);
  } catch {
    return withoutPath;
  }
};

const withAnchorIds = (html: string) => {
  const seen = new Map<string, number>();
  return html.replace(/<h([1-3])([^>]*)>(.*?)<\/h\1>/g, (_match, level, attrs, inner) => {
    if (/id="/.test(attrs)) {
      return `<h${level}${attrs}>${inner}</h${level}>`;
    }
    const plainText = inner.replace(/<[^>]+>/g, '').trim() || `section-${level}`;
    const base = slugify(plainText);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
  });
};

const collectHeadings = (root: ParentNode): HeadingItem[] =>
  [...root.querySelectorAll('h1,h2,h3')].map((element) => ({
    id: element.id,
    level: Number(element.tagName.slice(1)),
    text: element.textContent?.trim() || '无标题',
  }));

const highlightSearch = (root: HTMLElement, query: string) => {
  if (!query.trim()) {
    return 0;
  }

  const matcher = new RegExp(escapeRegExp(query), 'gi');
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      const text = node.textContent ?? '';
      if (!parent || !text.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest('.mermaid, .katex-mathml, script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      matcher.lastIndex = 0;
      return matcher.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  let actualMarkCount = 0;
  for (const textNode of textNodes) {
    const value = textNode.textContent ?? '';
    matcher.lastIndex = 0;
    if (!matcher.test(value)) {
      continue;
    }
    matcher.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match = matcher.exec(value);
    while (match) {
      const index = match.index;
      if (index > lastIndex) {
        fragment.appendChild(document.createTextNode(value.slice(lastIndex, index)));
      }
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = match[0];
      fragment.appendChild(mark);
      actualMarkCount += 1;
      lastIndex = index + match[0].length;
      match = matcher.exec(value);
    }
    if (lastIndex < value.length) {
      fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return actualMarkCount;
};

const getStoredPreferences = (): Preferences => {
  if (typeof window === 'undefined') {
    return { fontSize: 16, widthMode: 'wide', theme: 'system' };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { fontSize: 16, widthMode: 'wide', theme: 'system' };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Preferences> & { widthMode?: string };
    const widthMode: WidthMode = parsed.widthMode === 'narrow' ? 'narrow' : 'wide';
    return {
      fontSize: typeof parsed.fontSize === 'number' ? parsed.fontSize : 16,
      widthMode,
      theme: parsed.theme ?? 'system',
    };
  } catch {
    return { fontSize: 16, widthMode: 'wide', theme: 'system' };
  }
};

const applyTheme = (resolvedTheme: 'light' | 'dark') => {
  document.documentElement.dataset.theme = resolvedTheme;
};

const toRawMarkdownUrl = (input: string) => {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'github.com') {
      // Handle standard GitHub blob URLs
      // e.g. https://github.com/owner/repo/blob/branch/path/to/file.md
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
      if (match) {
        const [, owner, repo, rest] = match;
        return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
      }
    }
    return trimmed;
  } catch {
    return trimmed;
  }
};

export default function App() {
  const [files, setFiles] = useState<FileRecord[]>([
    {
      id: crypto.randomUUID(),
      name: 'welcome.md',
      content: SAMPLE_MARKDOWN,
      source: 'sample',
    },
  ]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pasteValue, setPasteValue] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlFeedback, setUrlFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [currentHitIndex, setCurrentHitIndex] = useState(-1);
  const [actualHitCount, setActualHitCount] = useState(0);
  const [fontSize, setFontSize] = useState(getStoredPreferences().fontSize);
  const [widthMode, setWidthMode] = useState<WidthMode>(getStoredPreferences().widthMode);
  const [theme, setTheme] = useState<ThemeMode>(getStoredPreferences().theme);
  const [systemDark, setSystemDark] = useState(
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false,
  );
  const [copyFeedback, setCopyFeedback] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [tocOpen, setTocOpen] = useState(true);
  const [activeHeadingId, setActiveHeadingId] = useState<string>('');
  // Prevent ScrollSpy from immediately overriding the clicked TOC item
  const isClickScrollingRef = useRef(false);
  
  const [githubToken, setGithubToken] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('md-viewer-github-token') || '';
    }
    return '';
  });
  const [showTokenInput, setShowTokenInput] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.title = 'Better MD Viewer';
  }, []);

  const activeFile = useMemo(
    () => files.find((item) => item.id === activeId) ?? files[0] ?? null,
    [activeId, files],
  );

  const rendered = useMemo(() => {
    if (!activeFile) {
      return { html: '', headings: [], searchCount: 0 };
    }
    const rawHtml = marked.parse(activeFile.content) as string;
    const withIds = withAnchorIds(rawHtml);
    const safeHtml = DOMPurify.sanitize(withIds, {
      USE_PROFILES: { html: true },
    });
    const doc = new DOMParser().parseFromString(safeHtml, 'text/html');

    doc.querySelectorAll('pre > code').forEach((codeBlock) => {
      const classMatch = codeBlock.className.match(/language-([\w-]+)/);
      const language = normalizeLanguage(classMatch?.[1] ?? '');
      // Get pure text content before highlight
      const rawCode = codeBlock.textContent ?? '';
      const pre = codeBlock.parentElement;

      if (!pre) {
        return;
      }

      if (language === 'mermaid') {
        const wrapper = doc.createElement('div');
        wrapper.className = 'mermaid-shell';
        const mermaidNode = doc.createElement('div');
        mermaidNode.className = 'mermaid';
        mermaidNode.textContent = rawCode;
        wrapper.appendChild(mermaidNode);
        pre.replaceWith(wrapper);
        return;
      }

      const result =
        language && hljs.getLanguage(language)
          ? hljs.highlight(rawCode, { language })
          : hljs.highlightAuto(rawCode);

      codeBlock.innerHTML = result.value;
      codeBlock.className = `hljs language-${language || result.language || 'plaintext'}`;
    });

    // Run search highlight AFTER code block highlight
    const searchCount = highlightSearch(doc.body, search);

    const headingIds = new Set(
      [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')]
        .map((node) => node.id)
        .filter(Boolean),
    );

    doc.querySelectorAll('a[href]').forEach((link) => {
      const rawHref = link.getAttribute('href')?.trim() ?? '';
      if (!rawHref) {
        return;
      }

      const targetId = normalizeAnchorTarget(rawHref);
      if (rawHref.startsWith('#') && targetId) {
        link.removeAttribute('target');
        link.removeAttribute('rel');
        link.setAttribute('href', `#${targetId}`);
        return;
      }

      if (!isExternalUrl(rawHref) && targetId && headingIds.has(targetId)) {
        link.removeAttribute('target');
        link.removeAttribute('rel');
        link.setAttribute('href', `#${targetId}`);
        return;
      }

      if (isExternalUrl(rawHref)) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noreferrer');
      }
    });

    const headings = collectHeadings(doc.body);

    return {
      html: doc.body.innerHTML,
      headings,
      searchCount,
    };
  }, [activeFile?.content, search]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    const hits = container.querySelectorAll('.search-hit');
    setActualHitCount(hits.length);
    if (hits.length > 0) {
      setCurrentHitIndex(0);
    } else {
      setCurrentHitIndex(-1);
    }
  }, [search, rendered.html]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    const hits = container.querySelectorAll('.search-hit');
    hits.forEach((hit) => hit.classList.remove('active'));

    if (currentHitIndex >= 0 && currentHitIndex < hits.length) {
      const activeHit = hits[currentHitIndex] as HTMLElement;
      
      // Auto-expand any collapsed <details> ancestor
      let parent = activeHit.parentElement;
      while (parent) {
        if (parent.tagName.toLowerCase() === 'details' && !parent.hasAttribute('open')) {
          parent.setAttribute('open', 'true');
        }
        parent = parent.parentElement;
      }

      activeHit.classList.add('active');
      
      isClickScrollingRef.current = true;
      activeHit.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      setTimeout(() => {
        isClickScrollingRef.current = false;
      }, 800);
    }
  }, [currentHitIndex, actualHitCount]);

  const handleNextHit = () => {
    if (actualHitCount > 0) {
      setCurrentHitIndex((prev) => (prev + 1) % actualHitCount);
    }
  };

  const handlePrevHit = () => {
    if (actualHitCount > 0) {
      setCurrentHitIndex((prev) => (prev - 1 + actualHitCount) % actualHitCount);
    }
  };

  useEffect(() => {
    if (!activeId && files.length > 0) {
      setActiveId(files[0].id);
    }
  }, [activeId, files]);

  useEffect(() => {
    setIsEditing(false);
  }, [activeId]);

  useEffect(() => {
    const preferences: Preferences = { fontSize, widthMode, theme };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    applyTheme(resolvedTheme);
  }, [fontSize, resolvedTheme, theme, widthMode]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [activeId, search]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isClickScrollingRef.current) return;

      const headings = Array.from(
        document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6')
      ) as HTMLElement[];

      if (headings.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      const activeLine = containerRect.top + 48; // 48px buffer from the top of the reader container

      let currentId = headings[0].id;

      for (const h of headings) {
        if (h.getBoundingClientRect().top <= activeLine) {
          currentId = h.id;
        } else {
          break;
        }
      }

      // Absolute bottom check
      const isAtAbsoluteBottom = Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) <= 2;
      if (isAtAbsoluteBottom) {
        currentId = headings[headings.length - 1].id;
      }

      if (currentId !== activeHeadingId) {
        setActiveHeadingId(currentId);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    
    // Initial check
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [rendered.html, activeHeadingId]);



  useEffect(() => {
    const container = previewRef.current;
    if (!container) {
      return;
    }

    const nodes = Array.from(container.querySelectorAll('.mermaid')) as HTMLElement[];
    if (!nodes.length) {
      return;
    }

    const run = async () => {
      // Fade out current SVGs so the rebuild looks like one smooth swap
      // instead of a blank flash.
      for (const node of nodes) {
        node.style.opacity = '0';
      }
      // Let the opacity transition commit one frame before we tear down.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: resolvedTheme === 'dark' ? 'dark' : 'default',
      });
      for (const node of nodes) {
        node.removeAttribute('data-processed');
      }
      try {
        await mermaid.run({ nodes, suppressErrors: true });
      } catch {
        // Leave the original mermaid text as-is when rendering fails.
      }
      for (const node of nodes) {
        node.style.opacity = '1';
      }
    };

    // Defer to idle time so theme-switch View Transition isn't blocked by
    // mermaid's synchronous SVG rebuild.
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (win.requestIdleCallback) {
      const handle = win.requestIdleCallback(run, { timeout: 600 });
      return () => win.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(run, 320);
    return () => window.clearTimeout(handle);
  }, [rendered.html, resolvedTheme]);

  const emptyState = !activeFile;

  const addFiles = (nextFiles: FileRecord[]) => {
    if (!nextFiles.length) {
      return;
    }
    setFiles((current) => [...nextFiles, ...current]);
    setActiveId(nextFiles[0].id);
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length) {
      return;
    }

    const nextFiles = await Promise.all(
      [...list]
        .filter((file) => /\.(md|markdown|txt)$/i.test(file.name))
        .map(async (file) => ({
          id: crypto.randomUUID(),
          name: file.name,
          content: await file.text(),
          source: 'file' as const,
        })),
    );

    addFiles(nextFiles);
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleFiles(event.target.files);
    event.target.value = '';
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    await handleFiles(event.dataTransfer.files);
  };

  const onPasteRender = () => {
    if (!pasteValue.trim()) {
      return;
    }
    addFiles([
      {
        id: crypto.randomUUID(),
        name: `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
        content: pasteValue,
        source: 'paste',
      },
    ]);
    setPasteValue('');
  };

  const onImportUrl = async () => {
    if (!urlValue.trim()) {
      setUrlFeedback('请输入 GitHub 或公开 Markdown 地址');
      return;
    }

    try {
      setUrlLoading(true);
      setUrlFeedback('');
      
      const trimmedUrl = urlValue.trim();
      const urlObj = new URL(trimmedUrl);
      let fetchUrl = toRawMarkdownUrl(trimmedUrl);
      let headers: HeadersInit = {};

      // If it's github and we have a token, use the GitHub API to fetch private repo contents
      if (urlObj.hostname === 'github.com' && githubToken) {
        const match = urlObj.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
        if (match) {
          const [, owner, repo, branch, path] = match;
          fetchUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
          headers = {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3.raw'
          };
        }
      }

      const response = await fetch(fetchUrl, { headers });
      
      if (response.status === 404) {
        throw new Error('404 找不到文件，检查链接或确认是否为私有仓库 (私有仓库请配置 Token)');
      }
      
      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }
      
      const content = await response.text();
      const name = trimmedUrl.split('/').pop() || `remote-${Date.now()}.md`;
      addFiles([
        {
          id: crypto.randomUUID(),
          name,
          content,
          source: 'remote',
        },
      ]);
      setUrlFeedback('链接导入成功');
      setUrlValue('');
    } catch (error) {
      setUrlFeedback(error instanceof Error ? error.message : '导入失败，请检查链接或跨域限制');
    } finally {
      setUrlLoading(false);
    }
  };

  const removeFile = (id: string) => {
    setFiles((current) => {
      const next = current.filter((file) => file.id !== id);
      if (!next.length) {
        setActiveId(null);
      } else if (activeId === id) {
        setActiveId(next[0].id);
      }
      return next;
    });
  };

  const exportHtml = () => {
    if (!activeFile) {
      return;
    }

    const exportedHtml =
      previewRef.current?.querySelector('.markdown-body')?.innerHTML ?? rendered.html;

    const blob = new Blob(
      [
        `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${activeFile.name}</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" /><style>body{font-family:Inter,system-ui,sans-serif;max-width:980px;margin:40px auto;padding:0 24px;line-height:1.85;color:#111827;background:#f8fafc}pre{background:#0f172a;color:#e2e8f0;padding:18px;border-radius:16px;overflow:auto}pre code,code.hljs{color:#e2e8f0;display:block}code{font-family:Consolas,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:8px 12px;text-align:left}blockquote{border-left:4px solid #6366f1;padding-left:16px;color:#4b5563}img,svg{max-width:100%}</style></head><body>${exportedHtml}</body></html>`,
      ],
      { type: 'text/html;charset=utf-8' },
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeFile.name.replace(/\.(md|markdown|txt)$/i, '') + '.html';
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyMarkdown = async () => {
    if (!activeFile) {
      return;
    }

    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopyFeedback('已复制 Markdown');
      window.setTimeout(() => setCopyFeedback(''), 1800);
    } catch {
      setCopyFeedback('复制失败，请检查浏览器权限');
      window.setTimeout(() => setCopyFeedback(''), 1800);
    }
  };

  const startEdit = () => {
    if (!activeFile) return;
    setEditName(activeFile.name);
    setEditContent(activeFile.content);
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (!activeFile) return;
    const trimmedName = editName.trim() || activeFile.name;
    setFiles((current) =>
      current.map((file) =>
        file.id === activeFile.id
          ? { ...file, name: trimmedName, content: editContent }
          : file,
      ),
    );
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const sourceLabel = (source: FileRecord['source']) => {
    if (source === 'file') return '本地文件';
    if (source === 'paste') return '粘贴内容';
    if (source === 'remote') return '远程导入';
    return '示例文档';
  };

  const onPreviewClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a');
    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute('href')?.trim() ?? '';
    
    // Allow external links to behave normally
    if (isExternalUrl(href)) {
      return;
    }

    // Intercept all internal/relative/hash links to prevent page reloads
    event.preventDefault();

    const id = normalizeAnchorTarget(href);
    if (!id) {
      return;
    }

    let element = document.getElementById(id);
    
    if (!element) {
      element = document.getElementById(slugify(id));
    }

    if (!element) {
      const headings = Array.from(document.querySelectorAll('.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6'));
      element = headings.find(h => slugify(h.textContent || '') === slugify(id)) as HTMLElement | null;
    }

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.history.replaceState(null, '', `#${encodeURIComponent(element.id)}`);
    }
  };

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    const nextResolved = next === 'system' ? (systemDark ? 'dark' : 'light') : next;

    const startVT = (
      document as Document & { startViewTransition?: (cb: () => void) => unknown }
    ).startViewTransition;

    // No View Transitions support, or user opted out of motion — just flip.
    if (!startVT || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTheme(next);
      return;
    }

    startVT.call(document, () => {
      flushSync(() => {
        applyTheme(nextResolved);
        setTheme(next);
      });
    });
  };

  const toggleWidth = () => {
    setWidthMode((curr) => (curr === 'narrow' ? 'wide' : 'narrow'));
  };

  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  const WidthIcon = widthMode === 'narrow' ? Minimize : Maximize;

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-icon">MD</div>
          <h1 className="brand-title">Better Viewer</h1>
        </div>

        <div className="sidebar-scrollable">
          {/* Upload Hero */}
          <div
            className={`upload-hero ${isDragging ? 'dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              multiple
              hidden
              onChange={onFileChange}
            />
            <div className="upload-icon-wrapper">
              <UploadCloud size={24} strokeWidth={2.5} />
            </div>
            <div>
              <p className="upload-title">导入 Markdown</p>
              <p className="upload-desc">点击或拖拽文件至此</p>
            </div>
          </div>

          {/* Remote Import */}
          <div className="sidebar-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 className="section-title" style={{ margin: 0 }}>远程导入 (GitHub)</h3>
              <button 
                className="icon-btn" 
                style={{ width: 24, height: 24, color: githubToken ? 'var(--accent-base)' : 'var(--text-tertiary)' }}
                onClick={() => setShowTokenInput(!showTokenInput)}
                title="配置 GitHub Token (访问私有仓库)"
              >
                <Key size={14} />
              </button>
            </div>
            
            {showTokenInput && (
              <div style={{ marginBottom: 12 }}>
                <input
                  type="password"
                  className="sleek-input"
                  style={{ width: '100%', background: 'var(--bg-hover)', borderRadius: 'var(--radius-md)' }}
                  value={githubToken}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGithubToken(val);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('md-viewer-github-token', val);
                    }
                  }}
                  placeholder="Paste GitHub PAT (Private Repo)"
                />
                <p className="upload-desc" style={{ fontSize: 11, marginTop: 4 }}>
                  仅保存在本地浏览器，用于请求私有仓库源码。
                </p>
              </div>
            )}

            <div className="input-group">
              <input
                className="sleek-input"
                value={urlValue}
                onChange={(event) => setUrlValue(event.target.value)}
                placeholder="https://..."
              />
              <button className="icon-btn" onClick={onImportUrl} disabled={urlLoading} title="导入">
                <CloudDownload size={16} />
              </button>
            </div>
            {urlFeedback && <p className="upload-desc" style={{ marginTop: 8, color: 'var(--accent-base)' }}>{urlFeedback}</p>}
          </div>

          {/* File List */}
          <div className="sidebar-section">
            <h3 className="section-title">文档列表</h3>
            <div className="file-list">
              {files.length > 0 ? files.map((file) => (
                <button
                  key={file.id}
                  className={`file-item ${file.id === activeFile?.id ? 'active' : ''}`}
                  onClick={() => setActiveId(file.id)}
                >
                  <div className="file-item-left">
                    <FileText size={16} className="file-item-icon" />
                    <div className="file-item-info">
                      <span className="file-item-name" title={file.name}>{file.name}</span>
                      <span className="file-item-source">{sourceLabel(file.source)}</span>
                    </div>
                  </div>
                  <div
                    className="delete-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeFile(file.id);
                    }}
                    title="移除文档"
                  >
                    <Trash2 size={14} />
                  </div>
                </button>
              )) : (
                <p className="upload-desc">暂无文档</p>
              )}
            </div>
          </div>

          {/* Quick Paste */}
          <div className="sidebar-section">
            <h3 className="section-title">快速粘贴</h3>
            <textarea
              className="paste-area"
              value={pasteValue}
              onChange={(event) => setPasteValue(event.target.value)}
              placeholder="直接粘贴 Markdown 内容..."
            />
            {pasteValue.trim() && (
              <button className="btn-primary" onClick={onPasteRender}>
                <ClipboardPaste size={16} /> 生成文档
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="main-content">
        {/* Topbar */}
        <header className="topbar">
          {isEditing ? (
            <input
              className="title-edit-input"
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
              placeholder="文档标题"
            />
          ) : (
            <h2 className="topbar-title">{activeFile?.name ?? '尚未选择文档'}</h2>
          )}
          <div className="topbar-actions">
            <div className="search-box">
              <Search size={14} color="var(--text-tertiary)" />
              <input
                type="search"
                placeholder="搜索内容..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (event.shiftKey) {
                      handlePrevHit();
                    } else {
                      handleNextHit();
                    }
                  }
                }}
              />
              {search && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="search-hit-count">
                    {actualHitCount > 0 ? currentHitIndex + 1 : 0} / {actualHitCount}
                  </span>
                  {actualHitCount > 0 && (
                    <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
                      <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={handlePrevHit} title="上一个 (Shift+Enter)">
                        <ChevronUp size={14} />
                      </button>
                      <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={handleNextHit} title="下一个 (Enter)">
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button className="icon-btn" onClick={() => setFontSize(v => Math.max(13, v - 1))} title="缩小字体">
              <ZoomOut size={16} />
            </button>
            <button className="icon-btn" onClick={() => setFontSize(v => Math.min(24, v + 1))} title="放大字体">
              <ZoomIn size={16} />
            </button>
            <div className="action-divider" />
            <button className="icon-btn" onClick={toggleWidth} title="切换宽度">
              <WidthIcon size={16} />
            </button>
            <button className="icon-btn" onClick={toggleTheme} title="切换主题">
              <ThemeIcon size={16} />
            </button>
            <div className="action-divider" />
            {isEditing ? (
              <>
                <button className="icon-btn icon-btn-primary" onClick={saveEdit} title="保存 (Ctrl+S)">
                  <Save size={16} />
                </button>
                <button className="icon-btn" onClick={cancelEdit} title="取消编辑 (Esc)">
                  <X size={16} />
                </button>
              </>
            ) : (
              <button className="icon-btn" onClick={startEdit} disabled={!activeFile} title="编辑">
                <Pencil size={16} />
              </button>
            )}
            <button className="icon-btn" onClick={copyMarkdown} disabled={!activeFile || isEditing} title="复制源码">
              <Copy size={16} />
            </button>
            <button className="icon-btn" onClick={exportHtml} disabled={!activeFile || isEditing} title="导出 HTML">
              <Download size={16} />
            </button>
            <button className="icon-btn" onClick={() => setTocOpen(v => !v)} title="切换目录">
              {tocOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="content-area">
          <div className="reader-container" ref={scrollContainerRef}>
            <div className="reader-content">
              <article
                ref={previewRef}
                className={`markdown-wrapper width-${widthMode}`}
                style={{ fontSize }}
                onClick={onPreviewClick}
              >
                {emptyState ? (
                  <div className="empty-illustration">
                    <FileBox size={48} strokeWidth={1} />
                    <h3>没有选择文档</h3>
                    <p className="upload-desc">请从左侧导入或选择一份 Markdown 文档开始阅读。</p>
                  </div>
                ) : isEditing ? (
                  <textarea
                    className="markdown-editor"
                    style={{ fontSize }}
                    value={editContent}
                    onChange={(event) => setEditContent(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                        event.preventDefault();
                        saveEdit();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelEdit();
                      }
                    }}
                    placeholder="在此输入 Markdown..."
                    autoFocus
                    spellCheck={false}
                  />
                ) : (
                  <div className="markdown-body" dangerouslySetInnerHTML={{ __html: rendered.html }} />
                )}
              </article>
            </div>
          </div>

          {/* TOC Sidebar */}
          {tocOpen && !emptyState && (
            <aside className="toc-sidebar">
              <div className="toc-header">
                <span>页面导航</span>
                <span className="toc-count">{rendered.headings.length} 项</span>
              </div>
              <div className="toc-list">
                {rendered.headings.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={`toc-item level-${item.level} ${activeHeadingId === item.id ? 'active' : ''}`}
                    onClick={(event) => {
                      event.preventDefault();
                      
                      const targetHeading = document.getElementById(item.id);
                      
                      if (targetHeading) {
                        isClickScrollingRef.current = true;
                        setActiveHeadingId(item.id);
                        
                        targetHeading.scrollIntoView({ behavior: 'smooth', block: 'start' });

                        window.history.replaceState(null, '', `#${encodeURIComponent(item.id)}`);
                        
                        setTimeout(() => {
                          isClickScrollingRef.current = false;
                        }, 800);
                      }
                    }}
                  >
                    {item.text}
                  </a>
                ))}
                {rendered.headings.length === 0 && (
                  <p className="upload-desc" style={{ padding: '0 8px' }}>本文档无目录标题</p>
                )}
              </div>
            </aside>
          )}
        </div>
      </main>

      {/* Floating Toast */}
      {copyFeedback && (
        <div className="toast-float">
          <CheckCircle2 size={16} />
          <span>{copyFeedback}</span>
        </div>
      )}
    </div>
  );
}
