// POST  ->  { url }
// Opens Stripe's customer portal so a Plus member can update their card,
// switch between monthly and annual, or cancel.
import { cors, getMembership, json, requireUser, siteUrl, stripe } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(req);
    if (!user) return json(req, { error: "Please log in first." }, 401);

    const membership = await getMembership(user.id);
    if (!membership?.stripe_customer_id) {
      return json(req, { error: "There’s no billing account yet. Choose a plan to get started." }, 404);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: membership.stripe_customer_id,
      return_url: `${siteUrl()}/pricing.html`,
    });
    return json(req, { url: session.url });
  } catch (err) {
    console.error("billing-portal", err);
    return json(req, { error: "Billing couldn’t open. Please try again in a moment." }, 500);
  }
});
