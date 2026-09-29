import type { Job } from '../types';

/**
 * Optional LLM assist for emails the heuristics can't fully place.
 * Gemini's API has a free tier for personal use, but check its current data-use terms
 * before sending real customer/medical shipment data: free-tier prompts may be used to improve Google's products.
 * Swap `endpoint`/`buildRequest` for the Claude API when this goes commercial.
 */
export interface LlmConfig {
  apiKey: string;
  /** e.g. a current Gemini Flash model id — set in server env, not hard-coded. */
  model: string;
  fetchImpl?: typeof fetch;
}

const place = {
  type: 'OBJECT',
  properties: { name: { type: 'STRING' }, address: { type: 'STRING' }, contactName: { type: 'STRING' }, contactPhone: { type: 'STRING' }, isAirCargo: { type: 'BOOLEAN' } },
};
const leg = {
  type: 'OBJECT',
  properties: { place, timeIso: { type: 'STRING', description: 'ISO 8601 with offset if a date/time is given' }, timeText: { type: 'STRING' }, notes: { type: 'STRING' } },
};
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    orderNumber: { type: 'STRING' },
    references: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, value: { type: 'STRING' } } } },
    pickup: leg,
    delivery: leg,
    cargo: { type: 'OBJECT', properties: { pieces: { type: 'INTEGER' }, weight: { type: 'STRING' }, dimensions: { type: 'STRING' }, commodity: { type: 'STRING' } } },
    notes: { type: 'STRING', description: 'Every remaining fact from the email that fits no other field. Do not repeat information used elsewhere.' },
  },
};

const PROMPT = `You extract courier job details from an email a dispatcher sent to a driver.
Put each piece of information in exactly one field. Anything that fits no field goes in "notes", verbatim.
Never invent values. Omit fields that are absent. Ignore greetings and signatures.`;

export interface LlmParse {
  name?: string;
  orderNumber?: string;
  references?: { label: string; value: string }[];
  pickup?: LlmLeg;
  delivery?: LlmLeg;
  cargo?: Job['cargo'];
  notes?: string;
}
interface LlmLeg {
  place?: { name?: string; address?: string; contactName?: string; contactPhone?: string; isAirCargo?: boolean };
  timeIso?: string; timeText?: string; notes?: string;
}

export async function parseWithLlm(cfg: LlmConfig, input: { subject: string; text: string }): Promise<LlmParse> {
  const f = cfg.fetchImpl ?? fetch;
  const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `Subject: ${input.subject}\n\n${input.text}` }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(`LLM parse failed: ${res.status}`);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('LLM parse returned no content');
  return JSON.parse(text) as LlmParse;
}
