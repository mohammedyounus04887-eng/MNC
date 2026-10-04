/**
 * Selling a product — one pipe.
 *
 * A sale has to do three things together: record the money, record the sale,
 * and take the item off the shelf. The app had two ways of doing this and
 * neither did all three — the Sell Product screen wrote the sale and the money
 * but reception's own cart wrote only the money, so items sold at the desk
 * never left inventory and never appeared under "products sold", while the same
 * shaker sold through the other screen did.
 *
 * That is why "Products ₹2,700" could sit next to "Products sold: 0 units" on
 * the same report.
 */

import { collection, doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { addPaymentToBatch, type PayMethod, type UpiAccountRef } from "@/lib/recordPayment";
import { todayLocal } from "@/lib/clubDay";

export interface SellProductInput {
    clubId: string;
    product: { id: string; name: string; unit?: string; price?: number };
    quantity: number;
    unitPrice: number;
    method: PayMethod;
    cashAmount?: number;
    upiAmount?: number;
    upiAccount?: UpiAccountRef | null;
    /** Optional — walk-ins have no member. */
    buyer?: { id: string; name?: string; memberId?: string } | null;
    soldBy?: string;
}

export async function sellProduct(input: SellProductInput): Promise<{ saleId: string; total: number; stockLeft: number | null }> {
    const { clubId, product } = input;
    const quantity = Math.max(1, Number(input.quantity) || 1);
    const total = Math.round((Number(input.unitPrice) || 0) * quantity);
    const date = todayLocal();

    // Read stock first so the batch can carry an exact new value and the caller
    // can be told what is left.
    const prodRef = doc(db, "clubs", clubId, "inventory", product.id);
    const prodSnap = await getDoc(prodRef);
    const current = prodSnap.exists() ? Number((prodSnap.data() as any)?.quantity) || 0 : null;
    const stockLeft = current == null ? null : Math.max(0, current - quantity);

    const batch = writeBatch(db);
    const saleRef = doc(collection(db, "clubs", clubId, "productSales"));

    batch.set(saleRef, {
        id: saleRef.id,
        clubId,
        productId: product.id,
        productName: product.name,
        quantity,
        unit: product.unit ?? "",
        price: Number(input.unitPrice) || 0,
        totalAmount: total,
        buyerId: input.buyer?.id ?? null,
        buyerName: input.buyer?.name ?? "Walk-in",
        isGift: false,
        paymentMethod: input.method,
        soldBy: input.soldBy ?? "reception",
        date,
        createdAt: serverTimestamp(),
    });

    if (current != null) {
        batch.update(prodRef, { quantity: stockLeft, updatedAt: serverTimestamp() });
        batch.set(doc(collection(db, "clubs", clubId, "inventoryLogs")), {
            productId: product.id,
            productName: product.name,
            change: -quantity,
            reason: "sale",
            quantityAfter: stockLeft,
            referenceId: saleRef.id,
            date,
            createdAt: serverTimestamp(),
        });
    }

    addPaymentToBatch(batch, {
        clubId,
        type: "product_sale",
        amount: total,
        method: input.method,
        cashAmount: input.cashAmount,
        upiAmount: input.upiAmount,
        upiAccount: input.upiAccount ?? null,
        memberId: input.buyer?.id ?? null,
        memberName: input.buyer?.name ?? "Walk-in",
        humanMemberId: input.buyer?.memberId,
        description: `${product.name} × ${quantity}`,
        source: "reception",
        referenceId: saleRef.id,
    });

    await batch.commit();
    return { saleId: saleRef.id, total, stockLeft };
}
