import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { AgentChat } from "@/components/AgentChat";

export default async function Agent() {
  await requireSession();
  return (
    <div className="inbox">
      <PageHeader title="Ask ARMPIT" sub="Questions about your own partners, payments, deals and tasks" />
      {!process.env.ANTHROPIC_API_KEY && <div className="notice" role="status">The AI agent is not switched on yet. An admin needs to add <code>ANTHROPIC_API_KEY</code> in Vercel and redeploy. You can try the page, but questions will not be answered until then.</div>}
      <AgentChat />
    </div>
  );
}
