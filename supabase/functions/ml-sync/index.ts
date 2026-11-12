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

const normT = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const toksT = (s: string) => new Set(normT(s).split(" ").filter((w) => w.length > 1));
const codesOf = (link: string) => new Set((String(link || "").toUpperCase().match(/MLBU?-?\d{5,}/g) || []).map((c) => c.replace("-", "")));
// vincula compras do ML a pedidos de compra "comprados": por código do anúncio (certo) ou por nome+valor (só se único)
async function linkOrders() {
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const { data: items } = await sb.from("ml_purchase_items")
    .select("id,ml_item_id,user_product_id,catalog_product_id,title,qty,unit_price,destination")
    .is("link_type", null).neq("order_status", "cancelled").gte("ordered_at", since);
  if (!items?.length) return 0;
  const { data: used } = await sb.from("ml_purchase_items").select("link_type,link_id").not("link_type", "is", null);
  const usedSet = new Set((used || []).map((x: any) => `${x.link_type}:${x.link_id}`));
  const { data: pos } = await sb.from("purchase_orders").select("id,part_name,quantity,cost_price,link,vehicle_id,task_id").eq("status", "bought");
  const { data: invs } = await sb.from("investments").select("id,name,quantity,value,link").eq("status", "bought");
  const cands = [
    ...(pos || []).map((p: any) => ({ type: "po", id: p.id, name: p.part_name, qty: Number(p.quantity) || 1, unit: p.cost_price != null ? Number(p.cost_price) : null, link: p.link || "", po: p })),
    ...(invs || []).map((i: any) => ({ type: "inv", id: i.id, name: i.name, qty: Number(i.quantity) || 1, unit: i.value != null ? Number(i.value) : null, link: i.link || "", po: null })),
  ].filter((c) => !usedSet.has(`${c.type}:${c.id}`));
  if (!cands.length) return 0;
  const scored: { it: any; c: any; score: number }[] = [];
  for (const it of items) {
    const itCodes = [it.ml_item_id, it.user_product_id, it.catalog_product_id].filter(Boolean).map((x: string) => String(x).toUpperCase());
    const tIt = toksT(it.title);
    const mlTotal = (Number(it.qty) || 1) * (Number(it.unit_price) || 0);
    for (const c of cands) {
      let score = 0;
      if (itCodes.some((x) => codesOf(c.link).has(x))) score = 1;
      else {
        const tC = toksT(c.name);
        const small = Math.min(tIt.size, tC.size);
        let inter = 0; tC.forEach((w) => { if (tIt.has(w)) inter++; });
        const cont = small >= 2 ? inter / small : 0;
        const total = c.unit != null ? c.unit * c.qty : 0;
        const priceOk = !(total > 0) || Math.abs(mlTotal - total) / total <= 0.25;
        if (cont >= 0.8 && priceOk) score = 0.5 + cont * 0.4;
      }
      if (score > 0) scored.push({ it, c, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const takenIt = new Set<string>(), takenC = new Set<string>();
  const pairs: { it: any; c: any }[] = [];
  for (const m of scored) {
    if (takenIt.has(m.it.id) || takenC.has(`${m.c.type}:${m.c.id}`)) continue;
    const rival = scored.find((o) => o !== m && o.score >= m.score - 0.05 && ((o.it.id === m.it.id && o.c !== m.c) || (o.c === m.c && o.it.id !== m.it.id)));
    if (rival && m.score < 1) continue; // ambíguo: deixa para destinar à mão
    takenIt.add(m.it.id); takenC.add(`${m.c.type}:${m.c.id}`); pairs.push({ it: m.it, c: m.c });
  }
  if (!pairs.length) return 0;
  const vIds = [...new Set(pairs.map((p) => p.c.po?.vehicle_id).filter(Boolean))];
  const tIds = [...new Set(pairs.map((p) => p.c.po?.task_id).filter(Boolean))];
  const { data: vs } = vIds.length ? await sb.from("vehicles").select("id,model,plate").in("id", vIds) : { data: [] as any[] };
  const { data: ts } = tIds.length ? await sb.from("tasks").select("id,label").in("id", tIds) : { data: [] as any[] };
  const now = new Date().toISOString();
  for (const { it, c } of pairs) {
    const patch: Record<string, unknown> = { link_type: c.type, link_id: c.id, link_label: String(c.name || "").slice(0, 120) };
    // pedido feito para um veículo: a peça já nasce destinada a ele (pedido avulso fica sem destino até a entrega)
    if (c.type === "po" && c.po?.vehicle_id && !it.destination) {
      const v = (vs || []).find((x: any) => x.id === c.po.vehicle_id);
      const tk = (ts || []).find((x: any) => x.id === c.po.task_id);
      Object.assign(patch, { destination: "vehicle", vehicle_id: c.po.vehicle_id, vehicle_label: v ? `${v.model || ""} · ${v.plate || ""}`.trim() : null, task_id: c.po.task_id ? String(c.po.task_id) : null, task_label: tk?.label || null, assigned_by: "Pedido de compra", assigned_at: now });
    }
    await sb.from("ml_purchase_items").update(patch).eq("id", it.id).is("link_type", null);
  }
  return pairs.length;
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
  let itemsErr = "";
  for (let i = 0; i < itemIds.length; i += 20) {
    try {
      const arr = await ml(`/items?ids=${itemIds.slice(i, i + 20).join(",")}&attributes=id,permalink,thumbnail,user_product_id,catalog_product_id`, t.access_token);
      for (const x of arr) { if (x.code === 200) info[x.body.id] = x.body; else if (!itemsErr) itemsErr = `anúncio ${x.code} ${x.body?.message || x.body?.error || ""}`.trim(); }
    } catch (e) { if (!itemsErr) itemsErr = (e as Error).message; }
  }
  // plano B: consulta anúncio por anúncio (alguns retornam 403 no lote); até 40 por rodada, só os que faltam
  const missing = itemIds.filter((id) => !info[id]).slice(0, 40);
  if (missing.length) {
    let fb = "";
    for (let i = 0; i < missing.length; i += 8) {
      await Promise.all(missing.slice(i, i + 8).map(async (id) => {
        try { const x = await ml(`/items/${id}?attributes=id,permalink,thumbnail,user_product_id,catalog_product_id`, t.access_token); if (x?.id) info[x.id] = x; }
        catch (e) { if (!fb) fb = (e as Error).message; }
      }));
    }
    if (fb && !itemsErr.includes(fb)) itemsErr = (itemsErr ? itemsErr + " | " : "") + fb;
  }
  if (itemIds.length && Object.keys(info).length < itemIds.length && itemsErr) warn = (warn ? warn + " · " : "") + `Detalhes de ${itemIds.length - Object.keys(info).length} anúncio(s) indisponíveis (` + itemsErr + ")";

  // status de entrega (só pedidos ainda não entregues)
  const orderIds = orders.map((o) => String(o.id));
  const { data: ex } = await sb.from("ml_purchase_items").select("id,is_split,ml_order_id,ml_item_id,variation_id,ship_status,status_at,shipped_at,delivered_at,ship_history,ship_substatus,eta_at,ml_key,ship_probe").in("ml_order_id", orderIds);
  const known = new Set((ex || []).map((x: any) => `${x.ml_order_id}|${x.ml_item_id}|${x.variation_id}`));
  const delivered = new Set((ex || []).filter((x: any) => (x.ship_status === "delivered" || x.ship_status === "cancelled") && Array.isArray(x.ship_history) && x.ship_history.length).map((x: any) => x.ml_order_id));
  const ship: Record<string, any> = {};
  // pedidos que não foram reconsultados mantêm o que já está salvo (o upsert em lote não pode zerar colunas)
  for (const x of ex || []) if (!ship[x.ml_order_id] && x.ship_status !== undefined) ship[x.ml_order_id] = { status: x.ship_status, at: x.status_at, shipped: x.shipped_at, delivered: x.delivered_at, hist: x.ship_history, sub: x.ship_substatus, eta: x.eta_at, key: x.ml_key, probe: x.ship_probe };
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
      // palavra-chave de entrega: varre o envio atrás de campos de código/senha (guarda só o que bate)
      const found: Record<string, string> = {};
      const walk = (v: any, path: string, depth: number) => {
        if (depth > 4 || v == null) return;
        if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); return; }
        if (typeof v === "object") { for (const k of Object.keys(v)) { if (/address|receiver_id|sender_id|tracking|zip|geolocation/i.test(k)) continue; walk(v[k], path ? `${path}.${k}` : k, depth + 1); } return; }
        if ((typeof v === "string" || typeof v === "number") && /(password|passcode|keyword|security|verification|delivery_code|pin|palavra|secret|handshake|code)/i.test(path.split(".").pop() || "")) found[path] = String(v).slice(0, 60);
      };
      walk(s, "", 0);
      const strict = Object.entries(found).find(([k, v]) => /(password|passcode|keyword|security_code|delivery_code|palavra|handshake)/i.test(k) && !/status/i.test(k) && /^[\w-]{3,20}$/.test(v));
      const probe = { keys: Object.keys(s).slice(0, 60), tags: s.tags || null, found };
      ship[String(o.id)] = { status, at, shipped: first("shipped"), delivered: first("delivered") || (status === "delivered" ? at : null), hist, sub: s.substatus || null, eta, key: strict ? strict[1] : (ship[String(o.id)]?.key ?? null), probe };
    } catch { /* opcional */ }
  };
  for (let i = 0; i < todo.length; i += 8) await Promise.all(todo.slice(i, i + 8).map(fetchShip));

  const rowMap = new Map<string, any>();
  for (const o of orders) {
    // frete pago no pedido (rateado entre os itens, proporcional ao valor de cada linha)
    const shipCost = (o.payments || []).reduce((sum: number, p: any) => sum + (Number(p.shipping_cost) || 0), 0);
    const orderSum = (o.order_items || []).reduce((sum: number, i: any) => sum + (Number(i.unit_price) || 0) * (Number(i.quantity) || 1), 0);
    for (const it of o.order_items || []) {
      const iid = String(it.item?.id || "");
      if (!iid) continue;
      const lineFreight = orderSum > 0 ? Math.round(shipCost * (((Number(it.unit_price) || 0) * (Number(it.quantity) || 1)) / orderSum) * 100) / 100 : 0;
      const key = `${o.id}|${iid}|${it.item?.variation_id ? String(it.item.variation_id) : ""}`;
      if (rowMap.has(key)) { const r = rowMap.get(key); r.qty += Number(it.quantity) || 1; r.freight = Math.round((r.freight + lineFreight) * 100) / 100; continue; }
      rowMap.set(key, {
        ml_order_id: String(o.id),
        ml_item_id: iid,
        variation_id: it.item?.variation_id ? String(it.item.variation_id) : "",
        title: it.item?.title || "",
        qty: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price) || 0,
        freight: lineFreight,
        ordered_at: o.date_created,
        order_status: o.status,
        ship_status: ship[String(o.id)]?.status ?? null,
        status_at: ship[String(o.id)]?.at ?? null,
        shipped_at: ship[String(o.id)]?.shipped ?? null,
        delivered_at: ship[String(o.id)]?.delivered ?? null,
        ship_history: ship[String(o.id)]?.hist ?? null,
        ship_substatus: ship[String(o.id)]?.sub ?? null,
        eta_at: ship[String(o.id)]?.eta ?? null,
        ml_key: ship[String(o.id)]?.key ?? null,
        ship_probe: ship[String(o.id)]?.probe ?? null,
        paid_at: ((o.payments || []).map((p: any) => p.date_approved).filter(Boolean).sort()[0]) || null,
        seller: o.seller?.nickname || null,
        permalink: info[iid]?.permalink || `https://produto.mercadolivre.com.br/${iid.replace(/^MLB/, "MLB-")}`,
        thumbnail: info[iid]?.thumbnail || null,
        user_product_id: info[iid]?.user_product_id || it.item?.user_product_id || null,
        catalog_product_id: info[iid]?.catalog_product_id || null,
      });
    }
  }
  const rows: any[] = [...rowMap.values()];
  const added = rows.filter((r) => !known.has(`${r.ml_order_id}|${r.ml_item_id}|${r.variation_id}`)).length;
  // upsert só com colunas do ML: destino (vehicle/task/stock) nunca é sobrescrito
  // linhas divididas (destinadas em partes): qty/freight ficam como estão, só o resto é atualizado
  const splitKeys = new Set((ex || []).filter((x: any) => x.is_split).map((x: any) => `${x.ml_order_id}|${x.ml_item_id}|${x.variation_id}`));
  const isSplitRow = (r: any) => splitKeys.has(`${r.ml_order_id}|${r.ml_item_id}|${r.variation_id}`);
  const normal = rows.filter((r) => !isSplitRow(r));
  const splitRows = rows.filter(isSplitRow).map((r) => { const { qty: _q, freight: _f, ...rest } = r; return rest; });
  for (const grp of [normal, splitRows]) {
    for (let i = 0; i < grp.length; i += 100) {
      const { error } = await sb.from("ml_purchase_items").upsert(grp.slice(i, i + 100), { onConflict: "ml_order_id,ml_item_id,variation_id" });
      if (error) throw new Error(error.message);
    }
  }
  // partes já destinadas (variation_id "…#sN") herdam o status de entrega da linha de origem
  for (const c of (ex || []).filter((x: any) => String(x.variation_id).includes("#s"))) {
    const r = rowMap.get(`${c.ml_order_id}|${c.ml_item_id}|${String(c.variation_id).split("#s")[0]}`);
    if (!r) continue;
    await sb.from("ml_purchase_items").update({ order_status: r.order_status, ship_status: r.ship_status, status_at: r.status_at, shipped_at: r.shipped_at, delivered_at: r.delivered_at, ship_history: r.ship_history, ship_substatus: r.ship_substatus, eta_at: r.eta_at, ml_key: r.ml_key }).eq("id", c.id);
  }
  await sb.from("ml_tokens").update({ last_sync_at: new Date().toISOString() }).eq("id", 1);
  let linked = 0;
  try { linked = await linkOrders(); } catch (e) { warn = warn || "vínculo: " + (e as Error).message; }
  let notified = 0;
  try { notified = await notifyDeliveries(orderIds); } catch (e) { warn = warn || "push: " + (e as Error).message; }
  return { ok: true, added, orders: orders.length, warn, notified, linked };
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
