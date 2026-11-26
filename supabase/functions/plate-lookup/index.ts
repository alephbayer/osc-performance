// Consulta de veículo pela placa (API Placas, consulta "completa": básico + motor + chassi + Renavam).
// Chamada pelo app (exige JWT). Secret: API_PLACAS_TOKEN; opcional PLATE_MAX_PER_DAY (padrão 30 consultas pagas / 24 h).
// Cache em public.plate_lookups: cada placa encontrada é paga uma vez só. Placa não encontrada e erros não são cobrados
// pelo provedor e não entram no cache. Não devolve dados do proprietário.
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API = "https://wdapi2.com.br/v3";
// CORS só barra navegadores; a trava real contra abuso é o limite diário (PLATE_MAX_PER_DAY)
const ALLOWED_ORIGINS = [/^https:\/\/osc-performance\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];

const corsFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.some((r) => r.test(origin)) ? origin : "null",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Vary": "Origin",
});

const PLATE_RE = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/; // ABC1234 ou ABC1D23
const normPlate = (p: unknown) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return !s || /^exemplo$/i.test(s) ? "" : s;
};
// "CROSSFOX" -> "Crossfox"; palavras com número ou siglas curtas ficam em maiúsculas (HB20, GTI, VW)
const titleWord = (w: string) => /\d/.test(w) || w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const title = (s: string) => s.split(/\s+/).filter(Boolean).map(titleWord).join(" ");
const colorTitle = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());

function fuelLabel(s: string) {
  const t = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t) return "";
  if (t.includes("alcool") && t.includes("gasolina")) return "Flex";
  if (t.includes("eletric") && (t.includes("gasolina") || t.includes("alcool"))) return "Híbrido";
  if (t.includes("diesel")) return "Diesel";
  if (t.includes("eletric")) return "Elétrico";
  if (t.includes("gasolina")) return "Gasolina";
  if (t.includes("alcool") || t.includes("etanol")) return "Etanol";
  return colorTitle(s);
}

// Versão FIPE ("M3 Coupê 4.0 32V") -> nome ("M3 Coupê") + motorização ("4.0 32V"), cortando na 1ª cilindrada
function splitVersion(full: string) {
  const m = full.match(/^(.*?)\s+(\d\.\d\b.*)$/);
  return m ? { name: m[1].trim(), engine: m[2].trim() } : { name: full.trim(), engine: "" };
}

// Siglas/grafias do Detran -> nome usado no cadastro da oficina
const BRANDS: Record<string, string> = {
  "VW": "Volkswagen", "VOLKSWAGEN": "Volkswagen", "GM": "Chevrolet", "CHEV": "Chevrolet", "CHEVROLET": "Chevrolet",
  "MB": "Mercedes-Benz", "M.BENZ": "Mercedes-Benz", "M BENZ": "Mercedes-Benz", "MBENZ": "Mercedes-Benz", "MERCEDES": "Mercedes-Benz", "MERCEDES BENZ": "Mercedes-Benz", "MERCEDES-BENZ": "Mercedes-Benz",
  "LR": "Land Rover", "LROVER": "Land Rover", "LAND ROVER": "Land Rover", "LANDROVER": "Land Rover",
  "KIA": "Kia", "JAC": "JAC", "BMW": "BMW", "MINI": "Mini", "RAM": "RAM", "BYD": "BYD", "GWM": "GWM",
  "CITROEN": "Citroën", "MMC": "Mitsubishi", "MITSUBISHI": "Mitsubishi", "HYUNDAI": "Hyundai", "TOYOTA": "Toyota",
  "ALFA ROMEO": "Alfa Romeo", "ROLLS ROYCE": "Rolls-Royce", "ASTON MARTIN": "Aston Martin", "HARLEY DAVIDSON": "Harley-Davidson",
};
const brandName = (s: string) => {
  const k = s.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  return BRANDS[k] || title(s);
};

// Converte a resposta do provedor no formato que o app usa
function normalize(j: Record<string, any>) {
  const b = j?.basico?.dados || {};
  const brand = clean(b.marca).replace(/^I\//i, "");
  let model = clean(b.modelo);
  if (!model && clean(b.marcamodelo).includes("/")) model = clean(b.marcamodelo).split("/").slice(1).join(" ");
  // modelo às vezes repete a marca ("VW CROSSFOX"): tira a repetição
  if (brand && model.toUpperCase().startsWith(brand.toUpperCase() + " ")) model = model.slice(brand.length + 1);
  const ccRaw = clean(b.cilindradas).replace(/\D/g, "");
  const cc = ccRaw && Number(ccRaw) >= 50 && Number(ccRaw) <= 20000 ? Number(ccRaw) : null;
  // A consulta completa traz candidatos FIPE com score (0-100) de semelhança; o maior vem primeiro
  const versions = (Array.isArray(j?.fipe?.dados) ? j.fipe.dados : [])
    .filter((f: any) => clean(f?.modelo))
    .map((f: any) => ({ full: clean(f.modelo), ...splitVersion(clean(f.modelo)), score: Number(f.score) || 0, fipeCode: clean(f.codigo_fipe), fipeValue: clean(f.valor), year: Number(f.ano) || null }))
    .sort((a: any, b: any) => b.score - a.score);
  return {
    versions,
    brand: brand ? brandName(brand) : "",
    model: title(model),
    year: parseInt(clean(b.ano)) || null,
    modelYear: parseInt(clean(b.anoModelo)) || null,
    color: colorTitle(clean(b.cor)),
    fuel: fuelLabel(clean(b.combustivel)),
    fuelRaw: clean(b.combustivel),
    engineCc: cc,
    power: clean(b.potencia),
    engineNumber: clean(j?.motor?.dados?.motor) || clean(b.motor),
    chassis: clean(j?.chassi?.dados?.chassi),
    renavam: clean(j?.renavam?.dados?.renavam),
    city: clean(b.municipio),
    uf: clean(b.uf),
    origin: clean(b.origem),
    type: clean(b.tipo),
  };
}

Deno.serve(async (req) => {
  const headers = { ...corsFor(req.headers.get("origin")), "Content-Type": "application/json" };
  const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return out({ error: "Use POST" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const plate = normPlate(body.plate);
    if (!PLATE_RE.test(plate)) return out({ error: "Placa inválida. Use o formato ABC1234 ou ABC1D23." }, 400);

    // 1) cache
    const { data: hit, error: hitErr } = await sb.from("plate_lookups").select("data,raw,fetched_at").eq("plate", plate).maybeSingle();
    if (hitErr) throw new Error(`Cache: ${hitErr.message}`);
    // normaliza de novo a partir da resposta original: melhorias na conversão valem também para placas já pagas
    if (hit) return out({ found: true, cached: true, plate, fetchedAt: hit.fetched_at, vehicle: hit.raw ? normalize(hit.raw) : hit.data });

    // 2) limite diário de consultas pagas
    const max = Number(Deno.env.get("PLATE_MAX_PER_DAY") || 30);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await sb.from("plate_lookups").select("plate", { count: "exact", head: true }).gte("fetched_at", since);
    if ((count || 0) >= max) return out({ error: `Limite de ${max} consultas pagas em 24 h atingido. Tente mais tarde ou peça ao gestor para aumentar.` }, 429);

    // 3) provedor
    const token = Deno.env.get("API_PLACAS_TOKEN");
    if (!token) return out({ error: "Consulta de placa ainda não configurada (falta o token da API Placas no Supabase)." }, 503);
    const r = await fetch(`${API}/completa/${plate}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 || j?.codigo === "placa_nao_encontrada") return out({ found: false, plate });
    if (!r.ok || j?.error === true) {
      const msg = r.status === 402 ? "Saldo da API Placas insuficiente." :
        r.status === 401 ? "Token da API Placas inválido." :
        r.status >= 500 ? "Serviço de consulta indisponível agora. Tente de novo em alguns minutos." :
        (j?.message || `Erro ${r.status}`);
      return out({ error: msg, code: j?.codigo || null, requestId: j?.request_id || null }, 502);
    }
    const vehicle = normalize(j);
    if (!vehicle.brand && !vehicle.model) return out({ found: false, plate });

    const { error: upErr } = await sb.from("plate_lookups").upsert({ plate, provider: "apiplacas", product: "completa", data: vehicle, raw: j, fetched_at: new Date().toISOString() });
    if (upErr) console.error("plate_lookups upsert", upErr.message);
    return out({ found: true, cached: false, plate, vehicle });
  } catch (e) {
    return out({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
