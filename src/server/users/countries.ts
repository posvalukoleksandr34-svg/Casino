/**
 * Country of residence and phone-region reference data, built on the server
 * and passed to the browser as plain props (the libraries stay out of the
 * client bundle).
 *
 *   Countries      ISO 3166-1 alpha-2 codes from i18n-iso-countries (the 249
 *                  assigned codes plus XK, Kosovo, which the package includes).
 *   Display names  CLDR via Intl.DisplayNames ("Côte d’Ivoire"), falling back
 *                  to the package's English name.
 *   Calling codes  libphonenumber-js metadata. A few territories have no
 *                  telephone numbering of their own (e.g. AQ, BV, HM); they get
 *                  no suggestion and the player picks the phone region.
 *
 * Nothing here is inferred from the request: no IP geolocation.
 */
import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/max';

countries.registerLocale(en);

export interface CountryOption {
  code: string;
  name: string;
  /** Suggested international calling code without "+", or null when none exists. */
  callingCode: string | null;
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const phoneRegions = new Set<string>(getCountries());

function nameOf(code: string): string {
  return displayNames.of(code) ?? countries.getName(code, 'en') ?? code;
}

function callingCodeOf(code: string): string | null {
  return phoneRegions.has(code) ? getCountryCallingCode(code as CountryCode) : null;
}

const byName = (a: CountryOption, b: CountryOption) => a.name.localeCompare(b.name, 'en');

let residence: CountryOption[] | undefined;
let phone: CountryOption[] | undefined;

/** Every country of residence, sorted by English name. */
export function residenceCountries(): CountryOption[] {
  residence ??= Object.keys(countries.getAlpha2Codes())
    .map((code) => ({ code, name: nameOf(code), callingCode: callingCodeOf(code) }))
    .sort(byName);
  return residence;
}

/** Every phone numbering region libphonenumber knows (includes AC and TA, which are not ISO countries). */
export function phoneRegionOptions(): CountryOption[] {
  phone ??= [...phoneRegions].map((code) => ({ code, name: nameOf(code), callingCode: callingCodeOf(code) })).sort(byName);
  return phone;
}

export function isResidenceCountry(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && countries.isValid(code);
}

export function isPhoneRegion(code: string): code is CountryCode {
  return phoneRegions.has(code);
}

export function countryName(code: string | null | undefined): string | null {
  return code ? nameOf(code) : null;
}
