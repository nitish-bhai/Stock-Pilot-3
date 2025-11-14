
import { db } from './firebase';
import { collection, query, onSnapshot, Unsubscribe, addDoc, doc, updateDoc, deleteDoc, where, getDocs, runTransaction, DocumentReference } from 'firebase/firestore';
import { InventoryItem } from '../types';

export const getInventoryStream = (userId: string, callback: (items: InventoryItem[]) => void): Unsubscribe => {
    const itemsCollection = collection(db, `users/${userId}/inventory`);
    const q = query(itemsCollection);

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const items = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as InventoryItem));
        callback(items);
    });

    return unsubscribe;
};

export const findItemByName = async (userId: string, itemName: string): Promise<(InventoryItem & { docRef: DocumentReference }) | null> => {
    const itemsCollection = collection(db, `users/${userId}/inventory`);
    const q = query(itemsCollection, where("name", "==", itemName.toLowerCase()));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        return {
            id: doc.id,
            ...doc.data(),
            docRef: doc.ref
        } as (InventoryItem & { docRef: DocumentReference });
    }
    return null;
};


export const addOrUpdateItem = async (userId: string, itemName: string, quantity: number, price: number, expiryDate?: string): Promise<void> => {
    const itemRef = collection(db, `users/${userId}/inventory`);
    const normalizedItemName = itemName.toLowerCase();
    
    await runTransaction(db, async (transaction) => {
        const q = query(itemRef, where("name", "==", normalizedItemName));
        const snapshot = await getDocs(q);
        
        const newItemData: any = { 
            name: normalizedItemName, 
            quantity, 
            price 
        };
        if (expiryDate) {
            newItemData.expiryDate = expiryDate;
        }

        if (snapshot.empty) {
            transaction.set(doc(itemRef), newItemData);
        } else {
            const existingDoc = snapshot.docs[0];
            const existingData = existingDoc.data();
            const newQuantity = existingData.quantity + quantity;
            
            const updatedData: any = { quantity: newQuantity, price };
             if (expiryDate) {
                updatedData.expiryDate = expiryDate;
            } else if (existingData.expiryDate) {
                updatedData.expiryDate = existingData.expiryDate; // Preserve existing expiry if new one isn't provided
            }

            transaction.update(existingDoc.ref, updatedData);
        }
    });
};

export const removeItem = async (userId: string, itemName: string, quantityToRemove: number): Promise<{ success: boolean; message: string }> => {
    const itemRef = collection(db, `users/${userId}/inventory`);
    const normalizedItemName = itemName.toLowerCase();

    return await runTransaction(db, async (transaction) => {
        const q = query(itemRef, where("name", "==", normalizedItemName));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, message: `I couldn't find any ${itemName} in the inventory.` };
        }

        const existingDoc = snapshot.docs[0];
        const currentQuantity = existingDoc.data().quantity;

        if (currentQuantity < quantityToRemove) {
            return { success: false, message: `You only have ${currentQuantity} ${itemName}. I can't remove ${quantityToRemove}.` };
        }

        const newQuantity = currentQuantity - quantityToRemove;
        if (newQuantity === 0) {
            transaction.delete(existingDoc.ref);
        } else {
            transaction.update(existingDoc.ref, { quantity: newQuantity });
        }
        return { success: true, message: `Removed ${quantityToRemove} ${itemName}.` };
    });
};