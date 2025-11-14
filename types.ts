
import { User as FirebaseUser } from 'firebase/auth';

export interface InventoryItem {
    id: string;
    name: string;
    quantity: number;
    price: number; // Price per item in INR
    supplierId?: string;
    expiryDate?: string; // YYYY-MM-DD format
}

export type User = FirebaseUser;

export interface UserProfile {
    uid: string;
    email: string;
    role?: 'seller' | 'supplier'; // Role is optional until onboarding is complete
    name: string; // The user's display name (e.g., "Ravi Traders")
    categories: string[]; // For both sellers (store types) and suppliers (supply types)
    photoURL?: string;
    loginMethod: 'email' | 'google';
}

export interface Chat {
    id: string;
    participants: string[]; // [sellerId, supplierId]
    sellerId: string;
    sellerName: string;
    supplierId: string;
    supplierName: string;
    categoriesMatched: string[];
    lastMessageText?: string;
    lastMessageTimestamp?: any; // Firestore Timestamp
    unreadCount: {
        [key: string]: number; // e.g., { "sellerId123": 2, "supplierId456": 0 }
    };
}

export interface Message {
    id: string;
    chatId: string;
    senderId: string;
    senderName: string;
    text: string;
    timestamp: any; // Firestore Timestamp
    isRead: boolean;
    deliveryStatus: 'sent' | 'delivered' | 'seen';
}
