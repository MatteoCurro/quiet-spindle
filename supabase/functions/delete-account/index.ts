import { createSupabaseContext } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

    const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: "user" });
    if (authError || !ctx?.userClaims?.id) return json({ error: "ACCOUNT_SIGNIN_REQUIRED" }, 401);

    let body: { confirmation?: string } = {};
    try { body = await req.json(); } catch (_) {}
    if (body.confirmation !== "DELETE") return json({ error: "CONFIRMATION_REQUIRED" }, 400);

    const userId = ctx.userClaims.id;

    const signOut = await ctx.supabase.auth.signOut({ scope: "global" });
    if (signOut.error) return json({ error: "SESSION_REVOCATION_FAILED" }, 502);

    const deleted = await ctx.supabaseAdmin.auth.admin.deleteUser(userId, false);
    if (deleted.error) return json({ error: "ACCOUNT_DELETE_FAILED" }, 502);

    return json({ deleted: true });
  },
};
