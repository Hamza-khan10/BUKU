import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BUKU',
    short_name: 'BUKU',
    description: 'Book appointments and join queues at local businesses.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f8f6',
    theme_color: '#056549',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/brand/buku-app-icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
