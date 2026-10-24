import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
 "Access-Control-Allow-Origin": "*",
 "Access-Control-Allow-Headers": "content-type, x-webhook-hash",
 "Access-Control-Allow-Methods": "POST, OPTIONS",
 "Content-Type": "application/json; charset=utf-8",
 };

 function respond(status: number, body: Record<string, unknown>) {
 return new Response(JSON.stringify(body), {
 status,
 headers: corsHeaders,
 });
 }

 function asText(value: unknown): string {
 return typeof value === "string" || typeof value === "number"
 ? String(value).trim()
 : "";
 }

 function normalize(value: string): string {
 return value.trim().toLowerCase();
 }

 function constantTimeEqual(a: string, b: string): boolean {
 const left = new TextEncoder().encode(a.toLowerCase());
 const right = new TextEncoder().encode(b.toLowerCase());

 if (left.length !== right.length) return false;

 let difference = 0;

 for (let i = 0; i < left.length; i++) {
 difference |= left[i] ^ right[i];
 }

 return difference === 0;
 }

 async function calculateHmac(
 secret: string,
 body: string,
 ): Promise<string> {
 const key = await crypto.subtle.importKey(
 "raw",
 new TextEncoder().encode(secret),
 { name: "HMAC", hash: "SHA-256" },
 false,
 ["sign"],
 );

 const signature = await crypto.subtle.sign(
 "HMAC",
 key,
 new TextEncoder().encode(body),
 );

 return Array.from(
 new Uint8Array(signature),
 (byte) => byte.toString(16).padStart(2, "0"),
 ).join("");
 }

 function findValue(
 value: unknown,
 keys: string[],
 depth = 0,
 ): string {
 if (depth > 6 || value === null || typeof value !== "object") {
 return "";
 }

 const object = value as Record<string, unknown>;

 for (const key of keys) {
 const result = asText(object[key]);

 if (result) return result;
 }

 for (const child of Object.values(object)) {
 if (child && typeof child === "object") {
 const result = findValue(child, keys, depth + 1);

 if (result) return result;
 }
 }

 return "";
 }

 Deno.serve(async (req: Request) => {
 if (req.method === "OPTIONS") {
 return new Response("ok", { headers: corsHeaders });
 }

 if (req.method !== "POST") {
 return respond(405, {
 error: "Méthode non autorisée.",
 });
 }

 try {
 const webhookSecret = Deno.env.get("YENGAPAY_WEBHOOK_SECRET");
 const supabaseUrl = Deno.env.get("SUPABASE_URL");
 const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

 if (!webhookSecret || !supabaseUrl || !serviceKey) {
 console.error("Configuration webhook incomplète.");

 return respond(503, {
 error: "Configuration serveur du webhook incomplète.",
 });
 }

 const rawBody = await req.text();

 let payload: unknown;

 try {
 payload = JSON.parse(rawBody);
 } catch {
 return respond(400, {
 error: "Corps JSON invalide.",
 });
 }

 // La signature doit correspondre à la méthode officielle YengaPay.
 const receivedSignature = (
 req.headers.get("x-webhook-hash") ?? ""
 ).trim().replace(/^sha256=/i, "");

 if (!receivedSignature) {
 return respond(401, {
 error: "Signature webhook absente.",
 });
 }

 const expectedSignature = await calculateHmac(
 webhookSecret,
 JSON.stringify(payload),
 );

 if (
 !constantTimeEqual(
 expectedSignature,
 normalize(receivedSignature),
 )
 ) {
 console.warn("Signature webhook invalide.");

 return respond(401, {
 error: "Signature webhook invalide.",
 });
 }

 const reference = findValue(payload, [
 "reference",
 "paymentReference",
 "merchantReference",
 "externalReference",
 ]);

 const event = findValue(payload, [
 "event",
 "eventType",
 "type",
 "status",
 "paymentStatus",
 ]).toLowerCase();

 if (!reference) {
 return respond(400, {
 error: "Référence de paiement absente.",
 });
 }

 const successfulEvents = [
 "payment.success",
 "payment_success",
 "success",
 "succeeded",
 "paid",
 "successful",
 "completed",
 ];

 const failedEvents = [
 "payment.failed",
 "payment_failure",
 "failed",
 "failure",
 "cancelled",
 "canceled",
 "expired",
 ];

 const isSuccess = successfulEvents.includes(event);
 const isFailure = failedEvents.includes(event);

 if (!isSuccess && !isFailure) {
 return respond(200, {
 received: true,
 processed: false,
 message: "Événement non terminal ignoré.",
 });
 }

 const supabase = createClient(supabaseUrl, serviceKey, {
 auth: {
 autoRefreshToken: false,
 persistSession: false,
 },
 });

 // Les dépôts de portefeuille sont traités avant les achats Marché.
 const { data: deposit, error: depositError } = await supabase
 .from("busaf_depots")
 .select("id, reference, montant, statut")
 .eq("reference", reference)
 .maybeSingle();

 if (depositError) {
   console.error("Recherche dépôt impossible:", depositError.message);
   return respond(500, { error: "Impossible de vérifier le dépôt." });
 }

 if (deposit) {
   const depositStatus = normalize(asText(deposit.statut));
   if (depositStatus === "confirme") {
     return respond(200, { received: true, processed: true, duplicate: true });
   }

   if (isSuccess) {
     const amountText = findValue(payload, ["paymentAmount", "paidAmount", "amount", "montant"]);
     const paidAmount = Number(amountText);
     const expectedAmount = Number(deposit.montant);
     if (!amountText || !Number.isFinite(paidAmount) || !Number.isFinite(expectedAmount) ||
         paidAmount <= 0 || Math.round(paidAmount * 100) !== Math.round(expectedAmount * 100)) {
       return respond(400, { error: "Montant absent ou différent. Dépôt non crédité." });
     }
     const currency = findValue(payload, ["currency", "currencyCode", "devise"]).toUpperCase();
     if (currency && currency !== "XOF" && currency !== "FCFA") {
       return respond(400, { error: "Devise inattendue. Dépôt non crédité." });
     }
     const { data: updated, error: updateError } = await supabase
       .from("busaf_depots")
       .update({ statut: "confirme", confirme_le: new Date().toISOString() })
       .eq("id", deposit.id)
       .eq("reference", reference)
       .eq("statut", "en_attente")
       .select("id")
       .maybeSingle();
     if (updateError) {
       console.error("Confirmation dépôt impossible:", updateError.message);
       return respond(500, { error: "Impossible d'enregistrer le dépôt confirmé." });
     }
     if (!updated) {
       const { data: latest } = await supabase.from("busaf_depots").select("statut").eq("id", deposit.id).maybeSingle();
       if (normalize(asText(latest?.statut)) === "confirme") {
         return respond(200, { received: true, processed: true, duplicate: true });
       }
       return respond(409, { error: "Le statut du dépôt a changé. Vérification nécessaire." });
     }
     return respond(200, { received: true, processed: true, type: "depot_portefeuille" });
   }

   const { error: failedDeposit } = await supabase
     .from("busaf_depots")
     .update({ statut: "echec" })
     .eq("id", deposit.id)
     .eq("reference", reference)
     .eq("statut", "en_attente");
   if (failedDeposit) return respond(500, { error: "Impossible d'enregistrer l'échec du dépôt." });
   return respond(200, { received: true, processed: true, type: "depot_portefeuille" });
 }

 const { data: sale, error: saleError } = await supabase
 .from("ventes")
 .select("id, reference, montant, statut")
 .eq("reference", reference)
 .maybeSingle();

 if (saleError) {
 console.error("Recherche vente impossible:", saleError.message);

 return respond(500, {
 error: "Impossible de vérifier la demande de paiement.",
 });
 }

 if (!sale) {
 return respond(404, {
 error: "Référence de paiement inconnue.",
 });
 }

 const currentStatus = normalize(asText(sale.statut));

 const alreadyConfirmed = [
 "confirmee",
 "confirme",
 "validee",
 "valide",
 ].includes(currentStatus);

 if (isSuccess) {
 const amountText = findValue(payload, [
 "paymentAmount",
 "paidAmount",
 "amount",
 "montant",
 ]);

 const paidAmount = Number(amountText);
 const expectedAmount = Number(sale.montant);

 if (
 !amountText ||
 !Number.isFinite(paidAmount) ||
 !Number.isFinite(expectedAmount) ||
 paidAmount <= 0 ||
 Math.round(paidAmount * 100) !==
 Math.round(expectedAmount * 100)
 ) {
 return respond(400, {
 error: "Montant absent ou différent. Paiement non confirmé.",
 });
 }

 const currency = findValue(payload, [
 "currency",
 "currencyCode",
 "devise",
 ]).toUpperCase();

 if (currency && currency !== "XOF" && currency !== "FCFA") {
 return respond(400, {
 error: "Devise inattendue. Paiement non confirmé.",
 });
 }

 if (alreadyConfirmed) {
 return respond(200, {
 received: true,
 processed: true,
 duplicate: true,
 });
 }

 const { data: updated, error: updateError } = await supabase
 .from("ventes")
 .update({ statut: "confirmee" })
 .eq("id", sale.id)
 .eq("reference", reference)
 .eq("statut", sale.statut)
 .select("id")
 .maybeSingle();

 if (updateError) {
 console.error("Confirmation impossible:", updateError.message);

 return respond(500, {
 error: "Impossible d'enregistrer la confirmation du paiement.",
 });
 }

 if (!updated) {
 const { data: latest } = await supabase
 .from("ventes")
 .select("statut")
 .eq("id", sale.id)
 .maybeSingle();

 if (
 ["confirmee", "confirme", "validee", "valide"].includes(
 normalize(asText(latest?.statut)),
 )
 ) {
 return respond(200, {
 received: true,
 processed: true,
 duplicate: true,
 });
 }

 return respond(409, {
 error: "Le statut a changé. Une nouvelle vérification est nécessaire.",
 });
 }

 console.info("Paiement confirmé:", reference);

 return respond(200, {
 received: true,
 processed: true,
 });
 }

 if (alreadyConfirmed) {
 return respond(200, {
 received: true,
 processed: false,
 alreadyConfirmed: true,
 });
 }

 const { error: failureError } = await supabase
 .from("ventes")
 .update({ statut: "echec" })
 .eq("id", sale.id)
 .eq("reference", reference)
 .eq("statut", sale.statut);

 if (failureError) {
 console.error("Enregistrement échec impossible:", failureError.message);

 return respond(500, {
 error: "Impossible d'enregistrer le résultat du paiement.",
 });
 }

 return respond(200, {
 received: true,
 processed: true,
 });
 } catch (error) {
 console.error(
 "Erreur webhook:",
 error instanceof Error ? error.message : "Erreur inconnue",
 );

 return respond(500, {
 error: "Erreur interne du webhook BuSAF.",
 });
 }
 });