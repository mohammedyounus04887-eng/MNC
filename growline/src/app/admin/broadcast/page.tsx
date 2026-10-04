import { users } from "@/lib/collections";
import BroadcastForm from "./BroadcastForm";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastPage() {
  const reach = (await users().count().get()).data().count;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Broadcast</h1>
        <p className="mt-1 text-text-dim">
          An announcement to every coach. It appears in their Threads tab, with the same
          acknowledge tap they already use — so you can see how many read it.
        </p>
      </div>
      <BroadcastForm reach={reach} />
    </div>
  );
}
