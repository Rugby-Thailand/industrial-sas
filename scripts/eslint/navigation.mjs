import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { analyzeNavigationSource } from "./navigation-analysis.mjs";

const contract = JSON.parse(
  readFileSync(
    new URL("../../docs/contracts/back-navigation.json", import.meta.url),
    "utf8",
  ),
);
export function createNavigationPlugin(policy = contract) {
  return {
    rules: {
      architecture: {
        meta: {
          type: "problem",
          docs: {
            description:
              "Enforce audited Back predecessors, safe parents, and shared history/modal ownership.",
          },
          schema: [],
        },
        create(context) {
          return {
            Program() {
              const filename = relative(
                process.cwd(),
                resolve(context.filename),
              ).replaceAll("\\", "/");
              for (const error of analyzeNavigationSource(
                context.sourceCode.text,
                filename,
                policy,
              ).errors)
                context.report({
                  loc: { line: error.line, column: error.column },
                  message: `${error.caller}: ${error.message}`,
                });
            },
          };
        },
      },
    },
  };
}
export default createNavigationPlugin();
