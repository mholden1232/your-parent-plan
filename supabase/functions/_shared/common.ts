// Shared helpers for the Your Parent Plan billing Edge Functions.
import Stripe from "npm:stripe@22.6.2";
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.118.0";

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret: ${name}`);
  return v;
}

export const stripe = new Stripe(env("STRIPE_SECRET_KEY"), {
  httpClient: Stripe.createFetchHttpClient(),
});

// Service-role client: bypasses Row Level Security. Server-side only.
export const admin: SupabaseClient = createClient(
  env("SUPABASE_URL"),
  env("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

// The public site address, e.g. https://yourparentplan.com (no trailing slash).
export function siteUrl(): string {
  return env("SITE_URL").replace(/\/+$/, "");
}

export const PLANS = {
  plus_monthly: () => env("STRIPE_PRICE_PLUS_MONTHLY"),
  plus_annual: () => env("STRIPE_PRICE_PLUS_ANNUAL"),
} as const;
export type Plan = keyof typeof PLANS;

export function tierForPrice(priceId: string | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === Deno.env.get("STRIPE_PRICE_PLUS_MONTHLY")) return "plus_monthly";
  if (priceId === Deno.env.get("STRIPE_PRICE_PLUS_ANNUAL")) return "plus_annual";
  return null;
}

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = [siteUrl(), ...(Deno.env.get("EXTRA_ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean)];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

// The signed-in user making this request, from their Supabase access token.
export async function requireUser(req: Request): Promise<User | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export type MembershipRow = {
  user_id: string;
  tier: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export async function getMembership(userId: string): Promise<MembershipRow | null> {
  const { data, error } = await admin
    .from("memberships")
    .select("user_id,tier,status,stripe_customer_id,stripe_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as MembershipRow | null;
}
