const EXTENSION_MIME: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  css: 'text/css',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  js: 'application/javascript',
  mjs: 'application/javascript',
  cjs: 'application/javascript',
  ts: 'text/x-typescript',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf'
}

/** Media type for a skill file, by extension. Unknown extensions are opaque bytes. */
export function mimeForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MIME[extension] ?? 'application/octet-stream'
}
