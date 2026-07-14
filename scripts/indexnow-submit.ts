/**
 * Submit changed URLs to IndexNow (https://www.indexnow.org) so search engines
 * (Bing, Yandex, Seznam, Naver, ...) re-crawl them promptly after a deploy.
 *
 * Usage:  pnpm indexnow <path-or-url> [...more]     (run from the repo root)
 *   pnpm indexnow /blog/automate-around-the-ceremony /blog
 *   pnpm indexnow https://www.silkweave.dev/changelog
 *
 * The key is read from $INDEXNOW_KEY or website/.env (gitignored). The same key
 * must be set as INDEXNOW_KEY on the Vercel project so the site can serve it at
 * https://www.silkweave.dev/<key>.txt (see website/src/pages/[key].txt.ts).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HOST = 'www.silkweave.dev'
const ENDPOINT = 'https://api.indexnow.org/indexnow'

function readKey(): string {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY
  try {
    const env = readFileSync(resolve(process.cwd(), 'website/.env'), 'utf8')
    const match = env.match(/^INDEXNOW_KEY=(.+)$/m)
    if (match) return match[1].trim()
  } catch {
    // fall through to the error below
  }
  console.error('INDEXNOW_KEY not found (set the env var or add it to website/.env)')
  return process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('usage: pnpm indexnow <path-or-url> [...more]')
    process.exit(1)
  }

  const urlList = args.map((arg) => {
    const url = arg.startsWith('http') ? new URL(arg) : new URL(arg, `https://${HOST}`)
    if (url.host !== HOST) {
      console.error(`refusing to submit a URL outside ${HOST}: ${arg}`)
      process.exit(1)
    }
    return url.toString()
  })

  const key = readKey()
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${key}.txt`, urlList })
  })

  // 200 = submitted, 202 = accepted (key validation pending). Anything else is a failure.
  if (response.status === 200 || response.status === 202) {
    console.log(`IndexNow: ${response.status} ${response.statusText} - submitted ${urlList.length} URL(s)`)
    for (const url of urlList) console.log(`  ${url}`)
  } else {
    console.error(`IndexNow submission failed: ${response.status} ${response.statusText}`)
    console.error(await response.text())
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
