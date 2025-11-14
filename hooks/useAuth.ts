import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, Auth, User } from 'firebase/auth';
import { auth } from '../services/firebase';

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signUp: (email: string, pass: string) => Promise<User | null>;
    logIn: (email: string, pass: string) => Promise<User | null>;
    logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const signUp = async (email: string, pass: string): Promise<User | null> => {
       const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
       return userCredential.user;
    };
    
    const logIn = async (email: string, pass: string): Promise<User | null> => {
        const userCredential = await signInWithEmailAndPassword(auth, email, pass);
        return userCredential.user;
    };
    
    const logOut = async () => {
        await signOut(auth);
    };

    const value = { user, loading, signUp, logIn, logOut };

    // FIX: Replaced JSX with React.createElement to resolve TypeScript error in a .ts file.
    return React.createElement(AuthContext.Provider, { value }, children);
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};