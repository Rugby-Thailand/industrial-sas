import net from "node:net";
import { once } from "node:events";

const refuse = (port) => {
  throw new Error(
    `HR_E2E_PORT_IN_USE: ${port}; refusing to reuse or stop another service`,
  );
};

/** True when something accepts a loopback TCP connection on this port. */
async function accepts(port, host) {
  const socket = net.connect({ port, host });
  try {
    await Promise.race([
      once(socket, "connect"),
      new Promise((_, reject) => setTimeout(reject, 1_000)),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    socket.destroy();
  }
}

/**
 * Check both families and both specific/wildcard binds. On macOS an exact
 * loopback bind still succeeds beside another process's 0.0.0.0/:: listener,
 * so binds alone miss Node/Next defaults; a connect probe catches any listener.
 */
export async function requireHrPortFree(port) {
  for (const host of ["127.0.0.1", "::1"])
    if (await accepts(port, host)) refuse(port);
  for (const host of ["127.0.0.1", "::1", "0.0.0.0", "::"]) {
    const server = net.createServer();
    try {
      server.listen({ port, host });
      await once(server, "listening");
    } catch {
      refuse(port);
    } finally {
      if (server.listening)
        await new Promise((resolve) => server.close(resolve));
    }
  }
}
