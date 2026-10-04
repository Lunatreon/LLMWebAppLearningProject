// Durable spool only: objects are removed after the local backend commits them.
async function authorized(request, env) {
  if (!env.BRIDGE_SECRET || env.BRIDGE_SECRET.length < 32) return false;
  const digest = async text => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [a, b] = await Promise.all([digest(request.headers.get("Authorization") || ""), digest(`Bearer ${env.BRIDGE_SECRET}`)]);
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export default {
  async email(message, env) {
    if (message.to.toLowerCase() !== env.MAILBOX_ADDRESS.toLowerCase()) {
      message.setReject("Unknown mailbox"); return;
    }
    if (message.rawSize > 25 * 1024 * 1024) {
      message.setReject("Message exceeds 25 MiB"); return;
    }
    // Email streams do not expose the known length required by R2.put streams.
    // Buffer the bounded message to provide an exact byte length to R2.
    const raw = await new Response(message.raw).arrayBuffer();
    if (raw.byteLength > 25 * 1024 * 1024) {
      message.setReject("Message exceeds 25 MiB"); return;
    }
    // Await durable storage in the email handler; do not acknowledge via waitUntil.
    await env.MAIL_SPOOL.put(`mail/${crypto.randomUUID()}`, raw);
  },
  async fetch(request, env) {
    const headers = {"Cache-Control":"no-store"};
    if (!await authorized(request, env)) return new Response("Unauthorized", {status:401, headers});
    const path = new URL(request.url).pathname;
    if (path === "/messages" && request.method === "GET") {
      const result = await env.MAIL_SPOOL.list({prefix:"mail/", limit:20});
      return Response.json({keys:result.objects.map(o => o.key)}, {headers});
    }
    const match = path.match(/^\/messages\/(mail\/[a-f0-9-]{36})$/);
    if (!match) return new Response("Not found", {status:404, headers});
    if (request.method === "GET") {
      const object = await env.MAIL_SPOOL.get(match[1]);
      return object ? new Response(object.body, {headers:{...headers,"Content-Type":"application/octet-stream"}}) : new Response("Not found", {status:404, headers});
    }
    if (request.method === "DELETE") {
      await env.MAIL_SPOOL.delete(match[1]); return new Response(null, {status:204, headers});
    }
    return new Response("Method not allowed", {status:405, headers});
  }
};
