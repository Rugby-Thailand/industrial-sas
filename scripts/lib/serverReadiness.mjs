export async function waitForServer({
  probe,
  isAlive = () => true,
  attempts = 120,
  delayMs = 1_000,
  describe: what = "the server",
}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isAlive()) {
      throw new Error(`${what} exited before it listened`);
    }
    try {
      await probe();
      return attempt + 1;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `${what} did not accept a request within ${attempts} attempt(s)`,
  );
}
