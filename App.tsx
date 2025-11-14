
import React, { useState, useEffect } from 'react';
import { useAuth, AuthProvider } from './hooks/useAuth';
import LoginComponent from './components/Login';
import InventoryManager from './components/InventoryManager';
import { InventoryProvider } from './hooks/useInventory';
import SupplierDashboard from './components/SupplierDashboard';
import ChatRoom from './components/ChatRoom';
import { ThemeProvider } from './hooks/useTheme';
import Onboarding from './components/Onboarding';
import { getChatsStream } from './services/chatService';
import Toast from './components/Toast';
import { Chat } from './types';

// Define navigation state types
export interface ChatParams {
    chatId: string;
    chatTitle: string;
}

const AppContent: React.FC = () => {
    const { user, userProfile, loading } = useAuth();
    const [activeChatParams, setActiveChatParams] = useState<ChatParams | null>(null);
    const [toastMessage, setToastMessage] = useState('');
    const lastMessageTimestampRef = React.useRef<any>(null);

    useEffect(() => {
        if (!user || !userProfile?.role) return;

        const unsubscribe = getChatsStream(user.uid, (chats: Chat[]) => {
            const latestChat = chats[0]; // Chats are sorted by timestamp
            if (latestChat && latestChat.lastMessageTimestamp && latestChat.lastMessageText) {
                // A simple check to see if this is a "new" message since the last toast
                const newTimestamp = latestChat.lastMessageTimestamp.seconds;
                const lastTimestamp = lastMessageTimestampRef.current?.seconds;

                // Check if the latest message is from another user
                const participants = latestChat.participants || [];
                const senderId = participants.find(p => p !== user.uid);
                
                // This logic is simplified: it assumes the last message on the most recent chat is the "newest" one.
                if (newTimestamp > lastTimestamp && latestChat.unreadCount[user.uid] > 0) {
                     // Find the sender's name
                    const senderName = latestChat.sellerId === senderId ? latestChat.sellerName : latestChat.supplierName;
                    setToastMessage(`New message from ${senderName}`);
                }
                lastMessageTimestampRef.current = latestChat.lastMessageTimestamp;
            }
        });

        return () => unsubscribe();
    }, [user, userProfile?.role]);

    const navigateToChat = (params: ChatParams) => setActiveChatParams(params);
    const navigateFromChat = () => setActiveChatParams(null);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
                <div className="text-2xl text-gray-800 dark:text-gray-200">Loading...</div>
            </div>
        );
    }

    if (!user) {
        return <LoginComponent />;
    }
    
    // If user is logged in but hasn't completed onboarding (role or name is missing)
    if (userProfile && (!userProfile.role || !userProfile.name)) {
        return <Onboarding />;
    }

    if (activeChatParams) {
        return <ChatRoom chatParams={activeChatParams} onBack={navigateFromChat} />;
    }
    
    const renderDashboard = () => {
        if (userProfile?.role === 'seller') {
            return (
                <InventoryProvider userId={user.uid}>
                    <InventoryManager onNavigateToChat={navigateToChat} />
                </InventoryProvider>
            );
        }
        if (userProfile?.role === 'supplier') {
            return <SupplierDashboard onNavigateToChat={navigateToChat} />;
        }
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
                <div className="text-2xl text-gray-800 dark:text-gray-200">Loading user profile...</div>
            </div>
        );
    };

    return (
        <>
            <Toast message={toastMessage} onClose={() => setToastMessage('')} />
            {renderDashboard()}
        </>
    );
};

const App: React.FC = () => {
    return (
        <ThemeProvider>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </ThemeProvider>
    );
};

export default App;
