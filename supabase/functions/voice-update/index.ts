// Supabase Edge Function: turns a spoken note into proposed CRM updates using Claude.
// The Anthropic key lives only here (secret ANTHROPIC_API_KEY), never in the web app.
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name "voice-update".
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

const MODEL = Deno.env.get("VOICE_MODEL") || "claude-haiku-5-5";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://pchen8630.github.io").split(",").map((s) => s.trim());

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const STR = { type: "string" };
const DATE = { type: "string", format: "date" };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dealer", "visit", "projects", "contact_changes", "dealer_status", "questions", "readback"],
  properties: {
    dealer: {
      type: "object", additionalProperties: false,
      required: ["dealer_id", "heard_as", "confidence"],
      properties: {
        dealer_id: nullable(STR),
        heard_as: STR,
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
    },
    visit: {
      type: "object", additionalProperties: false,
      required: ["log", "type", "date", "summary", "next_action", "follow_up_date"],
      properties: {
        log: { type: "boolean" },
        type: { type: "string", enum: ["In-person", "Phone", "Video", "Email"] },
        date: DATE,
        summary: STR,
        next_action: nullable(STR),
        follow_up_date: nullable(DATE),
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["existing_project_id", "dealer_id", "name", "products", "amount", "stage", "close_date", "site", "notes", "follow_up_date"],
        properties: {
          existing_project_id: nullable(STR),
          dealer_id: nullable(STR),
          name: STR,
          products: nullable(STR),
          amount: nullable({ type: "number" }),
          stage: { type: "string", enum: ["Lead", "Quoted", "In Progress", "Won", "Lost"] },
          close_date: nullable(DATE),
          site: nullable(STR),
          notes: nullable(STR),
          follow_up_date: nullable(DATE),
        },
      },
    },
    contact_changes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["kind", "contact_id", "name", "title", "phone", "email", "from_dealer_id", "to_dealer_id", "to_company_name", "note"],
        properties: {
          kind: { type: "string", enum: ["new_contact", "update_contact", "left_company", "moved_company"] },
          contact_id: nullable(STR),
          name: STR,
          title: nullable(STR),
          phone: nullable(STR),
          email: nullable(STR),
          from_dealer_id: nullable(STR),
          to_dealer_id: nullable(STR),
          to_company_name: nullable(STR),
          note: nullable(STR),
        },
      },
    },
    dealer_status: { type: "string", enum: ["unchanged", "Prospect", "Active Customer", "Follow-up Needed", "Meeting Scheduled", "Inactive"] },
    questions: { type: "array", items: STR },
    readback: STR,
  },
};

const SYSTEM = `You turn a field sales rep's spoken note into CRM updates. The rep sells security cameras (Luminys) to dealers and integrators in Eastern Canada and dictates while driving, in English, French or both. The text comes from phone speech recognition, so company and person names may be misspelled or split into odd words: match them by sound and meaning, not exact spelling.

You get: TODAY (date and weekday), the DEALERS list (id | name | city), CONTACTS (id | name | title | dealer id), NEARBY dealers by distance from the rep's current location (if known), and open PROJECTS for likely dealers.

Rules:
- dealer: the main dealer the note is about. Use an id from DEALERS only. If the rep says "here", "this one" or "just left" without a name, use the nearest NEARBY dealer. If two dealers fit or you are guessing, set confidence "low" and ask in questions. If none fits, dealer_id null.
- visit: log=true when the rep describes a meeting, call or conversation. type In-person unless they say phone/call/video/email. date = TODAY unless they say otherwise. summary = 1-3 short factual sentences in the language the rep spoke; only what was said, never invented. next_action = the next step, if any.
- Dates: turn "in two weeks", "next Tuesday", "after the holidays" (= first Monday of January), "end of month" into YYYY-MM-DD from TODAY. follow_up_date only if the rep asks for a follow-up or reminder, or a next step clearly has a time.
- projects: one entry per opportunity mentioned (new job, quote, tender). Reuse existing_project_id when it is clearly one of the PROJECTS listed. name = short description like "Saint-Jérôme school - 40 cameras". amount in CAD as a number (30K = 30000) or null. stage: Lead for a new opportunity, Quoted if a quote was sent, In Progress if ordered/installing, Won or Lost if stated. dealer_id = the dealer the project is with.
- contact_changes: new person met (new_contact), new phone/email/title for a known person (update_contact, with contact_id), someone left a company (left_company, from_dealer_id), someone joined another company (moved_company: from_dealer_id and to_dealer_id when it is in DEALERS, else to_company_name). Use contact_id from CONTACTS when it matches.
- dealer_status: change only if clearly stated (e.g. "they closed" = Inactive, "booked a meeting" = Meeting Scheduled). Otherwise "unchanged".
- questions: short questions for anything unclear (empty if all clear).
- readback: one or two short sentences, in the rep's language, saying what will be saved, written to be read aloud to a driver. Example: "Visit at Alarme Mirabel logged. New project Saint-Jérôme school, 30 thousand dollars. Follow-up November 17."
Do not add anything the rep did not say.`;

function cors(origin: string | null) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, h);

  // Only signed-in users of this Supabase project may use the AI.
  const auth = req.headers.get("authorization") || "";
  const apikey = req.headers.get("apikey") || "";
  const userRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!userRes.ok) return json({ error: "Please sign in again." }, 401, h);

  let input: any;
  try { input = await req.json(); } catch { return json({ error: "Bad request" }, 400, h); }
  const transcript = String(input.transcript || "").trim().slice(0, 6000);
  if (!transcript) return json({ error: "Nothing was said." }, 400, h);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "The AI key is not set up yet (ANTHROPIC_API_KEY secret)." }, 500, h);
  const client = new Anthropic({ apiKey: key });

  const context = [
    `TODAY: ${input.today} (${input.weekday})`,
    `REP LANGUAGE SETTING: ${input.lang || "en-CA"}`,
    `DEALERS:\n${String(input.dealers || "").slice(0, 60000)}`,
    `CONTACTS:\n${String(input.contacts || "(none)").slice(0, 40000)}`,
    `NEARBY:\n${String(input.nearby || "(location unknown)").slice(0, 3000)}`,
    `PROJECTS:\n${String(input.projects || "(none)").slice(0, 10000)}`,
  ].join("\n\n");

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `${context}\n\nSPOKEN NOTE:\n"""${transcript}"""` }],
    } as any);
    if (response.stop_reason === "refusal") return json({ error: "The AI declined this note. Please type it in manually." }, 422, h);
    if (response.stop_reason === "max_tokens") return json({ error: "The note was too long for the AI. Try a shorter note." }, 422, h);
    const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let result;
    try { result = JSON.parse(text); } catch { return json({ error: "The AI answer could not be read. Please try again." }, 502, h); }
    return json({ result, model: MODEL, usage: response.usage }, 200, h);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key is not valid. Check the ANTHROPIC_API_KEY secret." }, 500, h);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Too many requests right now (or the monthly spend limit was reached). Try again in a minute." }, 429, h);
    if (e instanceof Anthropic.APIError) return json({ error: `AI service error (${e.status}). Try again.` }, 502, h);
    return json({ error: "Could not reach the AI service." }, 502, h);
  }
});
