/**
 * src/lib/gtin.js — barcode sanity, before any network call.
 *
 * A camera decode can land a wrong digit (a smear, a fold in the foil), and a
 * wrong digit is indistinguishable from "not in the catalogue" once it reaches
 * the lookup: both end at an empty editor. GS1 puts a check digit in every
 * EAN/UPC/GTIN, so a bad one is a misread and worth another scan rather than
 * a dead end.
 *
 * Only the four numeric retail lengths are judged. Anything else (a QR code's
 * text, a 5-digit price-embedded code) passes through untouched.
 */
export function gtinValid(raw) {
  const s = String(raw || '').trim();
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return true;
  const digits = [...s].map(Number);
  const given = digits.pop();
  let sum = 0;
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === given;
}
