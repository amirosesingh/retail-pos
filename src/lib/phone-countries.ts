export type PhoneCountry = { code: string; name: string; dial: string };

/** Common international calling codes, ordered for a compact scrollable picker. */
export const PHONE_COUNTRIES: PhoneCountry[] = [
  { code: "BN", name: "Brunei", dial: "+673" },
  { code: "MY", name: "Malaysia", dial: "+60" },
  { code: "SG", name: "Singapore", dial: "+65" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "PH", name: "Philippines", dial: "+63" },
  { code: "TH", name: "Thailand", dial: "+66" },
  { code: "VN", name: "Vietnam", dial: "+84" },
  { code: "KH", name: "Cambodia", dial: "+855" },
  { code: "LA", name: "Laos", dial: "+856" },
  { code: "MM", name: "Myanmar", dial: "+95" },
  { code: "CN", name: "China", dial: "+86" },
  { code: "HK", name: "Hong Kong", dial: "+852" },
  { code: "MO", name: "Macau", dial: "+853" },
  { code: "TW", name: "Taiwan", dial: "+886" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KR", name: "South Korea", dial: "+82" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "PK", name: "Pakistan", dial: "+92" },
  { code: "BD", name: "Bangladesh", dial: "+880" },
  { code: "LK", name: "Sri Lanka", dial: "+94" },
  { code: "NP", name: "Nepal", dial: "+977" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "QA", name: "Qatar", dial: "+974" },
  { code: "BH", name: "Bahrain", dial: "+973" },
  { code: "KW", name: "Kuwait", dial: "+965" },
  { code: "OM", name: "Oman", dial: "+968" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "IE", name: "Ireland", dial: "+353" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "NL", name: "Netherlands", dial: "+31" },
  { code: "US", name: "United States", dial: "+1" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "MX", name: "Mexico", dial: "+52" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "ZA", name: "South Africa", dial: "+27" },
];

export function internationalPhone(country: PhoneCountry, localNumber: string): string {
  const digits = localNumber.replace(/\D/g, "").replace(/^0+/, "");
  return `${country.dial}${digits}`;
}
