// Uber Direct (entregas): cotar, pedir, atualizar e cancelar entregas pela API oficial.
// Chamada pelo app (exige JWT). Secrets: UBER_CLIENT_ID, UBER_CLIENT_SECRET, UBER_CUSTOMER_ID,
// opcional UBER_MAX_PER_DAY (padrão 10). Credenciais de teste => sandbox (nenhuma entrega real).
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API = "https://api.uber.com/v1";
// CORS só barra navegadores; a trava real contra abuso é o limite diário de pedidos (UBER_MAX_PER_DAY)
const ALLOWED_ORIGINS = [/^https:\/\/osc-performance\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];

const corsFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.some((r) => r.test(origin)) ? origin : "null",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
});

// Token em memória, preso às credenciais atuais: trocar os secrets (teste <-> produção) invalida o cache
let cachedToken: { token: string; exp: number; key: string } | null = null;
async function uberToken(): Promise<string> {
  const id = Deno.env.get("UBER_CLIENT_ID"), secret = Deno.env.get("UBER_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Credenciais da Uber não configuradas no Supabase");
  const key = `${id}:${secret}`;
  if (cachedToken && cachedToken.key === key && cachedToken.exp - Date.now() > 60 * 60 * 1000) return cachedToken.token;
  const r = await fetch("https://auth.uber.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials", scope: "eats.deliveries" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Uber recusou a autenticação (${r.status}${j.error ? ": " + j.error : ""}${j.error_description ? " - " + j.error_description : ""})`);
  cachedToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, key };
  return cachedToken.token;
}

async function uber(path: string, init: { method?: string; body?: unknown } = {}) {
  const cid = Deno.env.get("UBER_CUSTOMER_ID");
  if (!cid) throw new Error("UBER_CUSTOMER_ID não configurado no Supabase");
  const doFetch = async () => fetch(`${API}/customers/${cid}${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${await uberToken()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  let r = await doFetch();
  if (r.status === 401) { cachedToken = null; r = await doFetch(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Uber: ${j.message || j.code || r.status}`);
  return j;
}

type Addr = { street?: string; number?: string; complement?: string; district?: string; city?: string; state?: string; zip?: string; lat?: number; lng?: number };
// Coordenadas ajudam a Uber a achar o endereço (em algumas regiões são exigidas)
const coords = (prefix: string, a?: Addr) => (a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng)) && a.lat && a.lng)
  ? { [`${prefix}_latitude`]: Number(a.lat), [`${prefix}_longitude`]: Number(a.lng) } : {};
const addrJson = (a: Addr) => JSON.stringify({
  street_address: [[a.street, a.number].filter(Boolean).join(", "), [a.complement, a.district].filter(Boolean).join(" - ")],
  city: a.city || "", state: (a.state || "").toUpperCase(), zip_code: (a.zip || "").replace(/\D/g, ""), country: "BR",
});
const addrOk = (a?: Addr) => !!(a && a.street && a.city && a.state && a.zip);
const phoneE164 = (p?: string) => {
  const d = String(p || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) return `+${d}`;
  return `+55${d}`;
};

const STATUS: Record<string, string> = {
  pending: "requested", pickup: "pickup", pickup_complete: "delivering", dropoff: "delivering",
  delivered: "delivered", canceled: "canceled", returned: "returned",
};

// Converte o objeto "delivery" da Uber nos campos da tabela
function patchFromDelivery(d: Record<string, any>) {
  const c = d.courier || null;
  const p: Record<string, unknown> = {
    api_order_id: d.id,
    status: STATUS[d.status] || "requested",
    tracking_url: d.tracking_url || null,
    eta: d.dropoff_eta || null,
    api_payload: d,
    api_error: null,
    updated_at: new Date().toISOString(),
  };
  if (typeof d.fee === "number") p.cost = Math.round(d.fee) / 100;
  if (c) {
    p.driver_name = c.name || null;
    p.driver_plate = c.vehicle_license_plate || null;
    p.driver_phone = c.public_phone_info?.formatted_phone_number || c.phone_number || null;
    if (c.location && (c.location.lat || c.location.lng)) {
      p.courier_lat = c.location.lat; p.courier_lng = c.location.lng; p.courier_updated_at = new Date().toISOString();
    }
  }
  if (d.status === "delivered") p.delivered_at = d.dropoff?.status_timestamp || new Date().toISOString();
  return p;
}

async function getRow(id: string) {
  const { data, error } = await sb.from("deliveries_99").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Entrega não encontrada");
  if (data.provider !== "uber") throw new Error("Esta entrega não é da Uber");
  return data;
}

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get("origin"));
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  try {
    const body = await req.json();
    const action = String(body.action || "");

    if (action === "status") {
      const ok = !!(Deno.env.get("UBER_CLIENT_ID") && Deno.env.get("UBER_CLIENT_SECRET") && Deno.env.get("UBER_CUSTOMER_ID"));
      return json({ configured: ok, webhook: !!Deno.env.get("UBER_WEBHOOK_SIGNING_KEY") });
    }

    if (action === "quote") {
      const { pickup, dropoff } = body as { pickup: Addr; dropoff: Addr };
      if (!addrOk(pickup) || !addrOk(dropoff)) throw new Error("Preencha rua, cidade, UF e CEP da coleta e do destino");
      const q = await uber("/delivery_quotes", { method: "POST", body: { pickup_address: addrJson(pickup), dropoff_address: addrJson(dropoff), ...coords("pickup", pickup), ...coords("dropoff", dropoff) } });
      return json({ quote_id: q.id, fee: typeof q.fee === "number" ? q.fee / 100 : null, currency: q.currency, dropoff_eta: q.dropoff_eta, duration: q.duration, pickup_duration: q.pickup_duration, expires: q.expires });
    }

    if (action === "create") {
      const row = await getRow(String(body.id));
      if (row.api_order_id) throw new Error("Esta entrega já foi pedida à Uber");
      if (!addrOk(row.pickup_address) || !addrOk(row.dropoff_address)) throw new Error("Endereços incompletos");
      if (!row.pickup_phone || !row.dropoff_phone) throw new Error("Informe o telefone da coleta e do destino");
      // Trava contra uso indevido: limite de pedidos por dia
      const max = Number(Deno.env.get("UBER_MAX_PER_DAY") || 10);
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await sb.from("deliveries_99").select("id", { count: "exact", head: true })
        .eq("provider", "uber").not("api_order_id", "is", null).gte("created_at", since);
      if ((count || 0) >= max) throw new Error(`Limite de ${max} pedidos à Uber em 24 h atingido`);

      const sizes = ["small", "medium", "large", "xlarge"];
      const d = await uber("/deliveries", {
        method: "POST",
        body: {
          quote_id: body.quote_id || undefined,
          pickup_address: addrJson(row.pickup_address), pickup_name: row.pickup_name || "OSC Group", pickup_phone_number: phoneE164(row.pickup_phone),
          dropoff_address: addrJson(row.dropoff_address), dropoff_name: row.dropoff_name || row.destination || "Destinatário", dropoff_phone_number: phoneE164(row.dropoff_phone),
          dropoff_notes: row.notes || undefined,
          ...coords("pickup", row.pickup_address), ...coords("dropoff", row.dropoff_address),
          manifest_items: [{ name: row.description || "Encomenda", quantity: 1, size: sizes.includes(row.package_size) ? row.package_size : "small" }],
          external_id: row.id,
        },
      });
      const patch = { ...patchFromDelivery(d), external_order_id: row.id, source: "api" };
      const { data, error } = await sb.from("deliveries_99").update(patch).eq("id", row.id).select().single();
      if (error) throw error;
      return json({ row: data });
    }

    if (action === "refresh" || action === "cancel") {
      const row = await getRow(String(body.id));
      if (!row.api_order_id) throw new Error("Esta entrega não foi pedida pela API");
      const d = action === "cancel"
        ? await uber(`/deliveries/${row.api_order_id}/cancel`, { method: "POST", body: {} })
        : await uber(`/deliveries/${row.api_order_id}`);
      const { data, error } = await sb.from("deliveries_99").update(patchFromDelivery(d)).eq("id", row.id).select().single();
      if (error) throw error;
      return json({ row: data });
    }

    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 400);
  }
});
