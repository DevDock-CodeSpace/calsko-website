// Course prices: whole rupees (India) and US cents (everywhere else). Empty = free in that currency.

export type Prices = { price_inr: number | null; price_usd_cents: number | null }

/** Rupees for visitors whose browser says India (language or time zone), dollars for everyone else. */
export function visitorCurrency(): 'inr' | 'usd' {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const langs = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]
  return zone === 'Asia/Kolkata' || zone === 'Asia/Calcutta' || langs.some((l) => /-IN$/i.test(l)) ? 'inr' : 'usd'
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export const isFree = (p: Prices) => p.price_inr === null && p.price_usd_cents === null

/** "₹999", "$15.00" or "Free"; the other currency when only it is set. */
export function formatPrice(p: Prices, currency = visitorCurrency()): string {
  if (isFree(p)) return 'Free'
  const rupees = p.price_inr !== null ? inr.format(p.price_inr) : null
  const dollars = p.price_usd_cents !== null ? usd.format(p.price_usd_cents / 100).replace(/\.00$/, '') : null
  return (currency === 'inr' ? (rupees ?? dollars) : (dollars ?? rupees)) ?? 'Free'
}

/** Both prices for a teacher's eyes: "₹999 · $15" or "Free". */
export function formatBothPrices(p: Prices): string {
  if (isFree(p)) return 'Free'
  return [p.price_inr !== null && inr.format(p.price_inr), p.price_usd_cents !== null && usd.format(p.price_usd_cents / 100).replace(/\.00$/, '')]
    .filter(Boolean)
    .join(' · ')
}
