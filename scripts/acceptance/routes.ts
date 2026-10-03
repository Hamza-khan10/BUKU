/**
 * Every HTTP route the services expose, read from the real route setup (not
 * from the source text, so routes registered in loops are included). Each
 * service's `registerRoutes` runs against a recording app with stand-in
 * dependencies; nothing is called, only registered.
 */
import { registerRoutes as auth } from '../../services/auth/src/routes/index.js';
import { registerRoutes as billing } from '../../services/billing/src/routes/index.js';
import { registerRoutes as booking } from '../../services/booking/src/routes/index.js';
import { registerRoutes as business } from '../../services/business/src/routes/index.js';
import { registerRoutes as notification } from '../../services/notification/src/routes/index.js';
import { registerRoutes as queue } from '../../services/queue/src/routes/index.js';
import { registerRoutes as search } from '../../services/search/src/routes.js';

export interface Route {
  service: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Any property, any call: returns itself. `redis` is absent so rate limits use memory. */
function stand_in(): unknown {
  const fn = function () {
    return proxy;
  };
  const proxy: unknown = new Proxy(fn, {
    get: (_t, prop) => (prop === 'redis' || prop === 'then' ? undefined : proxy),
    apply: () => proxy,
  });
  return proxy;
}

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

function collect(service: string, register: (app: never, deps: never) => void): Route[] {
  const routes: Route[] = [];
  const add = (prefix: string, method: string, path: string) =>
    routes.push({
      service,
      method: method.toUpperCase() as Route['method'],
      path: `${prefix}${path === '/' && prefix ? '' : path}`,
    });
  const app: Record<string, unknown> = {
    use(prefix: unknown, ...handlers: unknown[]) {
      if (typeof prefix !== 'string') return;
      for (const h of handlers) {
        const stack = (h as { stack?: Layer[] }).stack;
        if (!stack) continue;
        for (const layer of stack) {
          if (!layer.route) continue;
          for (const m of Object.keys(layer.route.methods))
            if (m !== '_all') add(prefix, m, layer.route.path);
        }
      }
    },
  };
  for (const m of METHODS)
    app[m] = (path: unknown) => {
      if (typeof path === 'string') add('', m, path);
    };
  const deps = new Proxy({}, { get: (_t, prop) => (prop === 'redis' ? undefined : stand_in()) });
  register(app as never, deps as never);
  return routes;
}

export function allRoutes(): Route[] {
  return [
    ...collect('auth', auth as never),
    ...collect('billing', billing as never),
    ...collect('booking', booking as never),
    ...collect('business', business as never),
    ...collect('notification', notification as never),
    ...collect('queue', queue as never),
    ...collect('search', search as never),
  ];
}
