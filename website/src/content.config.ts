import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro:schema'

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    slug: z.string(),
    author: z.string().default('Silkweave'),
    keywords: z.array(z.string()).default([]),
    ogImage: z.string().optional(),
    socialLinks: z.object({
      reddit: z.string().optional(),
      x: z.string().optional(),
      linkedin: z.string().optional()
    }).optional(),
    draft: z.boolean().default(false)
  })
})

export const collections = { blog }
