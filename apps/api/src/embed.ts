/** Stored pgvector width. schema.sql and migrations/004.sql use vector(64). */
export const EMBEDDING_DIMENSIONS = 64;

export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface Passage {
  name: string;
  content: string;
}

export interface Answerer {
  answer(question: string, passages: Passage[]): Promise<string>;
}

export interface HttpEmbedderOptions {
  url: string;
  apiKey: string;
  model: string;
}

export interface HttpAnswererOptions {
  url: string;
  apiKey: string;
  model: string;
}

function normalize(values: number[]): number[] {
  let sum = 0;
  for (const value of values) sum += value * value;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return values.map(() => 0);
  return values.map((value) => value / magnitude);
}

export function fitDimensions(values: number[], dimensions = EMBEDDING_DIMENSIONS): number[] {
  const fitted = new Array<number>(dimensions).fill(0);
  if (values.length === dimensions) {
    for (let index = 0; index < dimensions; index += 1) fitted[index] = Number.isFinite(values[index]) ? values[index] : 0;
    return fitted;
  }
  if (!values.length) return fitted;
  for (let index = 0; index < values.length; index += 1) {
    const bucket = Math.min(dimensions - 1, Math.floor((index * dimensions) / values.length));
    const value = values[index];
    if (Number.isFinite(value)) fitted[bucket] += value;
  }
  return fitted;
}

export function vectorLiteral(values: number[]): string {
  const fitted = fitDimensions(values);
  return `[${fitted.map((value) => (Number.isFinite(value) ? value.toFixed(8) : "0")).join(",")}]`;
}

/** Local token embedder. No network. Tests can inject a different Embedder. */
export function createHashEmbedder(dimensions = EMBEDDING_DIMENSIONS): Embedder {
  return {
    dimensions,
    async embed(texts) {
      return texts.map((text) => embedTokens(text, dimensions));
    },
  };
}

function embedTokens(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1);
  for (const token of tokens) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const bucket = Math.abs(hash) % dimensions;
    vector[bucket] += (hash & 16) === 0 ? 1 : -1;
  }
  return normalize(vector);
}

export function createHttpEmbedder(options: HttpEmbedderOptions): Embedder {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      const endpoint = options.url.endsWith("/embeddings") ? options.url : `${options.url.replace(/\/$/, "")}/embeddings`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: options.model, input: texts }),
      });
      if (!response.ok) {
        const error = new Error(`Embedding request failed (${response.status})`) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
      const rows = payload.data ?? [];
      return texts.map((_, index) => fitDimensions(rows[index]?.embedding ?? []));
    },
  };
}

export function createExtractiveAnswerer(): Answerer {
  return {
    async answer(_question, passages) {
      const top = passages[0];
      if (!top) return "Nothing you can access answers that.";
      const extra = passages.slice(1, 3).map((passage) => passage.name);
      const more = extra.length ? ` Also see ${extra.join(", ")}.` : "";
      return `From ${top.name}: ${top.content}${more}`;
    },
  };
}

export function createHttpAnswerer(options: HttpAnswererOptions): Answerer {
  return {
    async answer(question, passages) {
      const context = passages.map((passage) => `${passage.name}: ${passage.content}`).join("\n\n");
      const endpoint = options.url.endsWith("/chat/completions") ? options.url : `${options.url.replace(/\/$/, "")}/chat/completions`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            {
              role: "system",
              content: "Answer from the passages. If they do not contain the answer, say so. Do not use other files.",
            },
            { role: "user", content: `Passages:\n${context || "(none)"}\n\nQuestion: ${question}` },
          ],
        }),
      });
      if (!response.ok) throw new Error(`Answer request failed (${response.status})`);
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content?.trim();
      return text || "Nothing you can access answers that.";
    },
  };
}
