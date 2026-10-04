/**
 * Kitchen-side "Add Stock" — operator builds a basket of admin items,
 * face-verifies, and packets are atomically moved admin → kitchen.
 */

import { useInventoryItems, commitGiveToKitchen } from "@/hooks/useUnifiedInventory";
import StockBasket, { type BasketSourceItem } from "./StockBasket";
import type { KitchenStockEventItem } from "@/types/firestore";

interface Props {
    clubId: string;
    onClose: () => void;
}

export default function AddStockToKitchen({ clubId, onClose }: Props) {
    const { items } = useInventoryItems();

    const sourceItems: BasketSourceItem[] = items.map((it) => ({
        id: it.id,
        name: it.name,
        size: it.size,
        unit: it.unit,
        quantity: it.quantity,
        category: it.category,
        imageUrl: it.imageUrl,
    }));

    async function handleCommit(items: KitchenStockEventItem[], verifier: { id: string; name: string }) {
        await commitGiveToKitchen(clubId, {
            items,
            verifiedBy: verifier.name,
            verifiedById: verifier.id,
        });
    }

    return (
        <StockBasket
            clubId={clubId}
            title="Add Stock to Kitchen"
            subtitle="Pick items to move from inventory into the kitchen"
            sourceItems={sourceItems}
            sourceLabel="Admin"
            actionLabel="Give to Kitchen"
            onCommit={handleCommit}
            verifySubtitle={(n) => `${n} packet${n === 1 ? '' : 's'} → kitchen`}
            onClose={onClose}
        />
    );
}
