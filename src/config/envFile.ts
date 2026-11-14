import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Update or append KEY=value in a dotenv file without disturbing other lines or comments. */
export function updateEnvValue(filePath: string, key: string, value: string): void {
  const lines = existsSync(filePath) ? readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`);
  let replaced = false;
  const next = lines.map((line) => {
    if (!pattern.test(line)) return line;
    replaced = true;
    return `${key}=${value}`;
  });
  if (!replaced) next.push(`${key}=${value}`);
  writeFileSync(filePath, next.join("\n"));
}
