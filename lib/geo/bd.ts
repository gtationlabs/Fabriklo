/**
 * Bangladesh divisions and districts (8 / 64). Mirrors public.bd_districts,
 * which the server uses as the source of truth when validating an order.
 */
export const BD_DIVISIONS: Record<string, readonly string[]> = {
  Barishal: ["Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"],
  Chattogram: ["Bandarban", "Brahmanbaria", "Chandpur", "Chattogram", "Cox's Bazar", "Cumilla", "Feni", "Khagrachhari", "Lakshmipur", "Noakhali", "Rangamati"],
  Dhaka: ["Dhaka", "Faridpur", "Gazipur", "Gopalganj", "Kishoreganj", "Madaripur", "Manikganj", "Munshiganj", "Narayanganj", "Narsingdi", "Rajbari", "Shariatpur", "Tangail"],
  Khulna: ["Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira"],
  Mymensingh: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
  Rajshahi: ["Bogura", "Chapainawabganj", "Joypurhat", "Naogaon", "Natore", "Pabna", "Rajshahi", "Sirajganj"],
  Rangpur: ["Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari", "Panchagarh", "Rangpur", "Thakurgaon"],
  Sylhet: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
};

export const BD_DISTRICTS: readonly string[] = Object.values(BD_DIVISIONS).flat().sort((a, b) => a.localeCompare(b));

export function divisionOf(district: string): string | null {
  for (const [division, districts] of Object.entries(BD_DIVISIONS)) if (districts.includes(district)) return division;
  return null;
}

/**
 * Normalises a Bangladesh mobile number to E.164 (+8801XXXXXXXXX).
 * Accepts 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX with spaces or dashes.
 * Returns null for anything that is not a valid BD mobile number.
 */
export function normalizeBdPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  const m = /^(?:\+?88)?(01[3-9]\d{8})$/.exec(digits);
  return m ? `+88${m[1]}` : null;
}
