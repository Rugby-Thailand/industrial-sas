import net from "node:net";
import { once } from "node:events";

/** Check both families: an IPv6 bind alone need not detect an IPv4 service. */
export async function requireHrPortFree(port) {
  for (const host of ["127.0.0.1", "::1"]) {
    const server = net.createServer();
    try {
      server.listen({ port, host });
      await once(server, "listening");
    } catch {
      throw new Error(
        `HR_E2E_PORT_IN_USE: ${port}; refusing to reuse or stop another service`,
      );
    } finally {
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    }
  }
}
