import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BUKU',
    short_name: 'BUKU',
    description: 'Book appointments and join queues at local businesses.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fbf8f3',
    theme_color: '#fbf8f3',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
