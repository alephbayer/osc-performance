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

async function ml(path: string, token: string, extra: Record<string, string> = {}) {
  const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...extra } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ML ${path.split("?")[0]} → ${r.status} ${d.message || d.error || ""}`.trim());
  return d;
}

const brDay = (d: Date | string) => new Date(d).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
async function pushAdmins(title: string, items: any[]) {
  const names = items.slice(0, 3).map((i) => String(i.title || "").slice(0, 48));
  const body = names.join(" · ") + (items.length > 3 ? ` +${items.length - 3}` : "");
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({ adminAll: true, title, body, url: "/?" }),
  });
}
// avisa gestor/administrador: saiu para entrega, chega hoje, entregue (cada item só uma vez)
async function notifyDeliveries(orderIds: string[]) {
  const { data } = await sb.from("ml_purchase_items")
    .select("id,title,ship_status,ship_substatus,eta_at,delivered_at,notif_route_at,notif_today_at,notif_delivered_at")
    .in("ml_order_id", orderIds);
  const rows = data || [];
  const today = brDay(new Date());
  const live = ["pending", "handling", "ready_to_ship", "shipped"];
  const route = rows.filter((r: any) => r.ship_status === "shipped" && r.ship_substatus === "out_for_delivery" && !r.notif_route_at);
  const routeIds = new Set(route.map((r: any) => r.id));
  const dueToday = rows.filter((r: any) => live.includes(r.ship_status) && r.eta_at && brDay(r.eta_at) === today && !r.notif_today_at && !r.notif_route_at && !routeIds.has(r.id));
  const done = rows.filter((r: any) => r.ship_status === "delivered" && r.delivered_at && Date.now() - new Date(r.delivered_at).getTime() < 24 * 3600000 && !r.notif_delivered_at);
  const now = new Date().toISOString();
  if (route.length) { await pushAdmins(route.length > 1 ? `🚚 ${route.length} peças saíram para entrega` : "🚚 Peça saiu para entrega", route); await sb.from("ml_purchase_items").update({ notif_route_at: now, notif_today_at: now }).in("id", route.map((r: any) => r.id)); }
  if (dueToday.length) { await pushAdmins(dueToday.length > 1 ? `📦 ${dueToday.length} peças chegam hoje` : "📦 Peça chega hoje", dueToday); await sb.from("ml_purchase_items").update({ notif_today_at: now }).in("id", dueToday.map((r: any) => r.id)); }
  if (done.length) { await pushAdmins(done.length > 1 ? `✅ ${done.length} peças entregues` : "✅ Peça entregue", done); await sb.from("ml_purchase_items").update({ notif_delivered_at: now }).in("id", done.map((r: any) => r.id)); }
  return route.length + dueToday.length + done.length;
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
  { const seenO = new Set<string>(); const uniq = orders.filter((o) => !seenO.has(String(o.id)) && (seenO.add(String(o.id)), true)); orders.length = 0; orders.push(...uniq); }
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
  const { data: ex } = await sb.from("ml_purchase_items").select("ml_order_id,ml_item_id,variation_id,ship_status,status_at,shipped_at,delivered_at,ship_history,ship_substatus,eta_at").in("ml_order_id", orderIds);
  const known = new Set((ex || []).map((x: any) => `${x.ml_order_id}|${x.ml_item_id}|${x.variation_id}`));
  const delivered = new Set((ex || []).filter((x: any) => (x.ship_status === "delivered" || x.ship_status === "cancelled") && Array.isArray(x.ship_history) && x.ship_history.length).map((x: any) => x.ml_order_id));
  const ship: Record<string, any> = {};
  // pedidos que não foram reconsultados mantêm o que já está salvo (o upsert em lote não pode zerar colunas)
  for (const x of ex || []) if (!ship[x.ml_order_id] && x.ship_status !== undefined) ship[x.ml_order_id] = { status: x.ship_status, at: x.status_at, shipped: x.shipped_at, delivered: x.delivered_at, hist: x.ship_history, sub: x.ship_substatus, eta: x.eta_at };
  const todo = orders
    .filter((o) => o.shipping?.id && !delivered.has(String(o.id)))
    .sort((a, b) => (ship[String(a.id)]?.status ? 1 : 0) - (ship[String(b.id)]?.status ? 1 : 0))
    .slice(0, 120);
  const fetchShip = async (o: any) => {
    const sid = o.shipping.id;
    const hdr = { "x-format-new": "true" };
    try {
      const s = await ml(`/shipments/${sid}`, t.access_token, hdr);
      let hist: { status: string; date: string }[] = [];
      try {
        const hr = await ml(`/shipments/${sid}/history`, t.access_token, hdr);
        const arr = Array.isArray(hr) ? hr : (hr.history || hr.results || hr.data || []);
        hist = arr.map((e: any) => ({ status: e.status, date: e.date_created || e.date || e.date_time })).filter((e: any) => e.status && e.date);
      } catch { /* histórico é opcional */ }
      const sh = s.status_history || {};
      const add = (st: string, d: any) => { if (d && !hist.find((e) => e.status === st)) hist.push({ status: st, date: d }); };
      add("handling", sh.date_handling); add("ready_to_ship", sh.date_ready_to_ship); add("shipped", sh.date_shipped); add("delivered", sh.date_delivered);
      hist.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const seen = new Set<string>();
      hist = hist.filter((e) => !seen.has(e.status) && (seen.add(e.status), true));
      const first = (st: string) => hist.find((e) => e.status === st)?.date || null;
      const status = s.status || "";
      const at = first(status) || s.last_updated || null;
      if (!hist.length && status && at) hist = [{ status, date: at }];
      const lt = s.lead_time || {}, so = s.shipping_option || {};
      const eta = lt.estimated_delivery_final?.date || lt.estimated_delivery_time?.date || so.estimated_delivery_final?.date || so.estimated_delivery_time?.date || null;
      ship[String(o.id)] = { status, at, shipped: first("shipped"), delivered: first("delivered") || (status === "delivered" ? at : null), hist, sub: s.substatus || null, eta };
    } catch { /* opcional */ }
  };
  for (let i = 0; i < todo.length; i += 8) await Promise.all(todo.slice(i, i + 8).map(fetchShip));

  const rowMap = new Map<string, any>();
  for (const o of orders) {
    for (const it of o.order_items || []) {
      const iid = String(it.item?.id || "");
      if (!iid) continue;
      const key = `${o.id}|${iid}|${it.item?.variation_id ? String(it.item.variation_id) : ""}`;
      if (rowMap.has(key)) { rowMap.get(key).qty += Number(it.quantity) || 1; continue; }
      rowMap.set(key, {
        ml_order_id: String(o.id),
        ml_item_id: iid,
        variation_id: it.item?.variation_id ? String(it.item.variation_id) : "",
        title: it.item?.title || "",
        qty: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price) || 0,
        ordered_at: o.date_created,
        order_status: o.status,
        ship_status: ship[String(o.id)]?.status ?? null,
        status_at: ship[String(o.id)]?.at ?? null,
        shipped_at: ship[String(o.id)]?.shipped ?? null,
        delivered_at: ship[String(o.id)]?.delivered ?? null,
        ship_history: ship[String(o.id)]?.hist ?? null,
        ship_substatus: ship[String(o.id)]?.sub ?? null,
        eta_at: ship[String(o.id)]?.eta ?? null,
        paid_at: ((o.payments || []).map((p: any) => p.date_approved).filter(Boolean).sort()[0]) || null,
        seller: o.seller?.nickname || null,
        permalink: info[iid]?.permalink || null,
        thumbnail: info[iid]?.thumbnail || null,
      });
    }
  }
  const rows: any[] = [...rowMap.values()];
  const added = rows.filter((r) => !known.has(`${r.ml_order_id}|${r.ml_item_id}|${r.variation_id}`)).length;
  // upsert só com colunas do ML: destino (vehicle/task/stock) nunca é sobrescrito
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await sb.from("ml_purchase_items").upsert(rows.slice(i, i + 100), { onConflict: "ml_order_id,ml_item_id,variation_id" });
    if (error) throw new Error(error.message);
  }
  await sb.from("ml_tokens").update({ last_sync_at: new Date().toISOString() }).eq("id", 1);
  let notified = 0;
  try { notified = await notifyDeliveries(orderIds); } catch (e) { warn = warn || "push: " + (e as Error).message; }
  return { ok: true, added, orders: orders.length, warn, notified };
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
