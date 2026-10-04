/**
 * Normalizes user input to +91XXXXXXXXXX, or null if it isn't a valid
 * Indian mobile number (10 digits starting 6-9; tolerates 0/+91 prefixes).
 */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let ten = digits;
  if (digits.length === 12 && digits.startsWith("91")) ten = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) ten = digits.slice(1);
  if (ten.length !== 10 || !/^[6-9]/.test(ten)) return null;
  return "+91" + ten;
}

/** "+919876543210" -> "98765 43210" for display */
export function formatPhoneForDisplay(phone: string): string {
  const ten = phone.replace(/^\+91/, "");
  return `${ten.slice(0, 5)} ${ten.slice(5)}`;
}
