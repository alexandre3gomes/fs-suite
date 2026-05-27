// Cloudflare Worker — reverse proxy for api-candidate.fs-suite.com.
//
// Forwards every request to the Cloud Run service URL (set via the
// UPSTREAM_ORIGIN env var in wrangler.toml). The hostname is stable and
// always points at Cloud Run, independent of the api.fs-suite.com DNS
// swap done during EC2→Cloud Run failover. The frontend can be
// repointed at api-candidate.fs-suite.com permanently as a fallback.

export interface Env {
  /**
   * Cloud Run service URL, e.g. https://fs-suite-api-uvdurl4sfa-nw.a.run.app.
   * Configured per-environment in wrangler.toml. Update if the Cloud Run
   * service is recreated (the random ID at the start of the hostname
   * changes on deletion + recreate, but not on regular deploys).
   */
  UPSTREAM_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const inboundUrl = new URL(request.url);
    const upstream = new URL(env.UPSTREAM_ORIGIN);

    // Forward to the same path + query, but on the Cloud Run host.
    const outboundUrl = new URL(inboundUrl.pathname + inboundUrl.search, upstream);

    // Clone the incoming request with the rewritten URL. By passing
    // `request` as init we preserve method, headers, body, and signal.
    const outboundRequest = new Request(outboundUrl.toString(), request);

    // Cloud Run validates the Host header against the service domain.
    // Setting it explicitly so the proxy isn't seen as an open relay.
    outboundRequest.headers.set('host', upstream.host);

    // Preserve the original hostname for the API's own logging.
    outboundRequest.headers.set(
      'x-forwarded-host',
      request.headers.get('host') ?? 'api-candidate.fs-suite.com',
    );

    return fetch(outboundRequest);
  },
};
