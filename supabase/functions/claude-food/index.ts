// PlateIQ — Claude food assistant (Supabase Edge Function, Deno).
//
// The app calls this with the signed-in user's Cloud sync session. It keeps the
// Anthropic API key server-side and runs one of two fixed tasks:
//   label — read a nutrition-label photo into a custom food (macros + micros)
//   meal  — turn a typed description and/or a meal photo into diary items,
//           matched against the user's own foods where possible
//   groceries — turn a receipt photo, a photo of groceries and/or a typed list
//           into inventory items with package sizes and estimated shelf life
//
// Required function secrets (`supabase secrets set ...`):
//   ANTHROPIC_API_KEY — from console.anthropic.com (API usage is billed there)
//   ALLOWED_EMAILS    — comma-separated sign-in emails allowed to use it. The
//                       project's public key ships in the app, so anyone could
//                       create an account; this keeps your API bill yours.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Deploy with --no-verify-jwt: the function verifies the session itself (this
// also lets the browser's CORS preflight through).

import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'claude-opus-5-5';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Same keys/units/daily values as NUTRIENTS in index.html.
const NUTRIENTS: [key: string, label: string, unit: string, dv: number][] = [
  ['sodium', 'Sodium', 'mg', 2300], ['vitc', 'Vitamin C', 'mg', 90], ['b1', 'Thiamin (B1)', 'mg', 1.2],
  ['b2', 'Riboflavin (B2)', 'mg', 1.3], ['b3', 'Niacin (B3)', 'mg', 16], ['b6', 'Vitamin B6', 'mg', 1.7],
  ['folate', 'Folate', 'mcg DFE', 400], ['b5', 'Pantothenate (B5)', 'mg', 5], ['calcium', 'Calcium', 'mg', 1300],
  ['magnesium', 'Magnesium', 'mg', 420], ['zinc', 'Zinc', 'mg', 11], ['potassium', 'Potassium', 'mg', 4700],
  ['fiber', 'Dietary fiber', 'g', 28], ['vita', 'Vitamin A', 'mcg RAE', 900], ['vitd', 'Vitamin D', 'mcg', 20],
  ['vite', 'Vitamin E', 'mg', 15], ['vitk', 'Vitamin K', 'mcg', 120], ['b12', 'Vitamin B12', 'mcg', 2.4],
  ['iron', 'Iron', 'mg', 18], ['selenium', 'Selenium', 'mcg', 55],
];
const NUTRIENT_TABLE = NUTRIENTS.map(([k, label, unit, dv]) => `${k} = ${label}, in ${unit} (100% DV = ${dv} ${unit})`).join('\n');

const MICROS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      key: { type: 'string', enum: NUTRIENTS.map((n) => n[0]) },
      amount: { type: 'number' },
    },
    required: ['key', 'amount'],
    additionalProperties: false,
  },
};

const CATEGORIES = ['Protein', 'Grain', 'Vegetable', 'Fruit', 'Dairy', 'Fat', 'Snack', 'Other'];
const SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean' },
    name: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
    emoji: { type: 'string' },
    serving: { type: 'string' },
    kcal: { type: 'number' },
    protein: { type: 'number' },
    carbs: { type: 'number' },
    fat: { type: 'number' },
    micros: MICROS_SCHEMA,
    note: { type: 'string' },
  },
  required: ['readable', 'name', 'category', 'emoji', 'serving', 'kcal', 'protein', 'carbs', 'fat', 'micros', 'note'],
  additionalProperties: false,
};

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          emoji: { type: 'string' },
          match_id: { type: 'string' },
          servings: { type: 'number' },
          serving: { type: 'string' },
          kcal: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          micros: MICROS_SCHEMA,
          slot: { type: 'string', enum: SLOTS },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          assumption: { type: 'string' },
        },
        required: ['name', 'emoji', 'match_id', 'servings', 'serving', 'kcal', 'protein', 'carbs', 'fat', 'micros', 'slot', 'confidence', 'assumption'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['items', 'summary'],
  additionalProperties: false,
};

const LABEL_SYSTEM = `You transcribe photos of food nutrition labels (US Nutrition Facts panels, EU/UK/Canadian/Australian nutrition information tables, and similar) into data for a personal food diary.

How to read the label:
- Report the values for ONE serving as the label declares it, and put the label's serving description in "serving" exactly as printed (e.g. "2/3 cup (55g)"). If there is a "per serving" and a "per container" column, use per serving. If the label only gives per 100 g / 100 ml, use "100 g" (or "100 ml") as the serving.
- Calories go in kcal. If only kJ is printed, divide by 4.184.
- protein, carbs (total carbohydrate) and fat (total fat) in grams.
- micros: include every nutrient from the list below that the label states, converted to the listed unit. Where the label gives only a %DV, convert with the listed 100% DV amount. If the label gives salt but not sodium, sodium mg = salt g × 400. Leave out nutrients the label does not state; never estimate them. Nutrients not on the list (sugars, saturated fat, cholesterol, etc.) are ignored.

${NUTRIENT_TABLE}

Naming: if the product name or brand is visible anywhere in the photo, use it ("Brand Product"). Otherwise give a short plain name inferred from the label's ingredients or context, and say in "note" that the name is a guess. Pick the closest category and a single fitting emoji.

If the photo does not show a readable nutrition label (blurry, cut off, not a label), set readable to false, use 0 and empty values elsewhere, and say in "note" what went wrong so the person can retake it. Otherwise keep "note" to anything the person should double-check (e.g. a value that was hard to read), or leave it empty.`;

const MEAL_SYSTEM = `You help a person log what they ate into their food diary. You get a typed description, a photo of the food, or both. Turn it into diary items.

1. Identify each distinct food or drink eaten. Split combined dishes into components only when that makes the numbers more accurate (a burger is one item; a plate of salmon, rice and broccoli is three). Leave out anything clearly not eaten.

2. Match to the person's catalog first. The catalog below lists foods they already use, one per line as "id | name | serving | kcal per serving". Entries marked [mine] are their own custom foods, recipes and saved meals — prefer those whenever the name plausibly refers to the same thing (e.g. "my protein shake"). When an item is the same food as a catalog entry, set match_id to that entry's id and set servings to how many of that entry's servings were eaten (catalog serving "1 slice", ate two slices → 2). For a matched item, still fill in name, serving, kcal, protein, carbs and fat from the catalog entry's serving (your best estimate is fine for protein/carbs/fat), and leave micros empty: the app uses its stored data.

3. Otherwise estimate. Set match_id to "". Describe one serving in "serving" with an approximate weight or volume (e.g. "1 cup cooked (160 g)"), give nutrition for that one serving, and set servings to how many were eaten. For micros, estimate the nutrients from the list below that the food meaningfully provides (fiber, sodium and potassium at minimum when non-trivial); omit the rest.

${NUTRIENT_TABLE}

4. Portions from photos: judge size from cues such as plate diameter (a dinner plate is about 26–28 cm), utensils, hands, cups and packaging. Include visible cooking oil, butter, sauces, dressings and toppings, since they add a lot of calories. If the text says how much was eaten ("half", "a few bites"), that overrides the photo. Restaurant and chain items: use what you know of the chain's published nutrition.

5. Slot: use the meal the person names ("for breakfast", "snack"). If they describe several meals, give each item its own slot. If they don't say, use the default slot given with the request.

6. confidence: high for exact matches or clearly stated amounts, medium for typical portions, low for guesses from an unclear photo. "assumption": one short phrase stating the amount or preparation you assumed (e.g. "about 1½ cups, cooked in oil"), or "" if nothing was assumed.

summary: one or two sentences for the person, naming the biggest assumptions so they know what to check. If you could not identify any food, return an empty items list and explain why in summary.`;

const GROCERY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          emoji: { type: 'string' },
          is_food: { type: 'boolean' },
          match_id: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          servings_per_unit: { type: 'number' },
          serving: { type: 'string' },
          kcal: { type: 'number' },
          protein: { type: 'number' },
          carbs: { type: 'number' },
          fat: { type: 'number' },
          micros: MICROS_SCHEMA,
          shelf_life_days: { type: 'number' },
          low_at: { type: 'number' },
          purchase_date: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['name', 'emoji', 'is_food', 'match_id', 'quantity', 'unit', 'servings_per_unit', 'serving', 'kcal', 'protein', 'carbs', 'fat', 'micros', 'shelf_life_days', 'low_at', 'purchase_date', 'note'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
  },
  required: ['items', 'summary'],
  additionalProperties: false,
};

const GROCERY_SYSTEM = `You turn a grocery purchase into items for a person's home food inventory. You get a photo of a receipt, a photo of the groceries themselves, a typed list, or a combination, plus today's date.

1. List each distinct product bought. Receipts abbreviate heavily ("GRK YGRT 32OZ", "ORG BNLS CHKN BRST"): expand them to plain names. Combine repeated lines for the same product into one item. Mark non-food lines (bags, paper towels, soap, deposits, tax, coupons) with is_food false; keep them in the list so the person can see they were skipped.

2. Match to the person's catalog first. The catalog lists foods they already use as "id | name | serving | kcal per serving"; [mine] marks their own foods. When an item is the same food, set match_id to that id; otherwise "".

3. Quantity and unit: quantity is how many units were bought, in the unit people count that product in at home: "eggs" for eggs (a dozen = 12 eggs), "tub", "bag", "carton", "loaf", "lb", "can", "bottle", "bunch", and so on. servings_per_unit is how many servings of the matched catalog entry (or, for a new food, of the serving you describe) one unit holds, e.g. a 32 oz tub of yogurt with a 3/4 cup serving holds about 5.3; one egg is 1 serving of a "1 large egg" entry. Use package sizes printed on the receipt or package; otherwise typical US package sizes.

4. For an item with no catalog match, describe one serving in "serving" (e.g. "1 cup (30 g)") and give per-serving kcal, protein, carbs and fat; micros only for nutrients the food meaningfully provides, using these keys and units:
${NUTRIENT_TABLE}
For a matched item, fill these from the catalog serving as best you can and leave micros empty.

5. shelf_life_days: how many days from purchase the item typically stays good when stored the usual way (fresh spinach about 5, berries 4, raw chicken 2, milk 7, eggs 28, hard cheese 30, bread 6, canned goods 365, frozen items 120). Use a date printed on the package in the photo when you can read one, converted to days from the purchase date. low_at: the quantity, in the item's unit, at which a typical household would want to buy more (e.g. 2 eggs, 0.25 tub, 0 for single items like a bag of flour that are bought when used up).

6. purchase_date: the date printed on a receipt as YYYY-MM-DD, otherwise "". note: anything uncertain the person should check (e.g. "size not on receipt; assumed 16 oz"), or "".

summary: one or two sentences, naming the main assumptions. If you could not read anything, return no items and explain in summary.`;

type ImageIn = { media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string };
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_B64 = 6_500_000; // ~5 MB decoded, the API's per-image limit

async function authorize(req: Request): Promise<string | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return 'Sign in to Cloud sync first.';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return 'Your Cloud sync session expired. Sign in again.';
  const allowed = (Deno.env.get('ALLOWED_EMAILS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return 'The ALLOWED_EMAILS secret is not set on the claude-food function.';
  if (!allowed.includes((data.user.email || '').toLowerCase())) return 'This account is not on the claude-food allow list.';
  return null;
}

function imageBlock(img: ImageIn): Anthropic.Beta.BetaImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const denied = await authorize(req);
  if (denied) return json({ error: denied }, 401);

  let body: { task?: string; image?: ImageIn; text?: string; catalog?: string; slot?: string; today?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'The ANTHROPIC_API_KEY secret is not set on the claude-food function.' }, 500);
  if (body.task === 'ping') return json({ ok: true });

  const img = body.image;
  if (img && (!IMAGE_TYPES.includes(img.media_type) || typeof img.data !== 'string' || img.data.length > MAX_IMAGE_B64)) {
    return json({ error: 'Unsupported or oversized image' }, 400);
  }
  const text = (body.text || '').slice(0, 4000).trim();

  let system: Anthropic.Beta.BetaTextBlockParam[];
  let content: Anthropic.Beta.BetaContentBlockParam[];
  let schema: Record<string, unknown>;
  let effort: 'low' | 'medium';

  if (body.task === 'label') {
    if (!img) return json({ error: 'No photo' }, 400);
    system = [{ type: 'text', text: LABEL_SYSTEM }];
    content = [imageBlock(img), { type: 'text', text: 'Transcribe this nutrition label.' }];
    schema = LABEL_SCHEMA;
    effort = 'low';
  } else if (body.task === 'meal') {
    if (!img && !text) return json({ error: 'Describe what you ate or add a photo' }, 400);
    const catalog = (body.catalog || '').slice(0, 400_000);
    const slot = SLOTS.includes(body.slot || '') ? body.slot : 'Snacks';
    // The catalog is stable between requests, so it sits in the cached prefix.
    system = [
      { type: 'text', text: MEAL_SYSTEM },
      { type: 'text', text: 'Catalog:\n' + (catalog || '(empty)'), cache_control: { type: 'ephemeral' } },
    ];
    content = [];
    if (img) content.push(imageBlock(img));
    content.push({ type: 'text', text: `Default slot: ${slot}\n\n` + (text || 'Log the food in this photo.') });
    schema = MEAL_SCHEMA;
    effort = 'medium';
  } else if (body.task === 'groceries') {
    if (!img && !text) return json({ error: 'Add a receipt or grocery photo, or type a list' }, 400);
    const catalog = (body.catalog || '').slice(0, 400_000);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : new Date().toISOString().slice(0, 10);
    system = [
      { type: 'text', text: GROCERY_SYSTEM },
      { type: 'text', text: 'Catalog:\n' + (catalog || '(empty)'), cache_control: { type: 'ephemeral' } },
    ];
    content = [];
    if (img) content.push(imageBlock(img));
    content.push({ type: 'text', text: `Today: ${today}\n\n` + (text || 'Add the groceries in this photo.') });
    schema = GROCERY_SCHEMA;
    effort = 'medium';
  } else {
    return json({ error: 'Unknown task' }, 400);
  }

  const client = new Anthropic();
  try {
    // Streamed so a long receipt can use a large output budget without the
    // request timing out; finalMessage() collects the whole response.
    const response = await client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    }).finalMessage();

    if (response.stop_reason === 'refusal') return json({ error: 'Claude declined this request.' }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'The response was cut off. Try fewer items at once.' }, 422);
    const out = response.content.find((b) => b.type === 'text');
    if (!out || out.type !== 'text') return json({ error: 'Claude returned no answer' }, 502);
    return json({ result: JSON.parse(out.text), usage: response.usage });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'The Anthropic API key was rejected.' }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Rate limited by the Anthropic API. Try again in a minute.' }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `Anthropic API error ${e.status}: ${e.message}` }, 502);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
