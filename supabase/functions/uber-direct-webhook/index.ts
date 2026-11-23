// Uber Direct: recebe os webhooks (event.delivery_status e event.courier_update) e atualiza deliveries_99.
// Sem JWT (quem chama é a Uber); autenticidade pela assinatura HMAC-SHA256 do corpo com UBER_WEBHOOK_SIGNING_KEY,
// no cabeçalho x-uber-signature (ou x-postmates-signature). Sem a chave configurada, nada é aceito.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const STATUS: Record<string, string> = {
  pending: "requested", pickup: "pickup", pickup_complete: "delivering", dropoff: "delivering",
  delivered: "delivered", canceled: "canceled", returned: "returned",
};

async function hmacHex(key: string, raw: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(raw)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const key = Deno.env.get("UBER_WEBHOOK_SIGNING_KEY");
  if (!key) return new Response("not configured", { status: 503 });

  const raw = await req.text(); // corpo cru: a assinatura é calculada sobre ele, sem reparsear
  const sig = (req.headers.get("x-uber-signature") || req.headers.get("x-postmates-signature") || "").toLowerCase();
  if (!sig || !safeEqual(await hmacHex(key, raw), sig)) return new Response("invalid signature", { status: 401 });

  let evt: Record<string, any>;
  try { evt = JSON.parse(raw); } catch { return new Response("invalid json", { status: 400 }); }

  try {
    const d = evt.data || {};
    const deliveryId = evt.delivery_id || d.id;
    const externalId = d.external_id;
    let q = sb.from("deliveries_99").select("id,status").eq("provider", "uber");
    q = deliveryId ? q.eq("api_order_id", deliveryId) : q.eq("external_order_id", externalId || "-");
    const { data: rows } = await q.limit(1);
    const row = rows?.[0];
    if (!row) return new Response(null, { status: 200 }); // entrega desconhecida: só confirma

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const c = d.courier || evt.courier || null;
    const loc = evt.location || c?.location;
    if (loc && (loc.lat || loc.lng)) { patch.courier_lat = loc.lat; patch.courier_lng = loc.lng; patch.courier_updated_at = new Date().toISOString(); }

    if (evt.kind === "event.delivery_status" || evt.status) {
      const st = STATUS[evt.status || d.status];
      if (st) patch.status = st;
      if (d.tracking_url) patch.tracking_url = d.tracking_url;
      if (d.dropoff_eta) patch.eta = d.dropoff_eta;
      if (typeof d.fee === "number") patch.cost = Math.round(d.fee) / 100;
      if (c) {
        if (c.name) patch.driver_name = c.name;
        if (c.vehicle_license_plate) patch.driver_plate = c.vehicle_license_plate;
        const ph = c.public_phone_info?.formatted_phone_number || c.phone_number;
        if (ph) patch.driver_phone = ph;
      }
      if (st === "delivered") patch.delivered_at = d.dropoff?.status_timestamp || new Date().toISOString();
      if (d && d.id) patch.api_payload = d;
    }
    await sb.from("deliveries_99").update(patch).eq("id", row.id);
    return new Response(null, { status: 200 });
  } catch (e) {
    console.error("uber webhook", e);
    return new Response("error", { status: 500 }); // a Uber tenta de novo
  }
});
