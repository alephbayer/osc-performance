import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:contato@oscperformance.com.br";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

async function sendToSubs(subs: {endpoint:string,p256dh:string,auth:string}[], payload: string) {
  const results = await Promise.allSettled(
    subs.map(s => webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload
    ))
  );
  const failed = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
  if (failed.length) console.error("Push failures:", failed.map(f => f.reason?.message));
  return results.filter(r => r.status === "fulfilled").length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { employeeId, adminAll, clientId, title, body, url } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const payload = JSON.stringify({ title, body, url, tag: "osc-update" });
    let sent = 0;

    // Push to specific mechanic
    if (employeeId) {
      const { data: subs, error } = await supabase
        .from("push_subscriptions")
        .select("endpoint,p256dh,auth")
        .eq("employee_id", employeeId);
      if (error) console.error("DB error (employee):", error);
      if (subs?.length) sent += await sendToSubs(subs, payload);
      console.log(`Employee ${employeeId}: ${subs?.length ?? 0} subs, sent ${sent}`);
    }

    // Push to all admins
    if (adminAll) {
      const { data: subs, error } = await supabase
        .from("admin_push_subscriptions")
        .select("endpoint,p256dh,auth");
      if (error) console.error("DB error (admin):", error);
      const adminSent = subs?.length ? await sendToSubs(subs, payload) : 0;
      sent += adminSent;
      console.log(`Admin: ${subs?.length ?? 0} subs, sent ${adminSent}`);
    }

    // Push to specific client
    if (clientId) {
      const { data: subs, error } = await supabase
        .from("client_push_subscriptions")
        .select("endpoint,p256dh,auth")
        .eq("client_id", clientId);
      if (error) console.error("DB error (client):", error);
      const clientSent = subs?.length ? await sendToSubs(subs, payload) : 0;
      sent += clientSent;
      console.log(`Client ${clientId}: ${subs?.length ?? 0} subs, sent ${clientSent}`);
    }

    return new Response(JSON.stringify({ sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
