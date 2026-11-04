import { loadDeployment, httpClient, identity } from "./lib.mjs";
const d = loadDeployment();
const h = httpClient(d);
const clerk = {
  userId: "user_3JXrAsAOLBWzV5TTHPQjOX5WaQd",
  orgId: "org_3JXrDUraQjTRO3hcIzMGC9CvIXV",
};
const [fn, args] = [process.argv[2], JSON.parse(process.argv[3] ?? "{}")];
h.setAdminAuth(d.adminKey, identity(clerk));
try {
  const r = await h.query(fn, args);
  console.log(JSON.stringify(r).slice(0, Number(process.argv[4] ?? 600)));
} catch (e) {
  console.log("ERR", e.message.slice(0, 300));
}
