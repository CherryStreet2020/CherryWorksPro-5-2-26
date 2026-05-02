export function structuredLog(entry: Record<string, any>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
