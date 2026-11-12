// POST { confirm: "DELETE" }  ->  { deleted: true }
// Permanently deletes the signed-in person's account: cancels any Stripe
// subscription, removes their uploaded files, then deletes the user. Rows in
// plan_data, documents, vault, memberships and family sharing are removed by
// "on delete cascade".
import { admin, cors, getMembership, json, requireUser, stripe } from "../_shared/common.ts";

const BUCKET = "documents";

async function removeFolder(prefix: string) {
  // Storage has no recursive delete; list and remove in pages.
  for (let round = 0; round < 50; round++) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw error;
    const names = (data ?? []).map((f) => `${prefix}/${f.name}`);
    if (!names.length) return;
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(names);
    if (rmErr) throw rmErr;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const user = await requireUser(req);
    if (!user) return json(req, { error: "Please log in first." }, 401);
    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "DELETE") return json(req, { error: "Confirmation missing." }, 400);

    const membership = await getMembership(user.id);
    if (membership?.stripe_customer_id) {
      const subs = await stripe.subscriptions.list({ customer: membership.stripe_customer_id, status: "all", limit: 100 });
      for (const sub of subs.data) {
        if (!["canceled", "incomplete_expired"].includes(sub.status)) {
          await stripe.subscriptions.cancel(sub.id);
        }
      }
    }

    await removeFolder(user.id);

    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return json(req, { deleted: true });
  } catch (err) {
    console.error("delete-account", err);
    return json(req, { error: "Your account couldn’t be deleted just now." }, 500);
  }
});
