/**
 * Model pricing in USD per million tokens. Approximate and configurable
 * later; prefix-matched against `message.model` (longest key wins).
 */
export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 5 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
  'claude-3-7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
}

export function matchPrice(model: string | null): ModelPrice | null {
  if (model === null) return null
  let best: { key: string; price: ModelPrice } | null = null
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (model.startsWith(key) && (best === null || key.length > best.key.length)) {
      best = { key, price }
    }
  }
  return best?.price ?? null
}

export interface TokenCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Cost in USD cents; null when the model is unpriced. */
export function costCents(tokens: TokenCounts, model: string | null): number | null {
  const price = matchPrice(model)
  if (price === null) return null
  const usd =
    (tokens.input / 1e6) * price.input +
    (tokens.output / 1e6) * price.output +
    (tokens.cacheRead / 1e6) * price.cacheRead +
    (tokens.cacheWrite / 1e6) * price.cacheWrite
  return Math.round(usd * 100)
}
