import { handle, json } from "@/lib/http";
import { authorizeJob, runJob } from "@/lib/jobs";

// Vercel Cron appelle en GET, un cron système peut appeler en POST : même traitement, même secret.
async function run(req: Request, { params }: { params: Promise<{ name: string }> }) {
  return handle(async () => {
    authorizeJob(req.headers.get("authorization"));
    const { name } = await params;
    return json({ job: name, result: await runJob(name) }, 200, { "Cache-Control": "no-store" });
  });
}

export { run as GET, run as POST };
