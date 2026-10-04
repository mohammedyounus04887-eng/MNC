/**
 * Kitchen-side "Return Stock" — mirror of AddStockToKitchen. Operator
 * returns whole packets from kitchen back to admin. Face-verified.
 *
 * Partial fractions left in the kitchen (e.g. 0.99 of an opened packet)
 * stay in the kitchen until consumed; only whole packets can be returned.
 */

import { useKitchenStockItems, commitReturnToInventory } from "@/hooks/useUnifiedInventory";
import StockBasket, { type BasketSourceItem } from "./StockBasket";
import type { KitchenStockEventItem } from "@/types/firestore";

interface Props {
    clubId: string;
    onClose: () => void;
}

export default function ReturnStockToInventory({ clubId, onClose }: Props) {
    const { stock } = useKitchenStockItems();

    const sourceItems: BasketSourceItem[] = stock.map((it) => ({
        id: it.inventoryItemId,
        name: it.name,
        size: it.size,
        unit: it.unit,
        quantity: it.quantity,
    }));

    async function handleCommit(items: KitchenStockEventItem[], verifier: { id: string; name: string }) {
        await commitReturnToInventory(clubId, {
            items,
            verifiedBy: verifier.name,
            verifiedById: verifier.id,
        });
    }

    return (
        <StockBasket
            clubId={clubId}
            title="Return Stock to Inventory"
            subtitle="Pick whole packets to send back to admin"
            sourceItems={sourceItems}
            sourceLabel="Kitchen"
            actionLabel="Return to Inventory"
            onCommit={handleCommit}
            verifySubtitle={(n) => `${n} packet${n === 1 ? '' : 's'} → inventory`}
            onClose={onClose}
        />
    );
}
