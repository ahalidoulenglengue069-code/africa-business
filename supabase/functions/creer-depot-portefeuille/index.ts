// BuSAF — création sécurisée d'un dépôt de portefeuille via YengaPay.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("YENGAPAY_API_KEY");
    const organizationId = Deno.env.get("YENGAPAY_ORGANIZATION_ID") || Deno.env.get("YENGAPAY_GROUP_ID");
    const projectId = Deno.env.get("YENGAPAY_PROJECT_ID");
    const baseUrl = (Deno.env.get("YENGAPAY_BASE_URL") || "https://api.sandbox.yengapay.com/api/v1").trim().replace(/\/+$/, "");

    if (!supabaseUrl || !serviceKey) {
      return reply(503, { error: "Configuration serveur BuSAF incomplète." });
    }
    if (!apiKey || !organizationId || !projectId || !baseUrl) {
      return reply(503, { error: "Configuration YengaPay incomplète. Vérifie les secrets du serveur." });
    }

    const bearer = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return reply(401, { error: "Connexion requise." });

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: auth, error: authError } = await db.auth.getUser(bearer);
    if (authError || !auth.user) return reply(401, { error: "Session invalide. Reconnecte-toi." });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: "Requête invalide." });
    }

    const amount = Number(body.montant);
    const operator = String(body.operateur || "").trim();
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return reply(400, { error: "Montant entier positif requis en FCFA." });
    }
    if (!["Orange Money", "Moov Money", "Telecel Money", "Wave"].includes(operator)) {
      return reply(400, { error: "Opérateur Mobile Money non pris en charge." });
    }

    const { data: profile, error: profileError } = await db
      .from("profils_busaf")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (profileError || !profile) {
      return reply(403, { error: "Profil BuSAF introuvable." });
    }

    const reference = "BUSAFDEP-" + crypto.randomUUID().replace(/-/g, "");
    const { error: insertError } = await db.from("busaf_depots").insert({
      profil_id: profile.id,
      montant: amount,
      operateur: operator,
      reference,
      statut: "en_attente",
    });
    if (insertError) {
      console.error("Création dépôt impossible:", insertError.message);
      return reply(500, { error: "Impossible d'enregistrer la demande de dépôt." });
    }

    let providerResponse: Response;
    try {
      providerResponse = await fetch(
        baseUrl + "/groups/" + encodeURIComponent(organizationId) +
          "/payment-intent/" + encodeURIComponent(projectId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey },
          body: JSON.stringify({
            paymentAmount: amount,
            reference,
            articles: [{
              title: "Dépôt portefeuille BuSAF",
              description: "Recharge du portefeuille numérique BuSAF",
              price: amount,
            }],
          }),
        },
      );
    } catch (error) {
      console.error("YengaPay inaccessible:", error instanceof Error ? error.message : "network error");
      await db.from("busaf_depots").update({ statut: "echec" }).eq("reference", reference).eq("statut", "en_attente");
      return reply(502, { error: "YengaPay est momentanément inaccessible. Le dépôt n'a pas été crédité." });
    }

    let providerData: Record<string, unknown> = {};
    try {
      providerData = await providerResponse.json();
    } catch {
      providerData = {};
    }
    const checkoutUrl = String(providerData.checkoutPageUrlWithPaymentToken || "").trim();
    if (!providerResponse.ok || !/^https:\/\//i.test(checkoutUrl)) {
      console.error("Lien de paiement YengaPay invalide:", providerResponse.status);
      await db.from("busaf_depots").update({ statut: "echec" }).eq("reference", reference).eq("statut", "en_attente");
      return reply(502, { error: "YengaPay n'a pas fourni de lien de paiement valide. Aucun crédit n'a été effectué." });
    }

    return reply(200, { checkout_url: checkoutUrl, reference });
  } catch (error) {
    console.error("Erreur creer-depot-portefeuille:", error instanceof Error ? error.message : "unknown");
    return reply(500, { error: "Erreur interne lors de la préparation du dépôt." });
  }
});
