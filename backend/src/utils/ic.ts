/**
 * backend/src/utils/ic.ts
 *
 * Malaysian IC / birth-certificate number validation and normalization.
 *
 * Format: YYMMDD-PB-###G  (12 digits total; dashes optional on input)
 *   YYMMDD = date of birth
 *   PB     = place-of-birth / state code
 *   ###G   = serial + gender digit (odd = male, even = female)
 *
 * IMPORTANT CAVEATS — read before relying on this in production:
 *   1. Malaysian IC numbers carry NO checksum digit. This is format +
 *      plausibility validation only, not cryptographic/official verification.
 *      A syntactically valid-looking number is not proof the IC is real.
 *   2. The century (19xx vs 20xx) is NOT encoded in the number. We guess it
 *      by picking whichever century doesn't land in the future — this is a
 *      heuristic every IC-consuming system has to live with, and it can be
 *      wrong for edge cases (e.g. very old citizens close to the rollover).
 *      If you have another source of truth for date of birth, prefer that
 *      over the guess in `dateOfBirth`.
 *   3. `likelyType` (adult_ic vs birth_cert) is a guess based on implied age,
 *      not a real distinction the number format makes. Malaysian birth
 *      certificates for children use the same 12-digit shape as adult ICs,
 *      so there's no structural way to tell them apart from the digits alone.
 *   4. This does NOT validate the place-of-birth/state code against the
 *      official JPN code table — that table is long, has historical
 *      variants, and getting it wrong would incorrectly reject real ICs.
 *      If strict state-code validation matters for your use case, source
 *      the official table and add that check separately.
 */

export interface ICValidationResult {
  valid: boolean;
  normalized?: string; // 12 digits, no dashes — store/compare this
  formatted?: string; // YYMMDD-PB-####  — display this
  dateOfBirth?: string; // ISO YYYY-MM-DD, best-effort century guess (see caveat #2)
  likelyType?: "adult_ic" | "birth_cert"; // best-effort guess (see caveat #3)
  error?: string;
}

export function normalizeIC(raw: string): string {
  return (raw ?? "").replace(/[^0-9]/g, "");
}

export function validateIC(raw: string): ICValidationResult {
  const digits = normalizeIC(raw);

  if (digits.length !== 12) {
    return { valid: false, error: "IC/出生证号码必须是12位数字" };
  }

  const yy = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const dd = digits.slice(4, 6);
  const stateCode = digits.slice(6, 8);

  const month = Number(mm);
  const day = Number(dd);

  if (month < 1 || month > 12) {
    return { valid: false, error: "出生日期(月份)不合法" };
  }

  // Century guess: try 20xx first, fall back to 19xx if that would be a future date.
  const now = new Date();
  let fullYear = 2000 + Number(yy);
  let candidate = new Date(fullYear, month - 1, day);
  if (candidate > now || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) {
    // either lands in the future, or the day was out of range for that month
    // (e.g. day=31 in a 30-day month) — try the other century before giving up
    fullYear = 1900 + Number(yy);
    candidate = new Date(fullYear, month - 1, day);
    if (candidate.getMonth() !== month - 1 || candidate.getDate() !== day) {
      return { valid: false, error: "出生日期(日期)不合法" };
    }
  }

  const dateOfBirth = `${String(fullYear).padStart(4, "0")}-${mm}-${dd}`;

  let ageYears = now.getFullYear() - fullYear;
  const hadBirthdayThisYear =
    now.getMonth() + 1 > month || (now.getMonth() + 1 === month && now.getDate() >= day);
  if (!hadBirthdayThisYear) ageYears -= 1;

  return {
    valid: true,
    normalized: digits,
    formatted: `${yy}${mm}${dd}-${stateCode}-${digits.slice(8)}`,
    dateOfBirth,
    likelyType: ageYears < 12 ? "birth_cert" : "adult_ic",
  };
}
