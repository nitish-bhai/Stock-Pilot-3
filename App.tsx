
import React from 'react';
import { useAuth, AuthProvider } from './hooks/useAuth';
import LoginComponent from './components/Login';
import InventoryManager from './components/InventoryManager';
import { InventoryProvider } from './hooks/useInventory';

const AppContent: React.FC = () => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-900">
                <div className="text-white text-2xl">Loading...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-800 to-gray-900">
            {user ? (
                <InventoryProvider userId={user.uid}>
                    <InventoryManager />
                </InventoryProvider>
            ) : (
                <LoginComponent />
            )}
        </div>
    );
};

const App: React.FC = () => {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
};

export default App;
