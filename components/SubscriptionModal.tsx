
import React, { useState } from 'react';
import { CheckIcon, SparklesIcon, XMarkIcon } from './icons';
import { useAuth } from '../hooks/useAuth';
import { setUserProfile } from '../services/firebase';
import Toast from './Toast';

interface SubscriptionModalProps {
    onClose: () => void;
}

const SubscriptionModal: React.FC<SubscriptionModalProps> = ({ onClose }) => {
    const { user, userProfile, updateUserProfileState } = useAuth();
    const [isProcessing, setIsProcessing] = useState(false);
    const [showToast, setShowToast] = useState(false);

    const handleUpgrade = async () => {
        if (!user || !userProfile) return;
        setIsProcessing(true);

        // Simulate Payment Gateway Delay
        setTimeout(async () => {
            try {
                await setUserProfile(user.uid, { plan: 'pro' });
                updateUserProfileState({ plan: 'pro' });
                setShowToast(true);
                setTimeout(() => {
                    onClose();
                }, 1500);
            } catch (error) {
                console.error("Upgrade failed", error);
                setIsProcessing(false);
            }
        }, 2000);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <Toast message="Welcome to Vyapar Pro! 🚀" onClose={() => setShowToast(false)} />
            {showToast ? null : (
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden relative animate-fade-in-down">
                    <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 z-10">
                        <XMarkIcon className="w-6 h-6" />
                    </button>
                    
                    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
                        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                            <SparklesIcon className="w-8 h-8 text-yellow-300" />
                        </div>
                        <h2 className="text-2xl font-bold">Upgrade to Vyapar Pro</h2>
                        <p className="text-indigo-100 mt-2">Unlock the full power of AI for your shop.</p>
                    </div>

                    <div className="p-8">
                        <div className="space-y-4 mb-8">
                            <div className="flex items-center gap-3">
                                <div className="p-1 bg-green-100 dark:bg-green-900/50 rounded-full">
                                    <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                                </div>
                                <span className="text-gray-700 dark:text-gray-300">AI Invoice Scanner (Zero Data Entry)</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="p-1 bg-green-100 dark:bg-green-900/50 rounded-full">
                                    <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                                </div>
                                <span className="text-gray-700 dark:text-gray-300">Shelf Doctor (Increase Sales)</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="p-1 bg-green-100 dark:bg-green-900/50 rounded-full">
                                    <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                                </div>
                                <span className="text-gray-700 dark:text-gray-300">WhatsApp Promo Generator</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="p-1 bg-green-100 dark:bg-green-900/50 rounded-full">
                                    <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                                </div>
                                <span className="text-gray-700 dark:text-gray-300">Unlimited Inventory Items</span>
                            </div>
                        </div>

                        <div className="flex items-center justify-between mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
                            <div>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Total Amount</p>
                                <p className="text-2xl font-bold text-gray-900 dark:text-white">₹299 <span className="text-sm font-normal text-gray-500">/ mo</span></p>
                            </div>
                            <div className="text-xs text-green-600 dark:text-green-400 font-bold bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded">
                                SAVE 60%
                            </div>
                        </div>

                        <button 
                            onClick={handleUpgrade}
                            disabled={isProcessing}
                            className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold rounded-xl shadow-lg transform transition-all active:scale-95 flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {isProcessing ? (
                                <>
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                    Processing...
                                </>
                            ) : (
                                'Pay ₹299 & Upgrade'
                            )}
                        </button>
                        <p className="text-xs text-center text-gray-400 mt-4">Secured by MockPay. No actual card required.</p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SubscriptionModal;
