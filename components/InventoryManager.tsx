
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LiveSession, LiveServerMessage, Modality, Blob as GenaiBlob, FunctionCall, Type } from '@google/genai';
import { INITIATE_ADD_ITEM_TOOL, PROVIDE_ITEM_QUANTITY_TOOL, PROVIDE_ITEM_PRICE_TOOL, REMOVE_ITEM_TOOL, QUERY_INVENTORY_TOOL, PROVIDE_ITEM_EXPIRY_DATE_TOOL, BULK_ACTION_TOOL, PLAN_LIMITS } from '../constants';
import { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import InventoryTable from './InventoryTable';
import MicButton from './MicButton';
import CameraCapture from './CameraCapture';
import EditItemModal from './EditItemModal';
import BusinessPilot from './BusinessPilot';
import SubscriptionModal from './SubscriptionModal';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { getAi } from '../services/geminiService';
import { addOrUpdateItem, removeItem, updateInventoryItem, deleteItemsBatch } from '../services/inventoryService';
import { getChatsStream } from '../services/chatService';
import { getNotificationsStream } from '../services/notificationService';
import { incrementUserUsage } from '../services/firebase';
import { LogoutIcon, SearchIcon, ChatIcon, BellIcon, CameraIcon, XMarkIcon, DocumentTextIcon, SparklesIcon, ShareIcon, PresentationChartLineIcon } from './icons';
import { InventoryItem, Chat, UserProfile, Notification } from '../types';
import { ChatParams } from '../App';
import ChatListModal from './ChatListModal';
import Toast from './Toast';

interface InventoryManagerProps {
    onNavigateToChat: (params: ChatParams) => void;
    onOpenNotifications: () => void;
}

interface DetectedItem {
    name: string;
    quantity: number;
    price: number;
    expiryDate: string;
}

// Type for the Shelf Doctor Report
interface ShelfAnalysisReport {
    score: number;
    ghostSpots: string[];
    misplacedItems: string[];
    powerMove: string;
}

const InventoryManager: React.FC<InventoryManagerProps> = ({ onNavigateToChat, onOpenNotifications }) => {
    const { user, userProfile, logOut, updateUserProfileState } = useAuth();
    const { inventory, loading: inventoryLoading } = useInventory();
    
    const [isListening, setIsListening] = useState(false);
    const [isGreeting, setIsGreeting] = useState(false);
    const [statusText, setStatusText] = useState("Tap the mic to manage your stock, or use the camera.");
    const [searchTerm, setSearchTerm] = useState('');
    const [isChatModalOpen, setIsChatModalOpen] = useState(false);
    const [totalUnreadChatCount, setTotalUnreadChatCount] = useState(0);
    const [totalUnreadNotificationCount, setTotalUnreadNotificationCount] = useState(0);
    
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    // Added 'shelf-analysis' mode
    const [cameraMode, setCameraMode] = useState<'item' | 'invoice' | 'shelf-analysis'>('item');
    
    const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    
    // State for manual review/edit modals
    const [reviewItems, setReviewItems] = useState<DetectedItem[]>([]);
    const [isReviewingInvoice, setIsReviewingInvoice] = useState(false); 
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

    // State for Shelf Doctor Report
    const [shelfReport, setShelfReport] = useState<ShelfAnalysisReport | null>(null);
    
    // State for Batch Actions
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
    const [bulkPromoContent, setBulkPromoContent] = useState<string | null>(null);
    const [isGeneratingBulkPromo, setIsGeneratingBulkPromo] = useState(false);

    // Subscription Modal State
    const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

    // REF for selectedItems to access fresh state inside the Live API closure
    const selectedItemIdsRef = useRef<Set<string>>(new Set());
    const inventoryRef = useRef<InventoryItem[]>([]);

    useEffect(() => {
        selectedItemIdsRef.current = selectedItemIds;
    }, [selectedItemIds]);

    useEffect(() => {
        inventoryRef.current = inventory;
    }, [inventory]);

    const [transcript, setTranscript] = useState<{ speaker: 'user' | 'assistant', text: string }[]>([]);
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    const awaitingPriceInfoRef = useRef<any | null>(null);
    const awaitingQuantityInfoRef = useRef<any | null>(null);
    const awaitingExpiryInfoRef = useRef<any | null>(null);

    const sessionRef = useRef<Promise<LiveSession> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const isSessionActiveRef = useRef(false);
    const audioPlaybackTimeRef = useRef(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const greetingAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    
    useEffect(() => {
        if (!user) return;
        const unsubChats = getChatsStream(user.uid, (chats: Chat[]) => {
            const unreadSum = chats.reduce((sum, chat) => sum + (chat.unreadCount[user.uid] || 0), 0);
            setTotalUnreadChatCount(unreadSum);
        });
        const unsubNotifications = getNotificationsStream(user.uid, (notifications: Notification[]) => {
            const unreadSum = notifications.filter(n => !n.read).length;
            setTotalUnreadNotificationCount(unreadSum);
        });
        return () => {
            unsubChats();
            unsubNotifications();
        };
    }, [user]);

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

    // --- Usage Limit Checker ---
    const checkUsageLimit = (feature: 'aiScans' | 'promosGenerated' | 'inventoryCount', currentCount: number): boolean => {
        if (!userProfile) return false;
        if (userProfile.plan === 'pro') return true; // Pro has no limits

        const limit = PLAN_LIMITS.free[feature === 'inventoryCount' ? 'maxInventoryItems' : feature === 'aiScans' ? 'maxAiScans' : 'maxPromos'];
        
        if (currentCount >= limit) {
            setShowSubscriptionModal(true);
            return false;
        }
        return true;
    };

    const handleIncrementUsage = async (feature: 'aiScans' | 'promosGenerated') => {
        if (!user || !userProfile) return;
        // Increment in local state for immediate UI update
        const newCount = (userProfile.usage?.[feature] || 0) + 1;
        updateUserProfileState({ 
            usage: { 
                ...userProfile.usage, 
                [feature]: newCount 
            } 
        });
        // Increment in DB
        await incrementUserUsage(user.uid, feature);
    };

    const handleToolCall = useCallback(async (fc: FunctionCall, session: LiveSession): Promise<void> => {
        if (!user || !userProfile) return;
        let result: any = { success: false, message: "Sorry, I couldn't do that." };
        const userCategories = userProfile.categories || [];

        switch (fc.name) {
            case 'initiateAddItem': {
                const { itemName, quantity } = fc.args;
                if (quantity) {
                    awaitingPriceInfoRef.current = { itemName, quantity };
                    result = { success: true, message: `Okay, adding ${quantity} ${itemName}. How much does one cost in rupees?` };
                } else {
                    awaitingQuantityInfoRef.current = { itemName };
                    result = { success: true, message: `Okay, you want to add ${itemName}. How many?` };
                }
                break;
            }
            case 'provideItemQuantity': {
                if (awaitingQuantityInfoRef.current) {
                    const { itemName } = awaitingQuantityInfoRef.current;
                    const { quantity } = fc.args;
                    awaitingPriceInfoRef.current = { itemName, quantity };
                    awaitingQuantityInfoRef.current = null;
                    result = { success: true, message: `Got it, ${quantity}. And how much is one in rupees?` };
                } else {
                    result = { success: false, message: "I'm sorry, I don't know which item you're providing the quantity for." };
                }
                break;
            }
            case 'provideItemPrice': {
                if (awaitingPriceInfoRef.current) {
                    const { itemName, quantity } = awaitingPriceInfoRef.current;
                    const { price } = fc.args;
                    awaitingPriceInfoRef.current = null;
                    
                    const needsExpiry = userCategories.some(cat => ['medical', 'grocery', 'sweets'].includes(cat));

                    // Check Inventory Limit before adding
                    if (!checkUsageLimit('inventoryCount', inventoryRef.current.length)) {
                         result = { success: false, message: "You've reached the free inventory limit. Please upgrade to add more items." };
                    } else {
                        if (needsExpiry) {
                            awaitingExpiryInfoRef.current = { itemName, quantity, price };
                            result = { success: true, message: `The price is set. Now, what is the expiry date? Please tell me in Day-Month-Year format.` };
                        } else {
                            await addOrUpdateItem(user.uid, itemName, quantity, price);
                            result = { success: true, message: `Great, I've added ${quantity} ${itemName} to your inventory.` };
                        }
                    }
                } else {
                    result = { success: false, message: "I'm sorry, I don't know which item you're providing the price for. Let's start over." };
                }
                break;
            }
            case 'provideItemExpiryDate': {
                 if (awaitingExpiryInfoRef.current) {
                    const { itemName, quantity, price } = awaitingExpiryInfoRef.current;
                    const { expiryDate } = fc.args;
                    if (!/^\d{2}-\d{2}-\d{4}$/.test(expiryDate)) {
                        result = { success: false, message: "That doesn't look right. Please provide the date in Day-Month-Year format, for example, 31-12-2025." };
                    } else {
                         // Check Inventory Limit again just in case
                        if (!checkUsageLimit('inventoryCount', inventoryRef.current.length)) {
                            result = { success: false, message: "You've reached the free inventory limit. Please upgrade." };
                        } else {
                            await addOrUpdateItem(user.uid, itemName, quantity, price, expiryDate);
                            result = { success: true, message: `Got it. I've added ${quantity} ${itemName} with an expiry date of ${expiryDate}.` };
                            awaitingExpiryInfoRef.current = null;
                        }
                    }
                } else {
                    result = { success: false, message: "I'm sorry, I don't know which item you're providing an expiry for." };
                }
                break;
            }
            case 'removeItem': {
                const removeResult = await removeItem(user.uid, fc.args.itemName, fc.args.quantity);
                result = { success: removeResult.success, message: removeResult.message };
                break;
            }
            case 'queryInventory': {
                result = { success: true, message: "Query acknowledged. Proceed with your answer." };
                break;
            }
            case 'performBulkAction': {
                const { actionType } = fc.args;
                const currentSelection = selectedItemIdsRef.current;
                
                if (actionType === 'deselect') {
                    setSelectedItemIds(new Set());
                    result = { success: true, message: "Selection cleared." };
                } else if (currentSelection.size === 0) {
                    result = { success: false, message: "You haven't selected any items. Please select items from the list first." };
                } else {
                    if (actionType === 'delete') {
                         try {
                            await deleteItemsBatch(user.uid, Array.from(currentSelection));
                            setSelectedItemIds(new Set());
                            result = { success: true, message: `Deleted ${currentSelection.size} items successfully.` };
                        } catch (e) {
                            result = { success: false, message: "Failed to delete selected items." };
                        }
                    } else if (actionType === 'promote') {
                         // Usage Check for Promos
                         const currentPromos = userProfile.usage?.promosGenerated || 0;
                         if (!checkUsageLimit('promosGenerated', currentPromos)) {
                             result = { success: false, message: "You've reached your free promo limit for this month. Please upgrade." };
                         } else {
                             setIsGeneratingBulkPromo(true);
                             const selectedItems = inventoryRef.current.filter(i => currentSelection.has(i.id));
                             const itemNames = selectedItems.map(i => i.name).join(", ");
                             
                             const ai = getAi();
                             const prompt = `Create a compelling "Bundle Deal" WhatsApp promo message for these items: ${itemNames}. 
                             Suggest a discount (e.g. "Buy all for 15% off"). Use emojis. Make it short and exciting.`;

                             ai.models.generateContent({
                                model: 'gemini-2.5-flash',
                                contents: prompt
                            }).then(res => {
                                setBulkPromoContent(res.text);
                                setIsGeneratingBulkPromo(false);
                                handleIncrementUsage('promosGenerated');
                            });
                            
                            result = { success: true, message: `I'm generating a promotion for your ${currentSelection.size} selected items. Check your screen.` };
                         }
                    }
                }
                break;
            }
        }

        session.sendToolResponse({
            functionResponses: {
                id: fc.id,
                name: fc.name,
                response: { result: result.message },
            }
        });
    }, [user, userProfile]);
    
    const stopSession = useCallback(() => {
        if (!isSessionActiveRef.current) return;
        isSessionActiveRef.current = false;
    
        if (greetingAudioSourceRef.current) {
            greetingAudioSourceRef.current.stop();
            greetingAudioSourceRef.current = null;
        }

        setIsListening(false);
        setIsGreeting(false);
        setStatusText(prev => prev.startsWith("Microphone") ? prev : "Tap the mic to manage your stock, or use the camera.");
        setTranscript([]);

        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;

        scriptProcessorRef.current?.disconnect();
        scriptProcessorRef.current = null;
        
        inputAudioContextRef.current?.close().catch(console.error);
        inputAudioContextRef.current = null;

        outputAudioContextRef.current?.close().catch(console.error);
        outputAudioContextRef.current = null;
        audioSourcesRef.current.clear();

        sessionRef.current?.then(session => session.close()).catch(console.error);
        sessionRef.current = null;
        
        awaitingPriceInfoRef.current = null;
        awaitingQuantityInfoRef.current = null;
        awaitingExpiryInfoRef.current = null;
    }, []);

    const startListeningSession = async () => {
        if (!process.env.API_KEY || !user || !userProfile?.categories || !isSessionActiveRef.current) return;
        
        setIsListening(true);
        setStatusText("Connecting...");
        
        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
       
        try {
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error: any) {
            console.error("Microphone access denied:", error);
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                 setStatusText("Microphone blocked. Tap the lock icon 🔒 in the URL bar to allow access.");
                 setToastMessage("Permission Denied. Please enable microphone access in your browser settings (tap the Lock icon in the address bar).");
            } else {
                 setStatusText("Microphone not found or unavailable.");
            }
            stopSession();
            return;
        }
        
        const ai = getAi();
        const userCategories = userProfile.categories;
        const needsExpiry = userCategories.some(cat => ['medical', 'grocery', 'sweets'].includes(cat));
        const systemInstruction = `You are a bilingual (English and Hindi) voice-first inventory assistant for a store with categories: ${userCategories.join(', ')}.
IMPORTANT: You must only respond in English or Hindi. Prefer English.
- You must only accept items relevant for these categories. If a user tries to add something irrelevant, politely decline.
- To add an item: Use 'initiateAddItem'. If the user doesn't say how many, the system will ask. Once you know the quantity, you must ask for the price.
- ${needsExpiry ? "For this store type, items may have an expiry date. After getting the price, you MUST ask for the expiry date and you MUST explicitly state the required format is Day-Month-Year (DD-MM-YYYY)." : "For this store type, items DO NOT have an expiry date, so DO NOT ask for one."}
- To remove an item: Use 'removeItem'.
- To answer questions: Use 'queryInventory' and then answer based on the provided inventory context.
- To manage selected items in the UI: Use 'performBulkAction' when the user says "delete selected", "promote selected", or "deselect".
Keep responses brief and conversational. Current inventory is: ${JSON.stringify(inventory.slice(0, 50))}`;

        let currentInput = '';
        let currentOutput = '';

        sessionRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                systemInstruction,
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                tools: [{ functionDeclarations: [INITIATE_ADD_ITEM_TOOL, PROVIDE_ITEM_QUANTITY_TOOL, PROVIDE_ITEM_PRICE_TOOL, REMOVE_ITEM_TOOL, QUERY_INVENTORY_TOOL, PROVIDE_ITEM_EXPIRY_DATE_TOOL, BULK_ACTION_TOOL] }]
            },
            callbacks: {
                onopen: () => {
                    setStatusText("Listening... Say something.");
                    setTranscript([{ speaker: 'assistant', text: "Hello, how can I help you?" }]);
                    if (!inputAudioContextRef.current || !mediaStreamRef.current) return;
                    const source = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
                    scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                    scriptProcessorRef.current.onaudioprocess = (e) => {
                        const inputData = e.inputBuffer.getChannelData(0);
                        const pcmBlob: GenaiBlob = {
                            data: encode(new Uint8Array(new Int16Array(inputData.map(f => f * 32768)).buffer)),
                            mimeType: 'audio/pcm;rate=16000',
                        };
                        sessionRef.current?.then((s) => isSessionActiveRef.current && s.sendRealtimeInput({ media: pcmBlob }));
                    };
                    source.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                },
                onmessage: async (msg: LiveServerMessage) => {
                    if (msg.serverContent?.inputTranscription) {
                        currentInput += msg.serverContent.inputTranscription.text;
                        setTranscript(prev => {
                            const last = prev[prev.length - 1];
                            if (last?.speaker === 'user') {
                                const newTranscript = [...prev];
                                newTranscript[newTranscript.length - 1] = { ...last, text: currentInput };
                                return newTranscript;
                            }
                            return [...prev, { speaker: 'user', text: currentInput }];
                        });
                    }
                    if (msg.serverContent?.outputTranscription) {
                         currentOutput += msg.serverContent.outputTranscription.text;
                         setTranscript(prev => {
                            const last = prev[prev.length - 1];
                            if (last?.speaker === 'assistant') {
                                const newTranscript = [...prev];
                                newTranscript[newTranscript.length - 1] = { ...last, text: currentOutput };
                                return newTranscript;
                            }
                            return [...prev, { speaker: 'assistant', text: currentOutput }];
                        });
                    }
                    if(msg.serverContent?.turnComplete) {
                        currentInput = '';
                        currentOutput = '';
                    }

                    if (msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
                        const base64 = msg.serverContent.modelTurn.parts[0].inlineData.data;
                        if (outputAudioContextRef.current) {
                            audioPlaybackTimeRef.current = Math.max(audioPlaybackTimeRef.current, outputAudioContextRef.current.currentTime);
                            const buffer = await decodeAudioData(decode(base64), outputAudioContextRef.current, 24000, 1);
                            const sourceNode = outputAudioContextRef.current.createBufferSource();
                            sourceNode.buffer = buffer;
                            sourceNode.connect(outputAudioContextRef.current.destination);
                            sourceNode.onended = () => audioSourcesRef.current.delete(sourceNode);
                            sourceNode.start(audioPlaybackTimeRef.current);
                            audioPlaybackTimeRef.current += buffer.duration;
                            audioSourcesRef.current.add(sourceNode);
                        }
                    }
                    if (msg.toolCall?.functionCalls) {
                        const s = await sessionRef.current;
                        if (s) msg.toolCall.functionCalls.forEach(fc => handleToolCall(fc, s));
                    }
                    if (msg.serverContent?.interrupted) {
                         audioSourcesRef.current.forEach(s => s.stop());
                         audioSourcesRef.current.clear();
                         audioPlaybackTimeRef.current = 0;
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error("Session error:", e);
                    setStatusText("An error occurred. Please try again.");
                    stopSession();
                },
                onclose: () => isSessionActiveRef.current && stopSession(),
            },
        });
    };

    const startAndGreetSession = async () => {
        if (!process.env.API_KEY || !user) return;
        isSessionActiveRef.current = true;
        setIsGreeting(true);
        setStatusText("Assistant is speaking...");
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        try {
            const ai = getAi();
            const res = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts", contents: [{ parts: [{ text: 'Hello, how can I help you?' }] }],
                config: { responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
            });
            const base64 = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64 || !outputAudioContextRef.current) throw new Error("TTS failed.");
            const buffer = await decodeAudioData(decode(base64), outputAudioContextRef.current, 24000, 1);
            const source = outputAudioContextRef.current.createBufferSource();
            greetingAudioSourceRef.current = source;
            source.buffer = buffer;
            source.connect(outputAudioContextRef.current.destination);
            source.onended = () => { if (isSessionActiveRef.current) startListeningSession(); };
            source.start();
        } catch (error) {
            console.error("Greeting failed:", error);
            stopSession();
        }
    };
    
    const handleMicClick = () => {
        if (isListening || isGreeting) stopSession();
        else startAndGreetSession();
    };

    const handleCaptureOpen = (mode: 'item' | 'invoice' | 'shelf-analysis') => {
        // Check usage limit for AI Scans (Invoice & Shelf Analysis are heavy operations)
        // Basic item snap also counts in this model as "AI usage"
        const currentUsage = userProfile?.usage?.aiScans || 0;
        if (mode !== 'item' && !checkUsageLimit('aiScans', currentUsage)) {
            return;
        }
        
        setCameraMode(mode);
        setIsCameraOpen(true);
    };
    
    const handleImageCapture = async (captureData: string | string[]) => {
        setIsCameraOpen(false);
        setIsAnalyzingImage(true);
        setToastMessage('Processing view...');
        
        const isInvoice = cameraMode === 'invoice';
        const isShelfAnalysis = cameraMode === 'shelf-analysis';

        // Increment Usage for Scan
        await handleIncrementUsage('aiScans');

        // Handle Array of images (Walkthrough Mode)
        if (Array.isArray(captureData)) {
            if (isShelfAnalysis) {
                // Multi-frame analysis for Shelf Doctor
                const analysisPrompt = `Act as a retail expert and Visual Merchandiser. I am showing you a VIDEO WALKTHROUGH (sequence of frames) of a shop.
                 Analyze the *entire* flow visible in these frames to find problems that a single photo would miss.
                 1. **Global Ghost Spots:** Identify major gaps/empty shelves across the entire section scanned.
                 2. **Layout Flow:** Are high-margin items hidden? Is the arrangement logical?
                 3. **Power Move:** Suggest ONE holistic change (e.g., "Swap the top shelf display with the middle one").
                 4. **Score:** Rate the overall shop presentation (1-10).
                 
                 Return purely JSON: { "score": number, "ghostSpots": string[], "misplacedItems": string[], "powerMove": string }`;

                try {
                    const ai = getAi();
                    const imageParts = captureData.map(base64 => ({
                        inlineData: { mimeType: 'image/jpeg', data: base64 }
                    }));
                    
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: {
                            parts: [
                                ...imageParts,
                                { text: analysisPrompt }
                            ]
                        },
                        config: { responseMimeType: 'application/json' }
                    });
                    
                    if (response.text) {
                        const report = JSON.parse(response.text);
                        setShelfReport(report);
                        setToastMessage("360° Analysis Complete!");
                    }
                } catch (err) {
                    console.error("Walkthrough analysis failed", err);
                    setToastMessage("Could not analyze walkthrough.");
                } finally {
                    setIsAnalyzingImage(false);
                }
                return;
            }
        }

        // Handle Single Image (Legacy Mode)
        const base64Image = Array.isArray(captureData) ? captureData[0] : captureData;

        if (isShelfAnalysis) {
             const analysisPrompt = `Act as a retail expert and Visual Merchandiser. Analyze this shelf image thoroughly.
             1. **Ghost Spots:** Identify gaps/empty spaces where products are missing (potential lost revenue).
             2. **Misplaced Items:** Spot items that look messy or out of place.
             3. **Power Move:** Suggest ONE high-impact change to increase sales (e.g. "Move high-margin chocolate to eye level").
             4. **Score:** Rate the shelf presentation from 1-10.
             
             Return purely JSON: { "score": number, "ghostSpots": string[], "misplacedItems": string[], "powerMove": string }`;
             
             try {
                const ai = getAi();
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: {
                        parts: [
                            { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
                            { text: analysisPrompt }
                        ]
                    },
                    config: { responseMimeType: 'application/json' }
                });
                
                if (response.text) {
                    const report = JSON.parse(response.text);
                    setShelfReport(report);
                    setToastMessage("Shelf Analysis Complete!");
                }
             } catch (err) {
                 console.error("Analysis failed", err);
                 setToastMessage("Could not analyze shelf.");
             } finally {
                 setIsAnalyzingImage(false);
             }
             return;
        }

        setIsReviewingInvoice(isInvoice);

        const snapPrompt = `Analyze this image for an inventory system. Identify ALL distinct types of items visible (e.g. on a shelf, in a pile, or individually). For EACH item type found:
                        1. Identify the product name (be specific).
                        2. Estimate the quantity visible (count them).
                        3. Suggest a realistic market price in INR for one unit.
                        4. Calculate an expiry date (DD-MM-YYYY) based on the product type (e.g. milk: 2 days, packaged snacks: 6 months, rice: 1 year).
                        Today is ${new Date().toLocaleDateString()}. Return the result as a JSON ARRAY.`;

        const invoicePrompt = `Analyze this image as a supplier invoice, bill, or receipt. 
                        Extract the list of items purchased. For each row in the bill:
                        1. Identify the product name.
                        2. Extract the quantity.
                        3. Extract the unit price in INR. If only total is given, calculate unit price.
                        4. If an expiry date is mentioned for an item, extract it (DD-MM-YYYY). If not, estimate a safe expiry based on the product type (e.g. Milk=2days, Rice=1yr).
                        Today is ${new Date().toLocaleDateString()}. Return the result as a JSON ARRAY.`;

        try {
            const ai = getAi();
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: {
                    parts: [
                        { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
                        { text: isInvoice ? invoicePrompt : snapPrompt }
                    ]
                },
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING, description: 'Name of the product identified' },
                                quantity: { type: Type.NUMBER, description: 'Count/Quantity' },
                                price: { type: Type.NUMBER, description: 'Price per unit in INR' },
                                expiryDate: { type: Type.STRING, description: 'Expiry date in DD-MM-YYYY format' }
                            },
                            required: ['name', 'quantity', 'price', 'expiryDate']
                        }
                    }
                }
            });

            const jsonText = response.text;
            if (jsonText) {
                const data = JSON.parse(jsonText);
                const items = Array.isArray(data) ? data : [data];
                setReviewItems(items);
                if (items.length === 0) {
                    setToastMessage('No items detected. Please try again.');
                }
            } else {
                setToastMessage('Could not analyze image. Please try again.');
            }

        } catch (err) {
            console.error("Image analysis failed:", err);
            setToastMessage('Failed to analyze image.');
        } finally {
            setIsAnalyzingImage(false);
        }
    };

    const updateReviewItem = (index: number, field: keyof DetectedItem, value: any) => {
        const newItems = [...reviewItems];
        newItems[index] = { ...newItems[index], [field]: value };
        setReviewItems(newItems);
    };

    const removeReviewItem = (index: number) => {
        const newItems = reviewItems.filter((_, i) => i !== index);
        setReviewItems(newItems);
    };

    const handleConfirmReview = async () => {
        if (!user || reviewItems.length === 0) return;
        try {
            let count = 0;
            for (const item of reviewItems) {
                await addOrUpdateItem(user.uid, item.name, item.quantity, item.price, item.expiryDate);
                count++;
            }
            setReviewItems([]);
            setToastMessage(`Successfully added ${count} items!`);
        } catch (err) {
            setToastMessage('Failed to save items.');
        }
    };
    
    const handleUpdateItem = async (updatedItem: InventoryItem) => {
        if (!user) return;
        try {
            await updateInventoryItem(user.uid, updatedItem.id, {
                name: updatedItem.name,
                quantity: updatedItem.quantity,
                price: updatedItem.price,
                expiryDate: updatedItem.expiryDate
            });
            setEditingItem(null);
            setToastMessage(`Updated ${updatedItem.name} successfully.`);
        } catch (error) {
            console.error("Update failed", error);
            setToastMessage("Failed to update item.");
        }
    };

    // Batch Actions Logic
    const handleBulkDelete = async () => {
        if (!user || selectedItemIds.size === 0) return;
        if (window.confirm(`Are you sure you want to delete ${selectedItemIds.size} items?`)) {
            try {
                await deleteItemsBatch(user.uid, Array.from(selectedItemIds));
                setSelectedItemIds(new Set());
                setToastMessage('Selected items deleted.');
            } catch (error) {
                console.error("Batch delete failed", error);
                setToastMessage('Failed to delete items.');
            }
        }
    };

    const handleBulkPromo = async () => {
        // Usage Check for Promos
        const currentPromos = userProfile?.usage?.promosGenerated || 0;
        if (!checkUsageLimit('promosGenerated', currentPromos)) {
            return;
        }

        if (selectedItemIds.size === 0) return;
        setIsGeneratingBulkPromo(true);
        
        const selectedItems = inventory.filter(i => selectedItemIds.has(i.id));
        const itemNames = selectedItems.map(i => i.name).join(", ");
        
        const ai = getAi();
        const prompt = `Create a compelling "Bundle Deal" WhatsApp promo message for these items: ${itemNames}. 
        Suggest a discount (e.g. "Buy all for 15% off"). Use emojis. Make it short and exciting.`;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt
            });
            setBulkPromoContent(response.text);
            await handleIncrementUsage('promosGenerated');
        } catch (error) {
            setToastMessage("Failed to generate promo.");
        } finally {
            setIsGeneratingBulkPromo(false);
        }
    };

    const filteredInventory = inventory.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const totalItems = inventory.reduce((acc, item) => acc + item.quantity, 0);
    const totalValue = inventory.reduce((acc, item) => acc + (item.quantity * item.price), 0);

    return (
        <main className="container mx-auto p-4 md:p-8 pb-24">
            <Toast message={toastMessage} onClose={() => setToastMessage('')} />
            
            <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
                    <p className="text-gray-500 dark:text-gray-400">Welcome, {userProfile?.name}</p>
                    <div className="mt-2 flex items-center gap-2">
                        {userProfile?.plan === 'pro' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
                                Vyapar Pro 🚀
                            </span>
                        ) : (
                            <button 
                                onClick={() => setShowSubscriptionModal(true)}
                                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-indigo-100 hover:text-indigo-700 transition-colors"
                            >
                                Free Plan ({userProfile?.usage?.aiScans || 0}/{PLAN_LIMITS.free.maxAiScans} Scans Used)
                            </button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={onOpenNotifications} title="Notifications" className="relative p-3 text-gray-500 dark:text-white bg-gray-200 dark:bg-gray-700 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600">
                         <BellIcon className="w-5 h-5" />
                         {totalUnreadNotificationCount > 0 && <span className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white ring-2 ring-white dark:ring-gray-700">{totalUnreadNotificationCount}</span>}
                    </button>
                    <button onClick={() => setIsChatModalOpen(true)} title="Chats" className="relative p-3 text-gray-500 dark:text-white bg-gray-200 dark:bg-gray-700 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600">
                        <ChatIcon className="w-5 h-5" />
                        {totalUnreadChatCount > 0 && <span className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white ring-2 ring-white dark:ring-gray-700">{totalUnreadChatCount}</span>}
                    </button>
                    <button onClick={logOut} title="Logout" className="p-3 text-gray-500 dark:text-white bg-gray-200 dark:bg-gray-700 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600">
                        <LogoutIcon className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* Business Pilot Section */}
            <div className="relative">
                 {/* Passed checkUsageLimit to BusinessPilot to handle limits internally */}
                 <BusinessPilot inventory={inventory} checkUsageLimit={checkUsageLimit} onIncrementUsage={handleIncrementUsage} />
            </div>

            <section className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-6 text-white shadow-lg relative overflow-hidden">
                    <div className="relative z-10">
                         <h2 className="text-lg font-semibold mb-1">Voice Assistant</h2>
                         <p className="text-indigo-100 text-sm h-12 overflow-hidden">{statusText}</p>
                    </div>
                    <div className="absolute bottom-4 right-4 z-20">
                         <MicButton isListening={isListening || isGreeting} onClick={handleMicClick} />
                    </div>
                     {/* Visualization Circles */}
                    {(isListening || isGreeting) && (
                        <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none">
                            <span className="animate-ping absolute inline-flex h-32 w-32 rounded-full bg-white opacity-10"></span>
                            <span className="animate-ping absolute inline-flex h-48 w-48 rounded-full bg-white opacity-5 delay-100"></span>
                        </div>
                    )}
                </div>

                 <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Visual AI Tools</h2>
                    <div className="grid grid-cols-3 gap-2">
                        <button 
                            onClick={() => handleCaptureOpen('item')}
                            className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors group"
                        >
                             <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-full mb-1 group-hover:bg-indigo-200 dark:group-hover:bg-indigo-800">
                                <CameraIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                             </div>
                             <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center">Snap Item</span>
                        </button>
                        <button 
                            onClick={() => handleCaptureOpen('invoice')}
                            className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors group relative"
                        >
                             {userProfile?.plan !== 'pro' && <div className="absolute top-1 right-1 w-2 h-2 bg-yellow-400 rounded-full" title="Limited" />}
                             <div className="p-2 bg-green-100 dark:bg-green-900 rounded-full mb-1 group-hover:bg-green-200 dark:group-hover:bg-green-800">
                                <DocumentTextIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
                             </div>
                             <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center">Scan Bill</span>
                        </button>
                        <button 
                            onClick={() => handleCaptureOpen('shelf-analysis')}
                            className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors group relative"
                        >
                             {userProfile?.plan !== 'pro' && <div className="absolute top-1 right-1 w-2 h-2 bg-yellow-400 rounded-full" title="Limited" />}
                             <div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-full mb-1 group-hover:bg-purple-200 dark:group-hover:bg-purple-800">
                                <PresentationChartLineIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                             </div>
                             <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center">Shelf Doctor</span>
                        </button>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 hidden lg:block">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Transcript</h2>
                    <div className="h-32 overflow-y-auto text-sm space-y-2 custom-scrollbar">
                        {transcript.length === 0 ? (
                            <p className="text-gray-400 italic">Conversation will appear here...</p>
                        ) : (
                            transcript.map((entry, i) => (
                                <div key={i} className={entry.speaker === 'user' ? 'text-right' : 'text-left'}>
                                    <span className={`inline-block px-3 py-1 rounded-lg ${entry.speaker === 'user' ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}>
                                        {entry.text}
                                    </span>
                                </div>
                            ))
                        )}
                         <div ref={transcriptEndRef} />
                    </div>
                </div>
            </section>

            {/* Search and Filter */}
            <div className="flex items-center mb-6 bg-white dark:bg-gray-800 p-2 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 max-w-md">
                <SearchIcon className="w-5 h-5 text-gray-400 ml-2" />
                <input
                    type="text"
                    placeholder="Search inventory..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-transparent border-none focus:ring-0 text-gray-900 dark:text-white ml-2 placeholder-gray-400"
                />
            </div>

            <InventoryTable 
                items={filteredInventory} 
                loading={inventoryLoading}
                totalItems={totalItems}
                totalValue={totalValue}
                onStartChat={() => setIsChatModalOpen(true)}
                onAddItemClick={() => {
                    if(!checkUsageLimit('inventoryCount', inventoryRef.current.length)) return;
                    startAndGreetSession();
                }}
                onEdit={(item) => setEditingItem(item)}
                selectedItems={selectedItemIds}
                onSelectionChange={setSelectedItemIds}
                onBulkDelete={handleBulkDelete}
                onBulkPromo={handleBulkPromo}
            />

            {/* Modals */}
            {isChatModalOpen && userProfile && (
                <ChatListModal 
                    currentUserProfile={userProfile} 
                    onClose={() => setIsChatModalOpen(false)} 
                    onNavigateToChat={onNavigateToChat}
                />
            )}

            {isCameraOpen && (
                <CameraCapture 
                    onCapture={handleImageCapture} 
                    onClose={() => setIsCameraOpen(false)}
                    mode={cameraMode}
                />
            )}

            {isAnalyzingImage && (
                <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl flex flex-col items-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                        <p className="text-lg font-semibold text-gray-900 dark:text-white">AI is analyzing your {cameraMode === 'invoice' ? 'bill' : cameraMode === 'shelf-analysis' ? 'shelf scan' : 'stock'}...</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                            {cameraMode === 'shelf-analysis' ? 'Building 360° view from video frames.' : 'Identifying items, prices, and expiry dates.'}
                        </p>
                    </div>
                </div>
            )}

            {/* Shelf Doctor Report Modal */}
            {shelfReport && (
                <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center backdrop-blur-sm p-4 animate-fade-in-down">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden relative">
                        <button onClick={() => setShelfReport(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <XMarkIcon className="w-6 h-6" />
                        </button>
                        
                        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
                            <div className="flex items-center gap-3 mb-2">
                                <PresentationChartLineIcon className="w-8 h-8" />
                                <h2 className="text-2xl font-bold">Shelf Diagnosis</h2>
                            </div>
                            <p className="text-purple-100 text-sm">Visual Merchandising AI Report</p>
                        </div>

                        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                            {/* Score */}
                            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
                                <div>
                                    <p className="text-sm font-bold text-gray-500 uppercase">Merchandising Score</p>
                                    <p className="text-3xl font-bold text-gray-900 dark:text-white">{shelfReport.score}/10</p>
                                </div>
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white 
                                    ${shelfReport.score >= 8 ? 'bg-green-500' : shelfReport.score >= 5 ? 'bg-yellow-500' : 'bg-red-500'}`}>
                                    {shelfReport.score}
                                </div>
                            </div>

                            {/* Power Move */}
                            <div className="border-l-4 border-purple-500 pl-4">
                                <h4 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                    <SparklesIcon className="w-5 h-5 text-purple-500" />
                                    AI Power Move
                                </h4>
                                <p className="text-gray-700 dark:text-gray-300 mt-1">{shelfReport.powerMove}</p>
                            </div>

                            {/* Issues */}
                            <div className="grid grid-cols-1 gap-4">
                                {shelfReport.ghostSpots.length > 0 && (
                                    <div>
                                        <p className="text-sm font-bold text-red-500 uppercase mb-1">Ghost Spots (Lost Sales)</p>
                                        <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400">
                                            {shelfReport.ghostSpots.map((spot, i) => <li key={i}>{spot}</li>)}
                                        </ul>
                                    </div>
                                )}
                                {shelfReport.misplacedItems.length > 0 && (
                                    <div>
                                        <p className="text-sm font-bold text-orange-500 uppercase mb-1">Needs Attention</p>
                                        <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400">
                                            {shelfReport.misplacedItems.map((item, i) => <li key={i}>{item}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            <button 
                                onClick={() => setShelfReport(null)}
                                className="w-full py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg font-bold transition-colors"
                            >
                                Close Report
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Review Items Modal (Batch Add) */}
            {reviewItems.length > 0 && (
                <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                                    Review {isReviewingInvoice ? 'Invoice' : 'Detected'} Items
                                </h2>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Please verify the AI's findings before adding.</p>
                            </div>
                            <button onClick={() => setReviewItems([])} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                                <XMarkIcon className="w-6 h-6" />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {reviewItems.map((item, idx) => (
                                    <div key={idx} className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg border border-gray-200 dark:border-gray-600 relative group">
                                        <button 
                                            onClick={() => removeReviewItem(idx)}
                                            className="absolute top-2 right-2 p-1 bg-red-100 dark:bg-red-900/50 text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Remove item"
                                        >
                                            <XMarkIcon className="w-4 h-4" />
                                        </button>

                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-xs font-bold text-gray-500 uppercase">Product</label>
                                                <input 
                                                    type="text" 
                                                    value={item.name}
                                                    onChange={(e) => updateReviewItem(idx, 'name', e.target.value)}
                                                    className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-indigo-500 outline-none text-sm font-medium text-gray-900 dark:text-white"
                                                />
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="flex-1">
                                                    <label className="text-xs font-bold text-gray-500 uppercase">Qty</label>
                                                    <input 
                                                        type="number" 
                                                        value={item.quantity}
                                                        onChange={(e) => updateReviewItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                                                        className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-indigo-500 outline-none text-sm text-gray-900 dark:text-white"
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <label className="text-xs font-bold text-gray-500 uppercase">Price (₹)</label>
                                                    <input 
                                                        type="number" 
                                                        value={item.price}
                                                        onChange={(e) => updateReviewItem(idx, 'price', parseFloat(e.target.value) || 0)}
                                                        className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-indigo-500 outline-none text-sm text-gray-900 dark:text-white"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-xs font-bold text-gray-500 uppercase">Expiry</label>
                                                <input 
                                                    type="text" 
                                                    value={item.expiryDate}
                                                    onChange={(e) => updateReviewItem(idx, 'expiryDate', e.target.value)}
                                                    placeholder="DD-MM-YYYY"
                                                    className="w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:border-indigo-500 outline-none text-sm text-gray-900 dark:text-white"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex justify-end gap-3">
                             <button 
                                onClick={() => setReviewItems([])}
                                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg font-medium"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={handleConfirmReview}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md transition-colors flex items-center gap-2"
                            >
                                <CheckIcon className="w-5 h-5" />
                                Confirm & Add All ({reviewItems.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Edit Item Modal */}
            {editingItem && (
                <EditItemModal 
                    item={editingItem} 
                    onClose={() => setEditingItem(null)} 
                    onSave={handleUpdateItem}
                />
            )}

            {/* Bulk Promo Modal */}
            {bulkPromoContent && (
                <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 animate-fade-in-down">
                        <div className="text-center mb-4">
                            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
                                <SparklesIcon className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Bundle Deal Ready!</h3>
                        </div>
                        
                        <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg mb-6 text-gray-800 dark:text-gray-200 font-medium italic text-center relative">
                            "{bulkPromoContent}"
                        </div>

                        <div className="flex gap-3">
                            <button 
                                onClick={() => setBulkPromoContent(null)}
                                className="flex-1 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium"
                            >
                                Close
                            </button>
                            <button 
                                onClick={() => {
                                    navigator.clipboard.writeText(bulkPromoContent);
                                    alert("Copied to clipboard!");
                                }}
                                className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold shadow-md flex items-center justify-center gap-2"
                            >
                                <ShareIcon className="w-4 h-4" />
                                Copy
                            </button>
                        </div>
                    </div>
                </div>
            )}
             {isGeneratingBulkPromo && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center backdrop-blur-sm">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-xl flex flex-col items-center">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
                        <p className="text-gray-900 dark:text-white font-medium">Crafting bundle offer...</p>
                    </div>
                </div>
            )}
            
            {/* Subscription Modal */}
            {showSubscriptionModal && (
                <SubscriptionModal onClose={() => setShowSubscriptionModal(false)} />
            )}

        </main>
    );
};

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.739a.75.75 0 0 1 1.04-.208Z" clipRule="evenodd" />
    </svg>
);

export default InventoryManager;
