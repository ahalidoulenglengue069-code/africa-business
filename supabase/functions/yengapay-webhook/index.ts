// BuSAF — webhook YengaPay
// Vérifie la signature HMAC avant toute mise à jour. Aucun achat n'est validé sur la seule
// base d'un retour navigateur. Secrets Supabase requis : YENGAPAY_WEBHOOK_SECRET.
// La référence doit correspondre à public.ventes.reference.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-hash",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function asText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a.toLowerCase());
  const bb = enc.encode(b.toLowerCase());
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

function findValue(obj: unknown, keys: string[], depth = 0): string {
  if (depth > 5 || obj === null || typeof obj !== "object") return "";
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) return value;
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const found = findValue(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." });

  try {
    const secret = Deno.env.get("YENGAPAY_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !supabaseUrl || !serviceKey) {
      console.error("Secrets webhook/Supabase manquants.");
      return reply(503, { error: "Configuration webhook incomplète." });
    }

    const rawBody = await req.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply(400, { error: "Corps webhook JSON invalide." });
    }

    // YengaPay documente le HMAC-SHA256 de JSON.stringify(payload).
    const receivedHash = (req.headers.get("x-webhook-hash") ?? "").trim();
    if (!receivedHash) return reply(401, { error: "Signature webhook absente." });
    const expectedHash = await hmacHex(secret, JSON.stringify(payload));
    const normalizedReceived = receivedHash.replace(/^sha256=/i, "");
    if (!constantTimeEqual(expectedHash, normalizedized(normalizedReceived))) {
      console.warn("Signature webhook invalide.");
      return reply(401, { error: "Signature webhook invalide." });
    }

    const eventType = findValue(payload, ["event", "eventType", "type", "status", "paymentStatus"]).toLowerCase();
    const reference = findValue(payload, ["reference", "paymentReference", "merchantReference", "externalReference"]);
    if (!reference) {
      console.warn("Webhook sans référence reconnue.");
      return reply(400, { error: "Référence de paiement absente." });
    }

    const successEvents = ["payment.success", "payment_success", "success", "succeeded", "paid", "successful", "completed"];
    const failureEvents = ["payment.failed", "payment_failure", "failed", "failure", "cancelled", "canceled", "expired"];
    const isSuccess = successEvents.includes(eventType);
    const isFailure = failureEvents.includes(eventType);
    if (!isSuccess && !isFailure) {
      // Événements non terminaux : réponse 200 pour éviter des répétitions inutiles.
      console.info("Événement YengaPay ignoré (non terminal):", eventType);
      return reply(200, { received: true, processed: false });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: sale, error: findError } = await admin
      .from("ventes")
      .select("id, statut, reference, montant, produit_id, acheteur_id")
      .eq("reference", reference)
      .maybeSingle();

    if (findError) {
      console.error("Recherche vente webhook impossible:", findError.message);
      return reply(500, { error: "Impossible de retrouver la demande de paiement." });
    }
    if (!sale) {
      console.warn("Référence webhook inconnue:", reference);
      return reply(404, { error: "Référence de paiement BuSAF inconnue." });
    }

    const currentStatus = asText(sale.statut).toLowerCase();
    const alreadyConfirmed = ["confirmee", "confirme", "validee", "valide"].includes(currentStatus);

    // Une notification de succès ne suffit pas : comparer le montant avec celui attendu.
    // Si le payload ne contient pas de montant numérique fiable, ne jamais confirmer.
    if (isSuccess) {
      const amountText = findValue(payload, ["paymentAmount", "paidAmount", "amount", "montant"]);
      const paidAmount = Number(amountText);
      const expectedAmount = Number(sale.montant);
      if (!amountText || !Number.isFinite(paidAmount) || !Number.isFinite(expectedAmount) ||
          paidAmount <= 0 || Math.round(paidAmount * 100) !== Math.round(expectedAmount * 100)) {
        console.warn("Montant webhook absent ou différent; vente non confirmée:", reference);
        return reply(400, { error: "Montant du paiement absent ou différent. Vente non confirmée." });
      }
      const currency = findValue(payload, ["currency", "currencyCode", "devise"]).toUpperCase();
      if (currency && currency !== "XOF" && currency !== "FCFA") {
        console.warn("Devise webhook inattendue; vente non confirmée:", reference);
        return reply(400, { error: "Devise du paiement inattendue. Vente non confirmée." });
      }
    }
    if (isSuccess && alreadyConfirmed) {
      return reply(200, { received: true, processed: true, duplicate: true });
    }
    if (isSuccess) {
      // Mise à jour conditionnelle : protège des événements dupliqués et ne crédite rien côté navigateur.
      const { data: updated, error: updateError } = await admin
        .from("ventes")
        .update({ statut: "confirmee" })
        .eq("id", sale.id)
        .eq("reference", reference)
        .select("id")
        .maybeSingle();

      if (updateError || !updated) {
        console.error("Confirmation vente impossible:", updateError?.message ?? "aucune ligne mise à jour");
        return reply(500, { error: "La confirmation du paiement n'a pas pu être enregistrée." });
      }
      // L'ajout du stock et des commissions doit être exécuté par une routine SQL transactionnelle
      // idempotente après vérification du schéma live. Ne pas créditer ces montants ici à l'aveugle.
      console.info("Paiement confirmé par webhook signé:", reference);
      return reply(200, { received: true, processed: true });
    }

    // Ne pas rétrograder une vente déjà confirmée si un événement d'échec arrive en retard.
    if (alreadyConfirmed) return reply(200, { received: true, processed: false, alreadyConfirmed: true });
    const { error: failError } = await admin
      .from("ventes")
      .update({ statut: "echec" })
      .eq("id", sale.id)
      .eq("reference", reference);
    if (failError) {
      console.error("Échec paiement impossible à enregistrer:", failError.message);
      return reply(500, { error: "Impossible d'enregistrer l'état du paiement." });
    }
    return reply(200, { received: true, processed: true });
  } catch (error) {
    console.error("Erreur webhook BuSAF:", error instanceof Error ? error.message : "unknown");
    return reply(500, { error: "Erreur interne webhook." });
  }
});

function normalizedized(value: string): string {
  return value.trim().toLowerCase();
}
