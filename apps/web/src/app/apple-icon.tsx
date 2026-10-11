import { ImageResponse } from 'next/og';
import { BRAND, MARK } from '@/components/brand/mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Home-screen icon (iPhone): the app icon, a white ticket on Emerald (public/brand/buku-app-icon.svg). */
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', background: BRAND.emerald }}>
      <svg width="180" height="180" viewBox="0 0 48 48">
        <g transform="translate(6 6) scale(.75)">
          <path d={MARK.ticket} fill={BRAND.white} />
          <path d={MARK.hour} stroke={BRAND.emerald} strokeWidth={MARK.hourWidth} strokeLinecap="round" />
          <path d={MARK.minute} stroke={BRAND.emerald} strokeWidth={MARK.minuteWidth} strokeLinecap="round" />
          <circle cx={MARK.pivot.cx} cy={MARK.pivot.cy} r={MARK.pivot.r} fill={BRAND.saffron} />
        </g>
      </svg>
    </div>,
    size,
  );
}
