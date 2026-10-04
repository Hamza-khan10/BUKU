import { NextResponse } from 'next/server';

/**
 * "See this page instead" (303) to a path on this site. A relative Location
 * is valid HTTP and needs no settings — for answers that must work even on a
 * site deployed without them.
 */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path, 'cache-control': 'no-store' } });
}
