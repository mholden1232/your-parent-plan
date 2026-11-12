// POST { plan: "plus_monthly" | "plus_annual" }  ->  { url }
// Starts a Stripe Checkout session for the signed-in user.
import { admin, cors, getMembership, json, PLANS, type Plan, requireUser, siteUrl, stripe } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(req);
    if (!user) return json(req, { error: "Please log in first." }, 401);

    const body = await req.json().catch(() => ({}));
    const plan = body?.plan as Plan;
    if (!(plan in PLANS)) return json(req, { error: "Unknown plan." }, 400);

    const membership = await getMembership(user.id);
    if (membership?.status === "active" && membership.tier !== "free" && membership.stripe_subscription_id) {
      return json(req, { error: "You already have Plus. Use “Manage billing” to change plans.", alreadyPlus: true }, 409);
    }

    // Reuse this person's Stripe customer, or create one.
    let customerId = membership?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      const { error } = await admin.from("memberships").upsert(
        { user_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    }

    const site = siteUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: PLANS[plan](), quantity: 1 }],
      allow_promotion_codes: true,
      metadata: { user_id: user.id, plan },
      subscription_data: { metadata: { user_id: user.id, plan } },
      success_url: `${site}/plan.html?upgraded=1`,
      cancel_url: `${site}/pricing.html?checkout=canceled`,
    });

    return json(req, { url: session.url });
  } catch (err) {
    console.error("create-checkout", err);
    return json(req, { error: "Checkout couldn’t start. Please try again in a moment." }, 500);
  }
});
