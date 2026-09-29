import { execFileSync } from "node:child_process";

// Vercel's convention: 0 skips deployment; 1 continues the build.
function shouldSkipBuild() {
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (
    process.env.FORCE_VERCEL_BUILD === "1" ||
    !/^[a-f\d]{40}$/i.test(previous ?? "")
  ) {
    return false;
  }

  try {
    // Compare with the last successful deployment, not HEAD^: otherwise an
    // application change followed by a docs commit could be missed. Disable
    // rename detection so moving application code into docs still builds.
    const files = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", previous, "HEAD", "--"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .split("\0")
      .filter(Boolean);

    // Rebuilding the same commit may apply new environment variables.
    return (
      files.length > 0 &&
      files.every(
        (file) =>
          file === "README.md" ||
          file === "AGENTS.md" ||
          file.startsWith("docs/") ||
          file.startsWith(".github/"),
      )
    );
  } catch {
    // First deployments, shallow clones, or unavailable Git history build.
    return false;
  }
}

const skip = shouldSkipBuild();
console.log(
  skip
    ? "Skipping docs/workflow-only deployment."
    : "Proceeding with deployment.",
);
process.exitCode = skip ? 0 : 1;
