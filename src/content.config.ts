import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    series: z.string(),
    part: z.number(),
    pubDate: z.coerce.date(),
    cover: z.string().optional(),
    tags: z.array(z.string()).default([]),
    linkedin: z.string().url().optional(),
  }),
});

export const collections = { posts };
