// Lê nota/cupom/orçamento escaneado (PDF só de imagem) e devolve os itens em JSON.
// Requer o segredo ANTHROPIC_API_KEY nas Edge Function secrets do Supabase.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-5-5";
const MAX_B64 = 11 * 1024 * 1024; // ~8 MB de arquivo

const PROMPT = `Você lê notas fiscais, cupons, pedidos e orçamentos brasileiros de peças e insumos automotivos (digitalizados ou fotografados).
Extraia os ITENS comprados e responda SOMENTE com um JSON, sem texto antes ou depois, neste formato:
{"supplier_name":"","supplier_cnpj":"","doc_number":"","items":[{"name":"","code":"","qty":1,"unit_cost":0,"line_total":0}],"freight":0,"total":0}
Regras:
- Números com ponto decimal e sem "R$" (ex.: 1234.5). qty e valores nunca em texto.
- name: descrição completa do produto como está na nota (corrija só quebras de linha). code: código/SKU se houver, senão "".
- unit_cost: preço unitário do item. line_total: valor total da linha do item. Se a nota só trouxer um dos dois, calcule o outro.
- Não coloque como item: frete, desconto, impostos, subtotal, total, forma de pagamento, endereço.
- freight: valor do frete cobrado (0 se não houver). total: total geral da nota (0 se não aparecer).
- doc_number: número da nota/pedido (só o número). supplier_name/supplier_cnpj: quem vendeu (emitente), se aparecer.
- Se algo estiver ilegível, dê sua melhor leitura; nunca invente itens que não existem na nota.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "Leitura por imagem ainda não configurada (falta a chave da IA no Supabase)." }, 500);
    const { pdf_base64 } = await req.json();
    if (!pdf_base64 || typeof pdf_base64 !== "string") return json({ error: "Arquivo ausente" }, 400);
    if (pdf_base64.length > MAX_B64) return json({ error: "Arquivo muito grande (máx. 8 MB)" }, 413);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6000,
        messages: [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf_base64 } },
          { type: "text", text: PROMPT },
        ] }],
      }),
    });
    const out = await r.json();
    if (!r.ok) return json({ error: out?.error?.message || "Falha ao consultar a IA" }, 502);
    const text = (out.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b <= a) return json({ error: "Não consegui interpretar a nota" }, 502);
    let parsed;
    try { parsed = JSON.parse(text.slice(a, b + 1)); } catch { return json({ error: "Não consegui interpretar a nota" }, 502); }
    return json(parsed);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
