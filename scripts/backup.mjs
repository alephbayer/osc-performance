// Backup completo do OSC: todas as tabelas (JSON) + todos os arquivos do Storage.
// Uso:
//   SUPABASE_SERVICE_ROLE_KEY="..." node scripts/backup.mjs
// A chave fica só no seu terminal (Supabase > Project Settings > API > service_role). Nunca cole no chat.
// Saída: pasta backup-AAAA-MM-DD/ (tabelas/*.json, storage/<bucket>/..., RESUMO.txt)
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const URL = "https://lchfmoeyzgbepunetuch.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Defina SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const stamp = new Date().toISOString().slice(0, 10);
const root = `backup-${stamp}`;
fs.mkdirSync(path.join(root, "tabelas"), { recursive: true });
const resumo = [];

// 1) Descobre as tabelas pelo próprio PostgREST (OpenAPI)
const spec = await (await fetch(`${URL}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })).json();
const tabelas = Object.keys(spec.paths || {}).filter((p) => p !== "/" && !p.startsWith("/rpc/")).map((p) => p.slice(1)).sort();
console.log(`${tabelas.length} tabelas encontradas`);

for (const t of tabelas) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(t).select("*").range(from, from + 999);
    if (error) { console.error(`ERRO em ${t}:`, error.message); resumo.push(`${t}: ERRO ${error.message}`); break; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  fs.writeFileSync(path.join(root, "tabelas", `${t}.json`), JSON.stringify(rows));
  resumo.push(`${t}: ${rows.length} linhas`);
  console.log(`${t}: ${rows.length}`);
}

// 2) Storage: todos os buckets, recursivo
async function listar(bucket, prefix = "") {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 100, offset });
    if (error) throw error;
    for (const it of data) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) out.push(...(await listar(bucket, p)));
      else out.push(p);
    }
    if (data.length < 100) break;
  }
  return out;
}
const { data: buckets, error: be } = await sb.storage.listBuckets();
if (be) throw be;
for (const b of buckets) {
  const arquivos = await listar(b.name);
  let ok = 0, falhas = 0;
  for (const f of arquivos) {
    const { data, error } = await sb.storage.from(b.name).download(f);
    if (error) { falhas++; console.error(`falha ${b.name}/${f}: ${error.message}`); continue; }
    const dest = path.join(root, "storage", b.name, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
    ok++;
    if (ok % 100 === 0) console.log(`${b.name}: ${ok}/${arquivos.length}`);
  }
  resumo.push(`storage/${b.name}: ${ok} de ${arquivos.length} arquivos${falhas ? ` (${falhas} FALHAS)` : ""}`);
}
fs.writeFileSync(path.join(root, "RESUMO.txt"), resumo.join("\n") + "\n");
console.log("\nPronto. Confira RESUMO.txt em", root);
