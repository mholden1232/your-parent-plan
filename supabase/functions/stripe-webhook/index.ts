// Stripe -> Supabase: keeps public.memberships in step with each subscription.
// Deploy with --no-verify-jwt (Stripe doesn't send a Supabase token);
// every request is verified with the Stripe signing secret instead.
import Stripe from "npm:stripe@22.6.2";
import { admin, env, tierForPrice, stripe } from "../_shared/common.ts";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Stripe statuses that keep Plus switched on. past_due keeps access while
// Stripe retries the card; it switches off if the subscription ends.
const ACCESS = new Set(["active", "trialing", "past_due"]);

async function userIdFor(sub: Stripe.Subscription): Promise<string | null> {
  if (sub.metadata?.user_id) return sub.metadata.user_id;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await admin.from("memberships").select("user_id").eq("stripe_customer_id", customerId).maybeSingle();
  return data?.user_id ?? null;
}

async function sync(sub: Stripe.Subscription) {
  const userId = await userIdFor(sub);
  if (!userId) {
    console.warn("No user for subscription", sub.id);
    return;
  }
  const item = sub.items.data[0];
  const tier = tierForPrice(item?.price?.id) ?? (sub.metadata?.plan as string | undefined) ?? null;
  const hasAccess = ACCESS.has(sub.status) && (tier === "plus_monthly" || tier === "plus_annual");
  const periodEnd = item?.current_period_end;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Ignore events for an older subscription once a newer one is on file.
  const { data: existing } = await admin.from("memberships")
    .select("stripe_subscription_id,status,tier").eq("user_id", userId).maybeSingle();
  if (
    existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id &&
    !hasAccess && existing.status === "active" && existing.tier !== "free"
  ) {
    return;
  }

  const { error } = await admin.from("memberships").upsert({
    user_id: userId,
    tier: hasAccess ? tier : "free",
    status: "active",
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_status: sub.status,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = await stripe.webhooks.constructEventAsync(
      body, signature, env("STRIPE_WEBHOOK_SECRET"), undefined, cryptoProvider,
    );
  } catch (err) {
    console.error("Bad webhook signature", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          await sync(await stripe.subscriptions.retrieve(subId));
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        // Re-read so out-of-order events can't leave stale data behind.
        const sub = event.data.object as Stripe.Subscription;
        await sync(await stripe.subscriptions.retrieve(sub.id));
        break;
      }
      default:
        break;
    }
    return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Webhook handling failed", event.type, err);
    // 500 tells Stripe to retry later.
    return new Response("Webhook handler error", { status: 500 });
  }
});
