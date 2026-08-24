import openpyxl, json, unicodedata

wb = openpyxl.load_workbook('/app/unlocode.xlsx', read_only=True)
ws = wb['Ports']
rows = ws.iter_rows(min_row=1, values_only=True)
header = next(rows)
idx = {h: i for i, h in enumerate(header)}

def norm(s):
    if not s:
        return ""
    s = unicodedata.normalize('NFKD', str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.strip()

seen = set()
ports = []
for r in rows:
    name = norm(r[idx['Name']]) or norm(r[idx['NameWoDiacritics']])
    country = (r[idx['CountryName']] or "").strip()
    code = (r[idx['UNLOCODE']] or "").strip()
    if not code or not name:
        continue
    if code in seen:
        continue
    seen.add(code)
    ports.append({"n": name, "c": country, "u": code})

ports.sort(key=lambda p: (p["c"], p["n"]))
print("total ports:", len(ports))

lines = []
lines.append("// AUTO-GENERATED from UN/LOCODE sea ports + India ICD dataset. Do not edit by hand.")
lines.append("// Fields: name (n), country (c), unlocode (u).")
lines.append("")
lines.append("export type Port = { name: string; country: string; code: string };")
lines.append("")
lines.append("export const PORTS: Port[] = [")
for p in ports:
    n = json.dumps(p["n"], ensure_ascii=False)
    c = json.dumps(p["c"], ensure_ascii=False)
    u = json.dumps(p["u"], ensure_ascii=False)
    lines.append(f"  {{ name: {n}, country: {c}, code: {u} }},")
lines.append("];")
lines.append("")
lines.append("""// Normalise for diacritic/case-insensitive matching.
function normalize(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// Precomputed lowercase search keys (name only, per requirement).
const SEARCH_KEYS: string[] = PORTS.map((p) => normalize(p.name));

// Search ports by NAME only. Prefix matches rank above substring matches.
export function searchPorts(query: string, limit: number = 30): Port[] {
  const q = normalize(query);
  if (!q) return [];
  const prefix: Port[] = [];
  const contains: Port[] = [];
  for (let i = 0; i < PORTS.length; i++) {
    const key = SEARCH_KEYS[i];
    const at = key.indexOf(q);
    if (at === 0) prefix.push(PORTS[i]);
    else if (at > 0) contains.push(PORTS[i]);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...contains].slice(0, limit);
}
""")

with open('/app/frontend/data/ports.ts', 'w', encoding='utf-8') as f:
    f.write("\n".join(lines))
print("written /app/frontend/data/ports.ts")
