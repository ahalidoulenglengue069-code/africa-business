// BuSAF — création sécurisée d'un paiement Marché
// Déploiement uniquement après vérification des colonnes réelles de public.ventes.
// Secrets requis dans Supabase Edge Functions:
// YENGAPAY_API_KEY, YENGAPAY_GROUP_ID, YENGAPAY_PROJECT_ID
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis par l'environnement Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanText(value: unknown, max = 180): string {
  return String(value ?? "").trim().slice(0, max);
}

function isConfirmed(status: unknown): boolean {
  return ["confirmee", "confirme", "validee", "valide", "success", "paid"].includes(
    cleanText(status, 40).toLowerCase(),
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const yengaKey = Deno.env.get("YENGAPAY_API_KEY");
    const yengaGroupId = Deno.env.get("YENGAPAY_GROUP_ID");
    const yengaProjectId = Deno.env.get("YENGAPAY_PROJECT_ID");

    if (!supabaseUrl || !serviceKey) {
      console.error("Configuration Supabase manquante.");
      return reply(500, { error: "Configuration serveur BuSAF incomplète." });
    }
    if (!yengaKey || !yengaGroupId || !yengaProjectId) {
      console.error("Secrets YengaPay manquants.");
      return reply(503, { error: "Le paiement est temporairement indisponible. Configuration YengaPay à vérifier." });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return reply(401, { error: "Connexion requise." });

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !authData.user) return reply(401, { error: "Session expirée. Reconnecte-toi." });

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return reply(400, { error: "Requête invalide." });
    }
    const productId = cleanText(payload.produit_id, 80);
    if (!productId) return reply(400, { error: "Identifiant du produit manquant." });

    // L'identité provient exclusivement du jeton vérifié, jamais du corps envoyé par le navigateur.
    const { data: profile, error: profileError } = await admin
      .from("profils_busaf")
      .select("id, user_id, parrain_id, role")
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Lecture profil impossible:", profileError.message);
      return reply(500, { error: "Impossible de vérifier le profil BuSAF." });
    }
    if (!profile) return reply(403, { error: "Profil BuSAF introuvable. Reconnecte-toi ou contacte le support." });

    const { data: product, error: productError } = await admin
      .from("produits")
      .select("id, nom, prix, type_produit, createur_id")
      .eq("id", productId)
      .maybeSingle();

    if (productError) {
      console.error("Lecture produit impossible:", productError.message);
      return reply(500, { error: "Impossible de vérifier le produit. Le schéma de la table produits doit être contrôlé." });
    }
    if (!product) return reply(404, { error: "Produit du Marché introuvable." });

    const amount = Number(product.prix);
    if (!Number.isFinite(amount) || amount <= 0) return reply(409, { error: "Le prix du produit est invalide." });

    // Vérification serveur de la règle : le nouveau membre doit d'abord acheter
    // un produit que son parrain direct a déjà acheté.
    const { data: ownSales, error: ownSalesError } = await admin
      .from("ventes")
      .select("id, statut")
      .eq("acheteur_id", profile.id)
      .limit(100);

    if (ownSalesError) {
      console.error("Lecture ventes acheteur impossible:", ownSalesError.message);
      return reply(500, { error: "Impossible de vérifier les achats existants. Le schéma de la table ventes doit être contrôlé." });
    }

    const alreadyHasConfirmedPurchase = (ownSales ?? []).some((sale) => isConfirmed(sale.statut));
    if (!alreadyHasConfirmedPurchase) {
      if (!profile.parrain_id) {
        return reply(403, { error: "Aucun parrain direct n'est associé à ce compte. Contacte le support BuSAF." });
      }
      const { data: sponsorSales, error: sponsorError } = await admin
        .from("ventes")
        .select("id, produit_id, statut")
        .eq("acheteur_id", profile.parrain_id)
        .eq("produit_id", productId)
        .limit(100);

      if (sponsorError) {
        console.error("Vérification achat parrain impossible:", sponsorError.message);
        return reply(500, { error: "Impossible de vérifier l'achat du parrain. Réessaie plus tard." });
      }
      if (!(sponsorSales ?? []).some((sale) => isConfirmed(sale.statut))) {
        return reply(403, {
          error: "Pour ton premier achat, choisis un produit du Marché que ton parrain direct a déjà acheté et dont le paiement est confirmé.",
        });
      }
    }

    // Évite deux paiements simultanés du même produit par le même membre.
    const { data: existing, error: existingError } = await admin
      .from("ventes")
      .select("id, statut, reference, created_at")
      .eq("acheteur_id", profile.id)
      .eq("produit_id", productId)
      .limit(20);

    if (existingError) {
      console.error("Vérification doublon impossible:", existingError.message);
      return reply(500, { error: "Impossible de vérifier les paiements déjà commencés." });
    }
    const now = Date.now();
    const isPendingStatus = (value: unknown) => {
      const status = cleanText(value, 40).toLowerCase();
      return status.includes("attente") || status === "pending" || status === "en_cours";
    };
    const recentPending = (existing ?? []).find((sale) => {
      if (!isPendingStatus(sale.statut)) return false;
      const createdAt = sale.created_at ? new Date(sale.created_at).getTime() : Number.NaN;
      const age = Number.isFinite(createdAt) ? now - createdAt : Number.POSITIVE_INFINITY;
      return age >= 0 && age < 20 * 60 * 1000;
    });
    if (recentPending) {
      return reply(409, {
        error: "Un paiement pour ce produit est déjà en attente. Attends sa confirmation ou son expiration avant de réessayer.",
        reference: recentPending.reference ?? undefined,
      });
    }

    // Une tentative abandonnée ne doit pas rester éternellement « en_attente ».
    // À partir de 20 minutes, on marque les anciennes demandes comme expirées avant
    // d'en créer une nouvelle. Un webhook signé tardif peut encore confirmer la référence.
    const stalePending = (existing ?? []).filter((sale) => {
      if (!isPendingStatus(sale.statut)) return false;
      const createdAt = sale.created_at ? new Date(sale.created_at).getTime() : Number.NaN;
      return !Number.isFinite(createdAt) || now - createdAt >= 20 * 60 * 1000;
    });
    for (const stale of stalePending) {
      const { error: expireError } = await admin
        .from("ventes")
        .update({ statut: "expiree" })
        .eq("id", stale.id)
        .eq("statut", stale.statut);
      if (expireError) {
        console.error("Expiration ancienne demande impossible:", expireError.message);
        return reply(500, { error: "Impossible de clôturer une ancienne tentative de paiement. Réessaie plus tard." });
      }
    }

    // Référence unique et créée côté serveur.
    const reference = `BUSAF-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const { data: inserted, error: insertError } = await admin
      .from("ventes")
      .insert({
        produit_id: product.id,
        vendeur_id: product.createur_id ?? null,
        acheteur_id: profile.id,
        montant: amount,
        statut: "en_attente",
        reference,
        moyen_paiement: "yengapay",
      })
      .select("id, reference")
      .single();

    if (insertError || !inserted) {
      console.error("Création vente en attente impossible:", insertError?.message);
      return reply(500, {
        error: "Impossible d'enregistrer la demande de paiement. Vérifie les colonnes et contraintes de la table ventes avant le déploiement.",
      });
    }

    let providerResponse: Response;
    let providerData: Record<string, unknown> = {};
    try {
      providerResponse = await fetch(
        `https://api.sandbox.yengapay.com/api/v1/groups/${encodeURIComponent(yengaGroupId)}/payment-intent/${encodeURIComponent(yengaProjectId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": yengaKey,
          },
          body: JSON.stringify({
            paymentAmount: amount,
            reference,
            articles: [{ title: cleanText(product.nom, 100) || "Produit Marché BuSAF", description: "Achat numérique Marché BuSAF", price: amount }],
          }),
        },
      );
      const raw = await providerResponse.text();
      try {
        providerData = raw ? JSON.parse(raw) : {};
      } catch {
        providerData = {};
      }
    } catch (error) {
      console.error("YengaPay inaccessible:", error instanceof Error ? error.message : "network error");
      await admin.from("ventes").update({ statut: "echec" }).eq("id", inserted.id);
      return reply(502, { error: "YengaPay est momentanément inaccessible. Aucune confirmation d'achat n'a été enregistrée." });
    }

    const checkoutUrl = cleanText(providerData.checkoutPageUrlWithPaymentToken, 2000);
    if (!providerResponse.ok || !checkoutUrl || !/^https:\/\//i.test(checkoutUrl)) {
      // On n'expose jamais la réponse brute du prestataire, qui peut contenir des informations sensibles.
      console.error("YengaPay a refusé la création du paiement:", providerResponse.status, cleanText(providerData.message ?? providerData.error ?? providerData.code, 160) || "réponse sans message exploitable");
      await admin.from("ventes").update({ statut: "echec" }).eq("id", inserted.id);
      return reply(502, {
        error: providerResponse.status === 401
          ? "YengaPay refuse l'authentification serveur. Vérifie la clé API et le projet SANDBOX dans les secrets Supabase."
          : "YengaPay n'a pas fourni de lien de paiement valide. Réessaie plus tard.",
      });
    }

    return reply(200, { checkout_url: checkoutUrl, reference });
  } catch (error) {
    console.error("Erreur interne creer-achat-marche:", error instanceof Error ? error.message : "unknown");
    return reply(500, { error: "Erreur interne lors de la préparation du paiement." });
  }
});
