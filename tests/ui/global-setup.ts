// The web server answering does not mean the API and gateway are up yet.
export default async function globalSetup() {
  const deadline = Date.now() + 120_000;
  for (const url of ['http://127.0.0.1:4001/health', 'http://localhost:4173/api/v1/auth/directives']) {
    for (;;) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`UI test stack did not come up: ${url}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
