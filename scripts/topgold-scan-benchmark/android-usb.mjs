// Connect only an explicitly selected, authorised physical Android over USB.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const options = process.argv.slice(2);
const serialArg = options.find((arg) => arg.startsWith("--serial="))?.slice(9);
const port = Number(process.env.DEVICE_BENCH_PORT || 3194);
const adb = [
  process.env.TOPGOLD_ADB,
  resolve(homedir(), "Library/Caches/TopGoldScan/platform-tools/adb"),
  resolve(homedir(), "Library/Android/sdk/platform-tools/adb"),
  "/opt/homebrew/bin/adb",
  "/usr/local/bin/adb",
].find((path) => path && existsSync(path));
if (!adb) {
  console.error(
    "ADB not found. Download Mac platform-tools from https://developer.android.com/tools/releases/platform-tools and set TOPGOLD_ADB=/absolute/path/to/adb",
  );
  process.exit(1);
}
const run = (args) =>
  execFileSync(adb, args, { encoding: "utf8", timeout: 20000 }).trim();
try {
  console.log(run(["version"]));
  const listing = run(["devices", "-l"]);
  console.log(listing);
  const devices = listing
    .split("\n")
    .slice(1)
    .map((line) => ({
      serial: line.split(/\s+/)[0],
      state: line.split(/\s+/)[1],
      line,
    }))
    .filter((row) => row.serial && row.line.includes("usb:"));
  const selected = serialArg
    ? devices.find((row) => row.serial === serialArg)
    : devices.length === 1
      ? devices[0]
      : null;
  if (!selected) {
    console.log(
      devices.length > 1
        ? "Multiple USB phones: rerun with --serial=DEVICE_SERIAL"
        : "No USB Android detected. Connect a data cable, unlock the phone and enable USB debugging.",
    );
    process.exitCode = 2;
  } else if (selected.state !== "device") {
    console.log(
      `Phone state: ${selected.state}. Accept 'Allow USB debugging' on the unlocked phone, then rerun this command.`,
    );
    process.exitCode = 2;
  } else {
    const args = ["-s", selected.serial];
    if (options.includes("--disconnect")) {
      run([...args, "reverse", "--remove", `tcp:${port}`]);
      console.log(`Removed USB forwarding for port ${port}.`);
    } else {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok)
        throw Error("The local test server did not respond successfully");
      run([...args, "reverse", `tcp:${port}`, `tcp:${port}`]);
      console.log(
        `USB forwarding ready. Open http://localhost:${port}/ in Chrome on the phone.`,
      );
      if (options.includes("--open"))
        run([
          ...args,
          "shell",
          "am",
          "start",
          "-a",
          "android.intent.action.VIEW",
          "-d",
          `http://localhost:${port}/`,
          "com.android.chrome",
        ]);
    }
  }
} catch (error) {
  console.error(`USB setup failed: ${error.message}`);
  console.error(
    "Start the server first: node scripts/topgold-scan-benchmark/mobile/device-server.mjs",
  );
  process.exitCode = 1;
}
