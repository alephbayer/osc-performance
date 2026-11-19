import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
  );

  // Tomorrow's date range
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const start = tomorrow.toISOString().slice(0, 10) + "T00:00:00.000Z";
  const end   = tomorrow.toISOString().slice(0, 10) + "T23:59:59.999Z";

  // Find appointments scheduled for tomorrow
  const { data: appts } = await supabase
    .from("appointments")
    .select("id, vehicle_id, scheduled_date, title")
    .gte("scheduled_date", start)
    .lte("scheduled_date", end)
    .not("scheduled_date", "is", null);

  if (!appts?.length) return new Response("no appointments tomorrow", { status: 200 });

  let sent = 0;
  for (const appt of appts) {
    // Get vehicle → client
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("model, plate, client_id")
      .eq("id", appt.vehicle_id)
      .single();
    if (!vehicle?.client_id) continue;

    // Get client push subscriptions
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("subscription")
      .eq("client_id", vehicle.client_id);
    if (!subs?.length) continue;

    const vModel = vehicle.model || vehicle.plate || "seu veículo";
    const dateStr = new Date(appt.scheduled_date).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
    const title = `📅 Lembrete — ${vModel}`;
    const body  = `Seu agendamento é amanhã, ${dateStr}. Não esqueça!`;

    for (const sub of subs) {
      try {
        // Use Supabase's built-in web push
        await supabase.functions.invoke("send-push", {
          body: { subscription: sub.subscription, title, body, url: "/?portal=cliente" }
        });
        sent++;
      } catch (e) {
        console.error("push error:", e);
      }
    }
  }

  return new Response(`sent ${sent} reminders`, { status: 200 });
});
