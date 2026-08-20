import type { NextFunction, Request, Response } from 'express';

/**
 * One structured line per request on completion. Field list: docs/16-errors-and-limits.md.
 *
 * `route` is the route pattern rather than the concrete path, so ids do not turn
 * every request into its own log cardinality bucket — and so a UUID never lands
 * in a log field by accident.
 */
export function requestLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const route = req.route ? `${req.baseUrl}${req.route.path}` : req.baseUrl || req.path;

    const fields = {
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ...req.logFields,
    };

    // 5xx is ours; 4xx is the caller's. Health probes are noise at info level.
    if (res.statusCode >= 500) {
      req.log.error(fields, 'request failed');
    } else if (route.startsWith('/health')) {
      req.log.debug(fields, 'request');
    } else if (res.statusCode >= 400) {
      req.log.warn(fields, 'request rejected');
    } else {
      req.log.info(fields, 'request');
    }
  });

  next();
}
