import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Home-screen icon for iPhones: the ticket mark on BUKU's paper colour. */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fbf8f3',
      }}
    >
      <svg width="132" height="132" viewBox="0 0 32 32">
        <path
          d="M6 6h20a2 2 0 0 1 2 2v5a3 3 0 0 0 0 6v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5a3 3 0 0 0 0-6V8a2 2 0 0 1 2-2Z"
          fill="#d4432a"
        />
        <path d="M20 9v14" stroke="#fff" strokeWidth="1.6" strokeDasharray="1.6 2.2" opacity=".75" />
        <path
          d="m9.5 16.2 2.6 2.6 5-5.6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>,
    size,
  );
}
