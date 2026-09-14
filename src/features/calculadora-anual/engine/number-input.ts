export type NumberFieldFormat = "integer" | "decimal";

const TRANSIENT_TOKENS = new Set(["", "-", ".", ",", "-.", "-,"]);

export const isTransientNumericInput = (raw: string) => TRANSIENT_TOKENS.has(raw.trim());

export const inferDecimalDigitsFromStep = (step: number, fallback = 2) => {
  if (!Number.isFinite(step)) return fallback;
  const [, decimal = ""] = String(step).split(".");
  return decimal.length > 0 ? Math.min(decimal.length, 6) : fallback;
};

export const parseLooseNumber = (raw: string) => {
  const value = raw.trim().replace(/\s+/g, "");
  if (isTransientNumericInput(value)) return null;

  const hasComma = value.includes(",");
  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");

  let normalized = value;
  // pt-BR: sem vírgula, "." seguido de grupo de 3 dígitos é separador de milhar
  // ("6.800" = 6800, "1.234.567" = 1234567). Senão, "." é decimal ("6.8").
  if (!hasComma && /^-?\d{1,3}(\.\d{3})+$/.test(value)) {
    normalized = value.split(".").join("");
  } else {
    const decimalSeparator =
      lastComma === -1 && lastDot === -1 ? null : lastComma > lastDot ? "," : ".";

    if (decimalSeparator) {
      const thousandsSeparator = decimalSeparator === "," ? "." : ",";
      normalized = normalized.split(thousandsSeparator).join("");
      if (decimalSeparator === ",") {
        normalized = normalized.replace(",", ".");
      }
    }
  }

  normalized = normalized.replace(/[^\d.-]/g, "");
  if ((normalized.match(/-/g) ?? []).length > 1) return Number.NaN;
  if (normalized.includes("-") && !normalized.startsWith("-")) return Number.NaN;
  if ((normalized.match(/\./g) ?? []).length > 1) return Number.NaN;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const formatNumberForDisplay = (
  value: number,
  format: NumberFieldFormat,
  decimalDigits = 2,
) => {
  if (format === "integer") {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(Math.round(value));
  }

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimalDigits,
    maximumFractionDigits: decimalDigits,
  }).format(value);
};
