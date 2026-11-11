// Mercado Livre → compras da conta (OSC). Tokens ficam só aqui (tabela ml_tokens sem acesso anon).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const CLIENT_ID = Deno.env.get("ML_CLIENT_ID") || "8912570457105160";
const CLIENT_SECRET = Deno.env.get("ML_CLIENT_SECRET") || "";
const REDIRECT = Deno.env.get("ML_REDIRECT_URI") || "https://osc-performance.vercel.app/";
const API = "https://api.mercadolibre.com";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function tokenCall(params: Record<string, string>) {
  if (!CLIENT_SECRET) throw new Error("Chave secreta (ML_CLIENT_SECRET) ainda não cadastrada no Supabase.");
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Livre recusou a autorização (${d.error || r.status}${d.message ? ": " + d.message : ""})`);
  return d;
}

async function saveTokens(d: any, extra: Record<string, unknown> = {}) {
  const row = {
    id: 1,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expires_at: new Date(Date.now() + (Number(d.expires_in) || 21600) * 1000).toISOString(),
    ml_user_id: d.user_id != null ? String(d.user_id) : undefined,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  Object.keys(row).forEach((k) => (row as any)[k] === undefined && delete (row as any)[k]);
  const { error } = await sb.from("ml_tokens").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

async function getAccess() {
  const { data } = await sb.from("ml_tokens").select("*").eq("id", 1).maybeSingle();
  if (!data?.refresh_token) throw new Error("NOT_CONNECTED");
  if (data.access_token && data.expires_at && new Date(data.expires_at).getTime() - Date.now() > 120000) return data;
  let d;
  try { d = await tokenCall({ grant_type: "refresh_token", refresh_token: data.refresh_token }); }
  catch (e) { throw new Error("EXPIRED: " + (e as Error).message); }
  await saveTokens(d);
  return { ...data, access_token: d.access_token, ml_user_id: data.ml_user_id || String(d.user_id) };
}

async function ml(path: string, token: string) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ML ${path.split("?")[0]} → ${r.status} ${d.message || d.error || ""}`.trim());
  return d;
}

async function sync(days: number) {
  const t = await getAccess();
  const uid = t.ml_user_id;
  const cutoff = Date.now() - days * 86400000;
  const orders: any[] = [];
  let offset = 0, stop = false, warn = "";
  while (!stop && offset < 400) {
    let page;
    try { page = await ml(`/orders/search?buyer=${uid}&sort=date_desc&limit=50&offset=${offset}`, t.access_token); }
    catch (e) { if (offset === 0) throw e; warn = (e as Error).message; break; }
    const rs = page.results || [];
    for (const o of rs) {
      if (new Date(o.date_created).getTime() < cutoff) { stop = true; break; }
      orders.push(o);
    }
    if (rs.length < 50) break;
    offset += 50;
  }
  if (!orders.length) { await sb.from("ml_tokens").update({ last_sync_at: new Date().toISOString() }).eq("id", 1); return { ok: true, added: 0, orders: 0, warn }; }

  // detalhes dos anúncios (link e miniatura)
  const itemIds = [...new Set(orders.flatMap((o) => (o.order_items || []).map((i: any) => i.item?.id)).filter(Boolean))] as string[];
  const info: Record<string, any> = {};
  for (let i = 0; i < itemIds.length; i += 20) {
    try {
      const arr = await ml(`/items?ids=${itemIds.slice(i, i + 20).join(",")}&attributes=id,permalink,thumbnail`, t.access_token);
      for (const x of arr) if (x.code === 200) info[x.body.id] = x.body;
    } catch { /* link é opcional */ }
  }

  // status de entrega (só pedidos ainda não entregues)
  const orderIds = orders.map((o) => String(o.id));
  const { data: ex } = await sb.from("ml_purchase_items").select("ml_order_id,ml_item_id,variation_id,ship_status").in("ml_order_id", orderIds);
  const known = new Set((ex || []).map((x: any) => `${x.ml_order_id}|${x.ml_item_id}|${x.variation_id}`));
  const delivered = new Set((ex || []).filter((x: any) => x.ship_status === "delivered").map((x: any) => x.ml_order_id));
  const ship: Record<string, string> = {};
  let n = 0;
  for (const o of orders) {
    const sid = o.shipping?.id;
    if (!sid || delivered.has(String(o.id)) || n >= 40) continue;
    n++;
    try { const s = await ml(`/shipments/${sid}`, t.access_token); ship[String(o.id)] = s.status || ""; } catch { /* opcional */ }
  }

  const rows: any[] = [];
  for (const o of orders) {
    for (const it of o.order_items || []) {
      const iid = String(it.item?.id || "");
      if (!iid) continue;
      rows.push({
        ml_order_id: String(o.id),
        ml_item_id: iid,
        variation_id: it.item?.variation_id ? String(it.item.variation_id) : "",
        title: it.item?.title || "",
        qty: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price) || 0,
        ordered_at: o.date_created,
        order_status: o.status,
        ...(ship[String(o.id)] !== undefined ? { ship_status: ship[String(o.id)] } : {}),
        seller: o.seller?.nickname || null,
        permalink: info[iid]?.permalink || null,
        thumbnail: info[iid]?.thumbnail || null,
      });
    }
  }
  const added = rows.filter((r) => !known.has(`${r.ml_order_id}|${r.ml_item_id}|${r.variation_id}`)).length;
  // upsert só com colunas do ML: destino (vehicle/task/stock) nunca é sobrescrito
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await sb.from("ml_purchase_items").upsert(rows.slice(i, i + 100), { onConflict: "ml_order_id,ml_item_id,variation_id" });
    if (error) throw new Error(error.message);
  }
  await sb.from("ml_tokens").update({ last_sync_at: new Date().toISOString() }).eq("id", 1);
  return { ok: true, added, orders: orders.length, warn };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "status";
    const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=osc_ml`;

    if (action === "status") {
      const { data } = await sb.from("ml_tokens").select("nickname,ml_user_id,last_sync_at,refresh_token").eq("id", 1).maybeSingle();
      return json({ ok: true, connected: !!data?.refresh_token, nickname: data?.nickname || null, lastSync: data?.last_sync_at || null, hasSecret: !!CLIENT_SECRET, authUrl });
    }
    if (action === "connect") {
      if (!body.code) return json({ ok: false, error: "Código de autorização ausente" }, 400);
      const d = await tokenCall({ grant_type: "authorization_code", code: String(body.code), redirect_uri: REDIRECT });
      let nickname = null;
      try { const me = await ml("/users/me", d.access_token); nickname = me.nickname || null; } catch { /* opcional */ }
      await saveTokens(d, { nickname });
      return json({ ok: true, connected: true, nickname });
    }
    if (action === "sync") {
      return json(await sync(Math.min(Math.max(Number(body.days) || 90, 7), 365)));
    }
    if (action === "disconnect") {
      await sb.from("ml_tokens").delete().eq("id", 1);
      return json({ ok: true });
    }
    return json({ ok: false, error: "Ação inválida" }, 400);
  } catch (e) {
    const m = (e as Error).message || String(e);
    if (m === "NOT_CONNECTED") return json({ ok: false, code: "NOT_CONNECTED", error: "Conta do Mercado Livre não conectada" });
    if (m.startsWith("EXPIRED")) return json({ ok: false, code: "EXPIRED", error: "A autorização expirou — conecte de novo" });
    return json({ ok: false, error: m });
  }
});
