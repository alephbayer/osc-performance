// Exporta o schema (tabelas, constraints, índices, RLS, policies, funções, triggers, buckets) para schema.sql
// Uso: SUPABASE_SERVICE_ROLE_KEY="..." node scripts/schema.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Defina SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const sb = createClient("https://lchfmoeyzgbepunetuch.supabase.co", KEY, { auth: { persistSession: false } });
const { data, error } = await sb.rpc("osc_export_schema");
if (error) { console.error("Erro:", error.message); process.exit(1); }
const dir = fs.readdirSync(".").filter((d) => d.startsWith("backup-")).sort().pop();
const out = dir ? `${dir}/schema.sql` : "schema.sql";
fs.writeFileSync(out, data);
console.log(`Salvo em ${out} (${data.length} caracteres, ${(data.match(/create table public/g) || []).length} tabelas)`);
