import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LABOR_RATE = 380;

async function webSearch(query: string): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "pt-BR,pt;q=0.9" }
    });
    const html = await r.text();
    // Extract result snippets from DDG HTML
    const snippets: string[] = [];
    const re = /<a class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null && snippets.length < 4) {
      const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text.length > 30) snippets.push(text);
    }
    return snippets.join(" | ");
  } catch (e) {
    console.error("DDG search error:", e);
    return "";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { description, model, year } = await req.json();
    const vehicleLabel = [model, year].filter(Boolean).join(" ");

    // 1. Histórico da oficina
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
    );

    let historyContext = "";
    try {
      const keywords = description.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      const { data: tasks } = await supabase
        .from("tasks")
        .select("label, hours, vehicles(model)")
        .gt("hours", 0)
        .limit(300);

      if (tasks && tasks.length > 0) {
        const relevant = tasks.filter((t: any) => {
          const label = (t.label || "").toLowerCase();
          const tModel = (t.vehicles?.model || "").toLowerCase();
          const sameModel = model && tModel.includes(model.toLowerCase().split(" ")[0]);
          const keywordMatch = keywords.some((k: string) => label.includes(k));
          return sameModel || keywordMatch;
        }).slice(0, 25);

        if (relevant.length > 0) {
          historyContext = `\nHISTÓRICO DA OFICINA (referência prioritária):\n`;
          relevant.forEach((t: any) => {
            historyContext += `- "${t.label}" ${t.vehicles?.model ? `em ${t.vehicles.model}` : ""}: ${t.hours}h\n`;
          });
        }
      }
    } catch (e) {
      console.error("History error:", e);
    }

    // 2. Busca web se histórico insuficiente
    let webContext = "";
    if (historyContext.split("\n").length < 6) {
      const query = `${vehicleLabel} ${description} tempo horas mecânico brasil`;
      const snippets = await webSearch(query);
      if (snippets) webContext = `\nREFERÊNCIA WEB:\n${snippets}`;
    }

    // 3. Prompt para o Claude
    const prompt = `Você é um assistente especializado em orçamentos de oficina automotiva premium brasileira.

Veículo: ${vehicleLabel || "não informado"}
Serviço: ${description}
Taxa de mão de obra da oficina: R$ ${LABOR_RATE}/hora${historyContext}${webContext}

Gere uma lista de serviços para o orçamento. PRIORIZE o histórico da oficina para estimar horas. Se não houver histórico, use a referência web ou seu conhecimento técnico.
O campo "price" de cada item deve ser exatamente: hours × ${LABOR_RATE} (arredonde para 2 casas).
Retorne APENAS JSON válido, sem markdown.

Formato: {"items":[{"label":"nome","description":"detalhe","hours":número,"price":número}]}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) return new Response(JSON.stringify({ error: data.error.message, items: [] }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" },
    });

    const text = (data.content || []).map((c: any) => c.text || "").join("").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);

    return new Response(JSON.stringify(parsed), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Error:", e);
    return new Response(JSON.stringify({ error: String(e), items: [] }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
