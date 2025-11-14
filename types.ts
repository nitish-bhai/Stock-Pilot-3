
import { User as FirebaseUser } from 'firebase/auth';

export interface InventoryItem {
    id: string;
    name: string;
    quantity: number;
    price: number; // Price per item in INR
}

export type User = FirebaseUser;
