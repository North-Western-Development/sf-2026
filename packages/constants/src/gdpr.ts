/**
 * Places where the GDPR (or the UK GDPR) applies, for instances that turn on BLOCK_EU: the 27 EU
 * states with their outermost regions, the EEA states, the UK and Gibraltar. Used to refuse sign-up
 * emails, phone numbers and network addresses from there.
 */

/** ISO 3166 country codes, as IP-to-country databases report them. */
export const GDPR_COUNTRIES = [
  // EU
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EU outermost regions and Åland, which have codes of their own
  'AX', 'GF', 'GP', 'MQ', 'MF', 'RE', 'YT',
  // EEA
  'IS', 'LI', 'NO',
  // UK GDPR
  'GB', 'GI',
] as const;

/** Calling codes of those countries (with Réunion/Mayotte, the French Antilles and Guiana). */
export const GDPR_CALLING_CODES = [
  '+30', '+31', '+32', '+33', '+34', '+36', '+39', '+40', '+43', '+44', '+45', '+46', '+47', '+48', '+49',
  '+262', '+350', '+351', '+352', '+353', '+354', '+356', '+357', '+358', '+359', '+370', '+371', '+372',
  '+385', '+386', '+420', '+421', '+423', '+590', '+594', '+596',
] as const;

/** Email domains under these top-level domains are refused: country, EU and regional ones. */
export const GDPR_EMAIL_TLDS = [
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl',
  'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'ax', 'gf', 'gp', 'mq', 'mf', 're', 'yt', 'is', 'li', 'no', 'uk', 'gi', 'eu',
  // Internationalized: .ευ, .ею (EU), .ελ (Greece), .бг (Bulgaria)
  'xn--qxa6a', 'xn--e1a4c', 'xn--qxam', 'xn--90ae',
  // Regional
  'alsace', 'amsterdam', 'barcelona', 'bayern', 'berlin', 'brussels', 'bzh', 'cat', 'cologne', 'corsica', 'cymru', 'eus',
  'frl', 'gal', 'gent', 'hamburg', 'koeln', 'london', 'madrid', 'nrw', 'paris', 'ruhr', 'saarland', 'scot', 'tirol',
  'vlaanderen', 'wales', 'wien',
] as const;

/** Providers based there that hand out addresses on generic top-level domains. */
export const GDPR_EMAIL_DOMAINS = [
  'gmx.net', 'posteo.net', 'mailbox.org', 'tutanota.com', 'tuta.com', 'tutamail.com', 'tuta.io', 'keemail.me',
  'laposte.net', 'telefonica.net', 'eircom.net', 'btinternet.com', 'btopenworld.com', 'virginmedia.com', 'ntlworld.com',
  'sky.com', 'talktalk.net',
] as const;

/** Whether an email address belongs to a domain from a GDPR country. */
export function isGdprEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@').pop()?.replace(/\.$/, '') ?? '';
  if (!domain.includes('.')) return false;
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  if ((GDPR_EMAIL_TLDS as readonly string[]).includes(tld)) return true;
  return GDPR_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Whether an E.164 phone number (+ and digits) is from a GDPR country. */
export function isGdprPhone(phone: string): boolean {
  const n = `+${phone.replace(/[^\d]/g, '')}`;
  return GDPR_CALLING_CODES.some((c) => n.startsWith(c));
}
