// Integer-kopeck money model.
//
// New vacation money never touches binary floating point: rubles are parsed into
// whole kopecks and all arithmetic stays integer. Proportional allocation uses
// integer division plus a deterministic largest-remainder step, so the parts
// always add back up to the entered total.

export const MAX_KOPECKS = 1_000_000_000; // 10 000 000 ₽ net

export function toKopecks(value) {
  let text = value;
  if (typeof text === "number") {
    if (!Number.isFinite(text)) return null;
    text = String(text);
  }
  if (typeof text !== "string") return null;

  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;

  const rubles = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const kopecks = rubles * 100 + cents;

  if (!Number.isSafeInteger(kopecks) || kopecks > MAX_KOPECKS) return null;
  return kopecks;
}

function groupThousands(digits) {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += "\u00A0";
    out += digits[i];
  }
  return out;
}

export function formatKopecks(kopecks) {
  if (!Number.isSafeInteger(kopecks)) return "";
  const sign = kopecks < 0 ? "−" : "";
  const abs = Math.abs(kopecks);
  const rubles = Math.trunc(abs / 100);
  const cents = abs % 100;
  const body = groupThousands(String(rubles));
  return cents === 0 ? `${sign}${body}` : `${sign}${body},${String(cents).padStart(2, "0")}`;
}

// Splits `total` kopecks across integer weights. Parts differ by at most one
// kopeck; leftover kopecks go to the largest fractional remainders, ties are
// broken by the earlier index. Deterministic across runs and platforms.
export function splitKopecks(total, weights) {
  const parts = weights.map(() => 0);
  if (parts.length === 0) return parts;
  if (!Number.isSafeInteger(total) || total === 0) return parts;

  const positive = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? Math.floor(weight) : 0));
  const weightSum = positive.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) return parts;

  const remainders = [];
  let allocated = 0;
  positive.forEach((weight, index) => {
    const numerator = total * weight;
    const share = Math.floor(numerator / weightSum);
    parts[index] = share;
    allocated += share;
    remainders.push({ index, remainder: numerator - share * weightSum });
  });

  let leftover = total - allocated;
  const order = remainders
    .slice()
    .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));
  let cursor = 0;
  while (leftover > 0) {
    parts[order[cursor % order.length].index] += 1;
    leftover -= 1;
    cursor += 1;
  }

  return parts;
}
