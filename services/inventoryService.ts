
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


export const addOrUpdateItem = async (userId: string, itemName: string, quantity: number, price: number): Promise<void> => {
    const itemRef = collection(db, `users/${userId}/inventory`);
    const normalizedItemName = itemName.toLowerCase();
    
    await runTransaction(db, async (transaction) => {
        const q = query(itemRef, where("name", "==", normalizedItemName));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            // Add new item
            transaction.set(doc(itemRef), { 
                name: normalizedItemName, 
                quantity, 
                price 
            });
        } else {
            // Update existing item
            const existingDoc = snapshot.docs[0];
            const newQuantity = existingDoc.data().quantity + quantity;
            // Optionally average the price or use the new one. Here we'll use the new price.
            transaction.update(existingDoc.ref, { quantity: newQuantity, price });
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
