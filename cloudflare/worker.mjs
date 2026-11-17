const mcpMetadata = "/.well-known/oauth-protected-resource/MediPoli/mcp";

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const isVideo = incoming.hostname === "video.aisergio.dev";
    const isMediPoliHost = incoming.hostname === "aisergio.dev" || isVideo;
    const isProjectPath = incoming.pathname === "/MediPoli" || incoming.pathname.startsWith("/MediPoli/");
    if (!isMediPoliHost || (!isProjectPath && (isVideo || incoming.pathname !== mcpMetadata))) {
      // fetch mantiene el origen existente de cualquier ruta fuera del prefijo.
      return fetch(request);
    }
    if (!/^[a-z0-9-]+\.cloudfront\.net$/i.test(env.CLOUDFRONT_HOST ?? "")) return new Response("Origen aún no configurado.", { status: 503 });
    if (isVideo && !["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });

    const target = new URL(request.url);
    target.hostname = env.CLOUDFRONT_HOST;
    target.protocol = "https:";
    if (isVideo) target.pathname = "/MediPoli/videos" + incoming.pathname.slice("/MediPoli".length);
    if (incoming.pathname === "/MediPoli") {
      const canonical = new URL(request.url);
      canonical.pathname += "/";
      return Response.redirect(canonical, 308);
    }
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cookie");
    const forwarded = new Request(target, {
      method: request.method, headers, body: request.body, redirect: "manual",
      ...(request.body ? { duplex: "half" } : {})
    });
    const dynamic = incoming.pathname === mcpMetadata || incoming.pathname.startsWith("/MediPoli/api/") || incoming.pathname === "/MediPoli/mcp";
    return fetch(forwarded, dynamic ? { cf: { cacheTtl: 0, cacheEverything: false } } : undefined);
  }
};
