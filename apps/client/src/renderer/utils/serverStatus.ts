/**
 * Checks whether a Mini Voice server is online and joinable by hitting its
 * public HTTP `/preview` endpoint. A successful response means the server
 * process is actually running (more reliable than a raw TCP probe, which a
 * firewall can distort). Used for the online/offline indicators in the saved
 * servers list (home) and the server rail (sidebar) — #37.
 */
export async function checkServerOnline(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://${host}:${port}/preview`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
