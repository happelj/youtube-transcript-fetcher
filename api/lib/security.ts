/// <reference lib="dom" />

function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function normalizeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function getRequestOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  const protocol =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ??
    requestUrl.protocol.replace(/:$/, "");
  const host =
    firstHeaderValue(request.headers.get("x-forwarded-host")) ??
    request.headers.get("host") ??
    requestUrl.host;

  return `${protocol}://${host}`;
}

function hasCrossSiteFetchMetadata(request: Request): boolean {
  return request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site";
}

export function isTrustedSameOriginRequest(request: Request): boolean {
  if (hasCrossSiteFetchMetadata(request)) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  const requestOrigin = normalizeOrigin(getRequestOrigin(request));
  const headerOrigin = normalizeOrigin(origin);

  return Boolean(
    requestOrigin && headerOrigin && requestOrigin === headerOrigin,
  );
}

export function rejectUntrustedSameOriginRequest(
  request: Request,
  headers?: HeadersInit,
): Response | undefined {
  if (isTrustedSameOriginRequest(request)) {
    return undefined;
  }

  return Response.json(
    {
      error: "Cross-origin requests are not allowed for this action.",
    },
    {
      status: 403,
      headers,
    },
  );
}
