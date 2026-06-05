/// <reference lib="dom" />

import {
  createDeleteOpenAiKeyCookie,
  createOpenAiKeyCookie,
  getOpenAiKeyStatus,
  isValidOpenAiApiKey,
} from "./lib/openai-key.js";
import { rejectUntrustedSameOriginRequest } from "./lib/security.js";

const responseHeaders = {
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

function jsonResponse(
  statusCode: number,
  body: Record<string, unknown>,
  headers?: HeadersInit,
): Response {
  return Response.json(body, {
    status: statusCode,
    headers: {
      ...responseHeaders,
      ...headers,
    },
  });
}

function isSaveKeyBody(value: unknown): value is { apiKey: string } {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as Record<string, unknown>)["apiKey"] === "string";
}

export async function GET(request: Request): Promise<Response> {
  return jsonResponse(200, await getOpenAiKeyStatus(request));
}

export async function POST(request: Request): Promise<Response> {
  try {
    const rejection = rejectUntrustedSameOriginRequest(
      request,
      responseHeaders,
    );
    if (rejection) {
      return rejection;
    }

    const body = await request.json();

    if (!isSaveKeyBody(body) || !isValidOpenAiApiKey(body.apiKey)) {
      return jsonResponse(400, {
        error: "Enter a valid OpenAI API key.",
      });
    }

    const cookie = await createOpenAiKeyCookie(request, body.apiKey);
    return jsonResponse(
      200,
      {
        configured: true,
        source: "user",
        storageAvailable: true,
      },
      {
        "set-cookie": cookie,
      },
    );
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      return jsonResponse(400, {
        error: "Invalid JSON request body.",
      });
    }

    if (
      err instanceof Error &&
      err.message.includes("OPENAI_KEY_ENCRYPTION_SECRET")
    ) {
      return jsonResponse(503, {
        error:
          "OpenAI key storage is not configured. Add OPENAI_KEY_ENCRYPTION_SECRET in Vercel.",
      });
    }

    console.error("OpenAI key save error:", err);
    return jsonResponse(500, {
      error: "Could not save the OpenAI API key.",
    });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const rejection = rejectUntrustedSameOriginRequest(request, responseHeaders);
  if (rejection) {
    return rejection;
  }

  return jsonResponse(
    200,
    await getOpenAiKeyStatus(
      new Request(request.url, {
        headers: new Headers(),
      }),
    ),
    {
      "set-cookie": createDeleteOpenAiKeyCookie(request),
    },
  );
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: responseHeaders,
  });
}

export default {
  fetch(request: Request): Promise<Response> | Response {
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return OPTIONS();
    }

    if (method === "GET") {
      return GET(request);
    }

    if (method === "POST") {
      return POST(request);
    }

    if (method === "DELETE") {
      return DELETE(request);
    }

    return jsonResponse(405, { error: "Method not allowed." });
  },
};
