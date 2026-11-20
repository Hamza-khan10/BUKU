import { ImageResponse } from 'next/og';
import { BRAND, MARK } from '@/components/brand/mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * Home-screen icon (iPhone): the app icon (D-143), a white U holding a Saffron dot on Emerald
 * (public/brand/buku-app-icon.svg). Square: iOS rounds the corners itself.
 */
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', background: BRAND.emerald }}>
      <svg width="180" height="180" viewBox="0 0 100 100">
        <g transform="translate(24 23) scale(.866)">
          <path
            d={MARK.cup}
            fill="none"
            stroke={BRAND.white}
            strokeWidth={MARK.cupWidth}
            strokeLinecap="round"
          />
          <circle cx={MARK.dot.cx} cy={MARK.dot.cy} r={MARK.dot.r} fill={BRAND.saffron} />
        </g>
      </svg>
    </div>,
    size,
  );
}
