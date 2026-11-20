import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { site } from '../series';
export async function GET(context: { site: URL }) {
  const posts = (await getCollection('posts')).sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf() || b.data.part - a.data.part);
  return rss({
    title: site.name, description: site.description, site: context.site + import.meta.env.BASE_URL.replace(/^\//, ''),
    items: posts.map(p => ({ title: p.data.title, description: p.data.description, pubDate: p.data.pubDate, link: `${import.meta.env.BASE_URL.replace(/\/$/, '')}/posts/${p.id}/` })),
  });
}
