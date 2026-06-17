/**
 * Minimal, dependency-free syntax highlighter for TS/JS snippets.
 *
 * Emits the site's `.token-*` classes (styled in global.css) so highlighted
 * code looks identical everywhere - the homepage, /docs, and the deep-dive
 * pages all share this one tokenizer.
 */
export function hl(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // Single-pass tokenizer: alternation is tried left-to-right at each position,
  // so each character is consumed exactly once - no re-scanning of inserted
  // markup (which a chained `.replace()` would corrupt, e.g. capitalising type
  // names inside an already-wrapped string span).
  const pattern =
    /(\/\/[^\n]*)|('[^']*'|`[^`]*`)|\b(import|from|export|default|const|let|var|async|await|return|throw|yield|if|else|for|while|switch|case|break|new|delete|interface|type|class|function|extends|implements|readonly|enum|public|private|protected|static|abstract|as|satisfies|typeof|keyof|instanceof|in|of|void|never)\b|\b(string|number|boolean|undefined|null|unknown|any|object|symbol|bigint|this)\b|\b([A-Z][A-Za-z0-9_]*)\b|\b(\d[\d_]*)\b/g
  return escaped.replace(pattern, (match, comment, str, keyword, primitive, type, num) => {
    if (comment) { return `<span class="token-comment">${comment}</span>` }
    if (str) { return `<span class="token-string">${str}</span>` }
    if (keyword) { return `<span class="token-keyword">${keyword}</span>` }
    if (primitive) { return `<span class="token-type">${primitive}</span>` }
    if (type) { return `<span class="token-type">${type}</span>` }
    if (num) { return `<span class="token-number">${num}</span>` }
    return match
  })
}
