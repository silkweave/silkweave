import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import type { APIContext } from 'astro'

// Static feed of published blog posts, newest first. Prerendered to /rss.xml at build.
export const prerender = true

export async function GET(context: APIContext) {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime()
  )

  return rss({
    title: 'Silkweave Blog',
    description:
      'Design notes and deep dives on building MCP servers, adapters, and AI tooling with Silkweave.',
    site: context.site ?? 'https://www.silkweave.dev',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/blog/${post.data.slug}/`,
      categories: post.data.keywords
    })),
    customData: '<language>en-us</language>'
  })
}
