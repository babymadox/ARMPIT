export const maxDuration = 30;
import { requireSession } from "@/lib/session";
import { buildReport, isSingleTenant } from "@/lib/diagnostics";
import { siteOrigin } from "@/lib/site";
import { PageHeader } from "@/components/ui";
import { DiagnosticsView } from "@/components/DiagnosticsView";

export default async function Diagnostics() {
  const { org, isAdmin } = await requireSession();
  if (!isAdmin) return <><PageHeader title="Diagnostics" /><div className="empty"><b>Admins only</b></div></>;
  const report = await buildReport(org.id, { origin: await siteOrigin(), includeSystem: await isSingleTenant() });
  return <DiagnosticsView report={report} />;
}
