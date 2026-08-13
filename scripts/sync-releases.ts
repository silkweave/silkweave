// Sync GitHub releases from the canonical changelog data so the website
// changelog and GitHub releases never drift. Reads website/src/data/changelog.ts
// (the single source of truth) and, for each release, creates or updates the
// GitHub release for its `vX.Y.Z` tag with notes derived from the highlights.
//
// Usage:
//   pnpm sync-releases            # create/update releases for every version
//   pnpm sync-releases --dry-run  # print the notes without touching GitHub
//
// Requires the `gh` CLI to be authenticated and the `vX.Y.Z` tags to exist on
// the remote (the wrapup flow tags + pushes before calling this).

import { execFileSync } from 'node:child_process'
import { releases, REPO_URL, type Change, type Release } from '../website/src/data/changelog.ts'

const DRY_RUN = process.argv.includes('--dry-run')

const HEADINGS: Record<Change['type'], string> = {
  breaking: '### ⚠ Breaking changes',
  feature: '### ✨ New',
  improvement: '### 🔧 Improvements',
  fix: '### 🐛 Fixes'
}

// Render the release body as GitHub-flavoured markdown, grouped by change type.
function notesFor(release: Release): string {
  const lines: string[] = []
  if (release.summary) {
    lines.push(release.summary, '')
  }
  for (const type of ['breaking', 'feature', 'improvement', 'fix'] as const) {
    const group = release.changes.filter((c) => c.type === type)
    if (group.length === 0) {
      continue
    }
    lines.push(HEADINGS[type])
    for (const change of group) {
      const link = change.commit ? ` ([\`${change.commit}\`](${REPO_URL}/commit/${change.commit}))` : ''
      lines.push(`- ${change.text}${link}`)
    }
    lines.push('')
  }
  lines.push(`**Full changelog:** https://www.silkweave.dev/changelog`)
  return lines.join('\n').trim()
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim()
}

function releaseExists(tag: string): boolean {
  try {
    gh(['release', 'view', tag, '--json', 'tagName'])
    return true
  } catch {
    return false
  }
}

let created = 0
let updated = 0
releases.forEach((release, index) => {
  // Pseudo entries (e.g. the pre-tag prototype) have no tag / GitHub release.
  if (release.unreleased) {
    console.log(`skipped v${release.version} (unreleased)`)
    return
  }
  const tag = `v${release.version}`
  const title = tag
  const notes = notesFor(release)
  // Data is newest-first, so only the first entry is "Latest" on GitHub.
  // Set it explicitly on every release (gh otherwise marks whichever it
  // touched last), keeping the badge deterministic.
  const latestFlag = `--latest=${index === 0 ? 'true' : 'false'}`

  if (DRY_RUN) {
    console.log(`\n──────── ${tag} ────────\n${notes}`)
    return
  }

  if (releaseExists(tag)) {
    gh(['release', 'edit', tag, '--title', title, '--notes', notes, latestFlag])
    updated += 1
    console.log(`updated ${tag}`)
  } else {
    // `--verify-tag` fails loudly if the tag isn't on the remote yet, rather
    // than silently creating one off the current HEAD.
    gh(['release', 'create', tag, '--verify-tag', '--title', title, '--notes', notes, latestFlag])
    created += 1
    console.log(`created ${tag}`)
  }
})

if (!DRY_RUN) {
  console.log(`\nDone - ${created} created, ${updated} updated, ${releases.length} total.`)
}
