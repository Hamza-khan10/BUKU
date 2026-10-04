/**
 * The phone's position, asked for once, when someone chooses to join a queue
 * (the queue only lets people join from nearby). Every way it can fail has a
 * reason the page can explain.
 */
export type PositionProblem = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class PositionError extends Error {
  constructor(readonly problem: PositionProblem) {
    super(problem);
  }
}

export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new PositionError('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) =>
        reject(
          new PositionError(
            e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable',
          ),
        ),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

export const POSITION_MESSAGES: Record<PositionProblem, string> = {
  unsupported: 'This browser can’t share its location. You can still join at the counter.',
  denied:
    'Location is turned off for this site. Allow it in your browser’s settings to join from here, or join at the counter.',
  unavailable: 'Your location couldn’t be found just now. Please try again.',
  timeout: 'Finding your location took too long. Please try again.',
};
