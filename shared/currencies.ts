export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  locale: string;
  decimals: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US", decimals: 2 },
  { code: "EUR", name: "Euro", symbol: "€", locale: "de-DE", decimals: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB", decimals: 2 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", locale: "en-CA", decimals: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", locale: "en-AU", decimals: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", locale: "ja-JP", decimals: 0 },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF", locale: "de-CH", decimals: 2 },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥", locale: "zh-CN", decimals: 2 },
  { code: "INR", name: "Indian Rupee", symbol: "₹", locale: "en-IN", decimals: 2 },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", locale: "pt-BR", decimals: 2 },
  { code: "MXN", name: "Mexican Peso", symbol: "MX$", locale: "es-MX", decimals: 2 },
  { code: "KRW", name: "South Korean Won", symbol: "₩", locale: "ko-KR", decimals: 0 },
  { code: "SEK", name: "Swedish Krona", symbol: "kr", locale: "sv-SE", decimals: 2 },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr", locale: "nb-NO", decimals: 2 },
  { code: "DKK", name: "Danish Krone", symbol: "kr", locale: "da-DK", decimals: 2 },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", locale: "en-SG", decimals: 2 },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$", locale: "en-HK", decimals: 2 },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", locale: "en-NZ", decimals: 2 },
  { code: "ZAR", name: "South African Rand", symbol: "R", locale: "en-ZA", decimals: 2 },
  { code: "TRY", name: "Turkish Lira", symbol: "₺", locale: "tr-TR", decimals: 2 },
  { code: "PLN", name: "Polish Zloty", symbol: "zł", locale: "pl-PL", decimals: 2 },
  { code: "THB", name: "Thai Baht", symbol: "฿", locale: "th-TH", decimals: 2 },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪", locale: "he-IL", decimals: 2 },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", locale: "ar-AE", decimals: 2 },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼", locale: "ar-SA", decimals: 2 },
  { code: "PHP", name: "Philippine Peso", symbol: "₱", locale: "en-PH", decimals: 2 },
  { code: "TWD", name: "Taiwan Dollar", symbol: "NT$", locale: "zh-TW", decimals: 2 },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM", locale: "ms-MY", decimals: 2 },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp", locale: "id-ID", decimals: 0 },
  { code: "COP", name: "Colombian Peso", symbol: "COL$", locale: "es-CO", decimals: 0 },
  { code: "ARS", name: "Argentine Peso", symbol: "AR$", locale: "es-AR", decimals: 2 },
  { code: "CLP", name: "Chilean Peso", symbol: "CLP$", locale: "es-CL", decimals: 0 },
  { code: "PEN", name: "Peruvian Sol", symbol: "S/.", locale: "es-PE", decimals: 2 },
];

export const CURRENCY_MAP: Record<string, CurrencyInfo> = Object.fromEntries(
  CURRENCIES.map(c => [c.code, c])
);

export function getCurrencyInfo(code: string): CurrencyInfo {
  const upper = code?.toUpperCase().trim();
  const info = CURRENCY_MAP[upper];
  if (!info) {
    console.warn(`[currencies] Unknown currency code "${code}" — falling back to USD`);
    return CURRENCY_MAP["USD"];
  }
  return info;
}

export function formatCurrencyAmount(value: number | string | null | undefined, currencyCode: string = "USD"): string {
  const num = Number(value);
  if (isNaN(num)) return "$0.00";
  const info = getCurrencyInfo(currencyCode);
  try {
    return new Intl.NumberFormat(info.locale, {
      style: "currency",
      currency: info.code,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(num);
  } catch {
    return `${info.symbol}${num.toFixed(info.decimals)}`;
  }
}
