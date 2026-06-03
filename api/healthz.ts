/// <reference lib="dom" />

const responseHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: responseHeaders });
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: responseHeaders,
  });
}

export default {
  fetch(request: Request): Response {
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return OPTIONS();
    }

    if (method === "GET") {
      return GET();
    }

    return Response.json(
      { error: "Method not allowed." },
      { status: 405, headers: responseHeaders },
    );
  },
};
