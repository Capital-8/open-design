import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Sandboxed iframes have an opaque origin: SameSite login cookies are absent
// on subresource requests. Grant only short-lived reads of one shipped resource
// owner (plugin, or a namespaced design-system ID),
// never API access, user files, or same-origin script privileges. Restart revokes
// tickets; distributed static resource delivery is tracked separately (POC-023).
export class PreviewTickets {
  private readonly key = randomBytes(32);
  issue(pluginId: string) {
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    return `${expiry}.${this.signature(pluginId, expiry)}`;
  }
  allows(pluginId: string, ticket: unknown): boolean {
    if (typeof ticket !== "string" || !/^\d{10}\.[a-f0-9]{64}$/.test(ticket))
      return false;
    const [raw, signature] = ticket.split(".");
    const expiry = Number(raw),
      now = Math.floor(Date.now() / 1000);
    if (expiry <= now || expiry > now + 3600) return false;
    return timingSafeEqual(
      Buffer.from(signature!, "hex"),
      Buffer.from(this.signature(pluginId, expiry), "hex"),
    );
  }
  private signature(id: string, expiry: number) {
    return createHmac("sha256", this.key)
      .update(JSON.stringify([id, expiry]))
      .digest("hex");
  }
}
