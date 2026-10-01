const DECIMAL = /^([+-]?)([\d,]*)(?:\.(\d*))?$/;

/** Whole pence from a decimal amount of pounds as banks and brokers write it (`-1,234.5`); `null` if it is not one. */
export const penceOf = (pounds: string): number | null => {
  const match = DECIMAL.exec(pounds.trim());
  const whole = match?.[2]?.replaceAll(",", "") ?? "";
  const fraction = match?.[3] ?? "";
  if (match === null || (whole === "" && fraction === "")) {
    return null;
  }
  const pence = Number(whole || "0") * 100 + Math.round(Number(`0.${fraction || "0"}`) * 100);
  return match[1] === "-" ? -pence : pence;
};
