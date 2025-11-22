
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LiveSession, LiveServerMessage, Modality, Blob as GenaiBlob, FunctionCall, Type } from '@google/genai';
import { INITIATE_ADD_ITEM_TOOL, PROVIDE_ITEM_QUANTITY_TOOL, PROVIDE_ITEM_PRICE_TOOL, REMOVE_ITEM_TOOL, QUERY_INVENTORY_TOOL, PROVIDE_ITEM_EXPIRY_DATE_TOOL, BULK_ACTION_TOOL, PLAN_LIMITS } from '../constants';
import { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import InventoryTable from './InventoryTable';
import MicButton from './MicButton';
import CameraCapture from './CameraCapture';
import EditItemModal from './EditItemModal';
import AddItemModal from './AddItemModal';
import BusinessPilot from './BusinessPilot';
import SubscriptionModal from './SubscriptionModal';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { getAi } from '../services/geminiService';
import { addOrUpdateItem, removeItem, updateInventoryItem, deleteItemsBatch } from '../services/inventoryService';
import { getChatsStream } from '../services/chatService';
import { getNotificationsStream } from '../services/notificationService';
import { incrementUserUsage } from '../services/firebase';
import { LogoutIcon, SearchIcon, ChatIcon, BellIcon, CameraIcon, XMarkIcon, DocumentTextIcon, SparklesIcon, ShareIcon, PresentationChartLineIcon, PlusIcon, EyeIcon, ChevronDownIcon, ChevronUpIcon, ArrowsRightLeftIcon } from './icons';
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

interface VisualAnnotation {
    label: string;
    type: 'ghost_spot' | 'misplaced' | 'good';
    frameIndex: number;
    box2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000 scale
    suggestion: string;
}

// Type for the Shelf Doctor Report
interface ShelfAnalysisReport {
    score: number;
    summary: string;
    powerMove: string;
    visualIssues: VisualAnnotation[];
    capturedFrames: string[]; // Store base64 frames to display
    improvedFrame?: string; // Base64 of AI-renovated shelf
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
    const [cameraMode, setCameraMode] = useState<'item' | 'invoice' | 'shelf-analysis'>('item');
    
    const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    
    // State for manual review/edit modals
    const [reviewItems, setReviewItems] = useState<DetectedItem[]>([]);
    const [isReviewingInvoice, setIsReviewingInvoice] = useState(false); 
    const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
    const [showAddItemModal, setShowAddItemModal] = useState(false);

    // State for Shelf Doctor Report
    const [shelfReport, setShelfReport] = useState<ShelfAnalysisReport | null>(null);
    const [activeFrameIndex, setActiveFrameIndex] = useState(0);
    const [reportTab, setReportTab] = useState<'ar' | 'simulation'>('ar');
    const [compareSliderValue, setCompareSliderValue] = useState(50);
    
    // State for Batch Actions
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
    const [bulkPromoContent, setBulkPromoContent] = useState<string | null>(null);
    const [isGeneratingBulkPromo, setIsGeneratingBulkPromo] = useState(false);

    // Subscription Modal State
    const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);

    // REF for selectedItems to access fresh state inside the Live API closure
    const selectedItemIdsRef = useRef<Set<string>>(new Set());
    const inventoryRef = useRef<InventoryItem[]>([]);

    // Ref for 3D tilt effect
    const comparisonContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        selectedItemIdsRef.current = selectedItemIds;
    }, [selectedItemIds]);

    useEffect(() => {
        inventoryRef.current = inventory;
    }, [inventory]);

    // Handle 3D Tilt Effect
    useEffect(() => {
        const container = comparisonContainerRef.current;
        if (!container || !shelfReport || reportTab !== 'simulation') return;

        const handleMouseMove = (e: MouseEvent) => {
            const { left, top, width, height } = container.getBoundingClientRect();
            const x = (e.clientX - left) / width;
            const y = (e.clientY - top) / height;
            
            const tiltX = (0.5 - y) * 10; // Max 10deg tilt
            const tiltY = (x - 0.5) * 10;

            container.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
        };

        const handleMouseLeave = () => {
            container.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg)`;
        };

        container.addEventListener('mousemove', handleMouseMove);
        container.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            container.removeEventListener('mousemove', handleMouseMove);
            container.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [shelfReport, reportTab]);

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
        if (userProfile.plan === 'pro') return true; 

        const limit = PLAN_LIMITS.free[feature === 'inventoryCount' ? 'maxInventoryItems' : feature === 'aiScans' ? 'maxAiScans' : 'maxPromos'];
        
        if (currentCount >= limit) {
            setShowSubscriptionModal(true);
            return false;
        }
        return true;
    };

    const handleIncrementUsage = async (feature: 'aiScans' | 'promosGenerated') => {
        if (!user || !userProfile) return;
        const newCount = (userProfile.usage?.[feature] || 0) + 1;
        updateUserProfileState({ 
            usage: { ...userProfile.usage, [feature]: newCount } 
        });
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
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                 setStatusText("Microphone blocked. Tap the lock icon 🔒 in the URL bar to allow access.");
                 setToastMessage("Permission Denied. Please enable microphone access in your browser settings.");
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
- To add an item: Use 'initiateAddItem'. If the user doesn't say how many, the system will ask. Once you know the quantity, you must ask for the price.
- ${needsExpiry ? "For this store type, items may have an expiry date. After getting the price, you MUST ask for the expiry date and you MUST explicitly state the required format is Day-Month-Year (DD-MM-YYYY)." : "For this store type, items DO NOT have an expiry date, so DO NOT ask for one."}
- To remove an item: Use 'removeItem'.
- To answer questions: Use 'queryInventory' and then answer based on the provided inventory context.
- To manage selected items in the UI: Use 'performBulkAction'.
Keep responses brief. Current inventory is: ${JSON.stringify(inventory.slice(0, 50))}`;

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
                        const pcmBlob: GenaiBlob = { data: encode(new Uint8Array(new Int16Array(inputData.map(f => f * 32768)).buffer)), mimeType: 'audio/pcm;rate=16000' };
                        sessionRef.current?.then((s) => isSessionActiveRef.current && s.sendRealtimeInput({ media: pcmBlob }));
                    };
                    source.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                },
                onmessage: async (msg: LiveServerMessage) => {
                    if (msg.serverContent?.inputTranscription) {
                        // ... (transcript updates)
                    }
                    if (msg.serverContent?.outputTranscription) {
                         // ... (transcript updates)
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
                },
                onerror: (e: ErrorEvent) => { stopSession(); },
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
            stopSession();
        }
    };
    const handleMicClick = () => { if (isListening || isGreeting) stopSession(); else startAndGreetSession(); };
    const handleCaptureOpen = (mode: 'item' | 'invoice' | 'shelf-analysis') => {
        const currentUsage = userProfile?.usage?.aiScans || 0;
        if (mode !== 'item' && !checkUsageLimit('aiScans', currentUsage)) { return; }
        setCameraMode(mode);
        setIsCameraOpen(true);
    };

    // ---------------- VISUAL DOCTOR LOGIC ----------------

    const handleImageCapture = async (captureData: string | string[]) => {
        setIsCameraOpen(false);
        setIsAnalyzingImage(true);
        setToastMessage('Processing view...');
        
        const isInvoice = cameraMode === 'invoice';
        const isShelfAnalysis = cameraMode === 'shelf-analysis';

        await handleIncrementUsage('aiScans');

        if (isShelfAnalysis) {
            const frames = Array.isArray(captureData) ? captureData : [captureData];
            const ai = getAi();
            
            // 1. ANALYZE FRAMES
            const analysisPrompt = `Act as a visual retail expert. Analyze this sequence of shelf images.
             Identify visual merchandising issues.
             1. **Ghost Spots:** Empty spaces where product is missing.
             2. **Misplaced Items:** Items that are messy or in the wrong place.
             
             CRITICAL: For each issue, identify the specific frame index (0 to ${frames.length - 1}) that best shows it.
             Return the 2D bounding box [ymin, xmin, ymax, xmax] on a 0-1000 scale for the issue.
             
             Return purely JSON: 
             { 
               "score": number (1-10), 
               "summary": "Short text summary of findings",
               "powerMove": "One key action to improve sales",
               "visualIssues": [
                 { "label": "Empty Shelf", "type": "ghost_spot", "frameIndex": number, "box2d": [ymin, xmin, ymax, xmax], "suggestion": "Restock immediately" }
               ]
             }`;

            try {
                const imageParts = frames.map(base64 => ({
                    inlineData: { mimeType: 'image/jpeg', data: base64 }
                }));
                
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: {
                        parts: [...imageParts, { text: analysisPrompt }]
                    },
                    config: { responseMimeType: 'application/json' }
                });
                
                if (response.text) {
                    const report = JSON.parse(response.text);
                    report.capturedFrames = frames;
                    
                    // 2. GENERATE IMPROVED IMAGE (AI RENOVATION)
                    // We take the frame with most issues, or just the middle frame as representative
                    // Find worst frame or default to middle
                    const issueCounts = new Array(frames.length).fill(0);
                    report.visualIssues.forEach((issue: any) => {
                        if(issue.frameIndex >= 0 && issue.frameIndex < frames.length) issueCounts[issue.frameIndex]++;
                    });
                    const worstFrameIndex = issueCounts.indexOf(Math.max(...issueCounts));
                    const frameToFix = frames[worstFrameIndex >= 0 ? worstFrameIndex : Math.floor(frames.length / 2)];
                    
                    setToastMessage("Generating Renovation Plan...");
                    
                    // Call Image Editing Model
                    const editResponse = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image',
                        contents: {
                            parts: [
                                { inlineData: { mimeType: 'image/jpeg', data: frameToFix } },
                                { text: 'Edit this shop shelf image to look perfect. Fill empty spaces with products, organize messy items to be straight, and make it look like a high-end retail display. Keep the general layout but fix the merchandising issues.' },
                            ],
                        },
                    });
                    
                    // Extract image from response parts
                    let improvedImageBase64 = null;
                    if (editResponse.candidates && editResponse.candidates[0].content.parts) {
                        for (const part of editResponse.candidates[0].content.parts) {
                            if (part.inlineData && part.inlineData.data) {
                                improvedImageBase64 = part.inlineData.data;
                                break;
                            }
                        }
                    }
                    
                    if (improvedImageBase64) {
                        report.improvedFrame = improvedImageBase64;
                        // Set the active frame to the one we improved so comparison makes sense
                        setActiveFrameIndex(worstFrameIndex >= 0 ? worstFrameIndex : Math.floor(frames.length / 2)); 
                    }

                    setShelfReport(report);
                    setToastMessage("Visual Diagnosis Ready!");
                }
            } catch (err) {
                console.error("Analysis failed", err);
                setToastMessage("Could not analyze shelf.");
            } finally {
                setIsAnalyzingImage(false);
            }
            return;
        }

        // ... Legacy logic for items/invoices ...
        setIsReviewingInvoice(isInvoice);
        const base64Image = Array.isArray(captureData) ? captureData[0] : captureData;
        const snapPrompt = `Analyze this image for inventory. Identify ALL distinct items. Return JSON Array of {name, quantity, price (INR), expiryDate (DD-MM-YYYY)}.`;
        const invoicePrompt = `Analyze this invoice. Extract items. Return JSON Array of {name, quantity, price (unit INR), expiryDate (DD-MM-YYYY)}.`;

        try {
            const ai = getAi();
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: {
                    parts: [{ inlineData: { mimeType: 'image/jpeg', data: base64Image } }, { text: isInvoice ? invoicePrompt : snapPrompt }]
                },
                config: { responseMimeType: 'application/json' }
            });

            if (response.text) {
                const data = JSON.parse(response.text);
                const items = Array.isArray(data) ? data : [data];
                setReviewItems(items);
                if (items.length === 0) setToastMessage('No items detected.');
            }
        } catch (err) {
            setToastMessage('Failed to analyze image.');
        } finally {
            setIsAnalyzingImage(false);
        }
    };

    const handleManualAddItem = async (itemData: { name: string; quantity: number; price: number; expiryDate?: string }) => {
        if (!user) return;
        if (!checkUsageLimit('inventoryCount', inventoryRef.current.length)) {
            setToastMessage("Inventory limit reached.");
            return;
        }
        try {
            await addOrUpdateItem(user.uid, itemData.name, itemData.quantity, itemData.price, itemData.expiryDate);
            setShowAddItemModal(false);
            setToastMessage(`Added ${itemData.name} successfully.`);
        } catch (e) {
            setToastMessage("Failed to add item.");
        }
    };

    const handleUpdateItem = async (updatedItem: InventoryItem) => {
        if (!user) return;
        try {
            await updateInventoryItem(user.uid, updatedItem.id, updatedItem);
            setEditingItem(null);
            setToastMessage(`Updated ${updatedItem.name} successfully.`);
        } catch (error) {
            setToastMessage("Failed to update item.");
        }
    };

    const handleConfirmReview = async () => {
        if (!user || reviewItems.length === 0) return;
        try {
            for (const item of reviewItems) {
                await addOrUpdateItem(user.uid, item.name, item.quantity, item.price, item.expiryDate);
            }
            setReviewItems([]);
            setToastMessage(`Successfully added items!`);
        } catch (err) {
            setToastMessage('Failed to save items.');
        }
    };

    const updateReviewItem = (index: number, field: keyof DetectedItem, value: any) => {
        const newItems = [...reviewItems];
        newItems[index] = { ...newItems[index], [field]: value };
        setReviewItems(newItems);
    };
    const removeReviewItem = (index: number) => setReviewItems(reviewItems.filter((_, i) => i !== index));

    const handleBulkDelete = async () => {
        if (!user || selectedItemIds.size === 0) return;
        if (window.confirm(`Delete ${selectedItemIds.size} items?`)) {
            try {
                await deleteItemsBatch(user.uid, Array.from(selectedItemIds));
                setSelectedItemIds(new Set());
                setToastMessage('Items deleted.');
            } catch (error) {
                setToastMessage('Failed to delete.');
            }
        }
    };

    const handleBulkPromo = async () => {
        const currentPromos = userProfile?.usage?.promosGenerated || 0;
        if (!checkUsageLimit('promosGenerated', currentPromos)) return;
        if (selectedItemIds.size === 0) return;
        setIsGeneratingBulkPromo(true);
        const selectedItems = inventory.filter(i => selectedItemIds.has(i.id));
        const itemNames = selectedItems.map(i => i.name).join(", ");
        const ai = getAi();
        const prompt = `Create a WhatsApp promo for bundle: ${itemNames}. Discount? Emojis. Short.`;
        try {
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setBulkPromoContent(response.text);
            await handleIncrementUsage('promosGenerated');
        } catch (error) { setToastMessage("Failed to generate promo."); } finally { setIsGeneratingBulkPromo(false); }
    };

    const filteredInventory = inventory.filter(item => item.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const totalItems = inventory.reduce((acc, item) => acc + item.quantity, 0);
    const totalValue = inventory.reduce((acc, item) => acc + (item.quantity * item.price), 0);

    return (
        <main className="container mx-auto p-4 md:p-8 pb-24">
            <Toast message={toastMessage} onClose={() => setToastMessage('')} />
            {/* ... Header & Business Pilot (Same as original) ... */}
            <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
                    <p className="text-gray-500 dark:text-gray-400">Welcome, {userProfile?.name}</p>
                    <div className="mt-2 flex items-center gap-2">
                        {userProfile?.plan === 'pro' ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-indigo-600 to-purple-600 text-white">Vyapar Pro 🚀</span>
                        ) : (
                            <button onClick={() => setShowSubscriptionModal(true)} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200">Free Plan ({userProfile?.usage?.aiScans || 0}/{PLAN_LIMITS.free.maxAiScans} Scans)</button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={onOpenNotifications} className="relative p-3 bg-gray-200 dark:bg-gray-700 rounded-full"><BellIcon className="w-5 h-5" />{totalUnreadNotificationCount > 0 && <span className="absolute top-0 right-0 h-5 w-5 bg-red-500 text-white text-xs flex items-center justify-center rounded-full">{totalUnreadNotificationCount}</span>}</button>
                    <button onClick={() => setIsChatModalOpen(true)} className="relative p-3 bg-gray-200 dark:bg-gray-700 rounded-full"><ChatIcon className="w-5 h-5" />{totalUnreadChatCount > 0 && <span className="absolute top-0 right-0 h-5 w-5 bg-red-500 text-white text-xs flex items-center justify-center rounded-full">{totalUnreadChatCount}</span>}</button>
                    <button onClick={logOut} className="p-3 bg-gray-200 dark:bg-gray-700 rounded-full"><LogoutIcon className="w-5 h-5" /></button>
                </div>
            </header>

            <BusinessPilot inventory={inventory} checkUsageLimit={checkUsageLimit} onIncrementUsage={handleIncrementUsage} />

            <section className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-6 text-white shadow-lg relative overflow-hidden">
                    <div className="relative z-10"><h2 className="text-lg font-semibold mb-1">Voice Assistant</h2><p className="text-indigo-100 text-sm h-12 overflow-hidden">{statusText}</p></div>
                    <div className="absolute bottom-4 right-4 z-20"><MicButton isListening={isListening || isGreeting} onClick={handleMicClick} /></div>
                    {(isListening || isGreeting) && <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center pointer-events-none"><span className="animate-ping absolute inline-flex h-32 w-32 rounded-full bg-white opacity-10"></span></div>}
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 flex flex-col justify-between">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Visual AI Tools</h2>
                    <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => handleCaptureOpen('item')} className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors group"><div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-full mb-1"><CameraIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" /></div><span className="text-xs font-medium text-gray-700 dark:text-gray-300">Snap Item</span></button>
                        <button onClick={() => handleCaptureOpen('invoice')} className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors group relative">{userProfile?.plan !== 'pro' && <div className="absolute top-1 right-1 w-2 h-2 bg-yellow-400 rounded-full" />}<div className="p-2 bg-green-100 dark:bg-green-900 rounded-full mb-1"><DocumentTextIcon className="w-5 h-5 text-green-600 dark:text-green-400" /></div><span className="text-xs font-medium text-gray-700 dark:text-gray-300">Scan Bill</span></button>
                        <button onClick={() => handleCaptureOpen('shelf-analysis')} className="flex flex-col items-center justify-center p-2 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors group relative">{userProfile?.plan !== 'pro' && <div className="absolute top-1 right-1 w-2 h-2 bg-yellow-400 rounded-full" />}<div className="p-2 bg-purple-100 dark:bg-purple-900 rounded-full mb-1"><PresentationChartLineIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" /></div><span className="text-xs font-medium text-gray-700 dark:text-gray-300">Shelf Doctor</span></button>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-md border border-gray-200 dark:border-gray-700 hidden lg:block">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Transcript</h2>
                    <div className="h-32 overflow-y-auto text-sm space-y-2 custom-scrollbar">{transcript.map((entry, i) => <div key={i} className={entry.speaker === 'user' ? 'text-right' : 'text-left'}><span className={`inline-block px-3 py-1 rounded-lg ${entry.speaker === 'user' ? 'bg-indigo-100 dark:bg-indigo-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>{entry.text}</span></div>)}<div ref={transcriptEndRef} /></div>
                </div>
            </section>

            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                <div className="flex items-center bg-white dark:bg-gray-800 p-2 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 w-full md:max-w-md"><SearchIcon className="w-5 h-5 text-gray-400 ml-2" /><input type="text" placeholder="Search inventory..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-transparent border-none focus:ring-0 text-gray-900 dark:text-white ml-2" /></div>
                <button onClick={() => setShowAddItemModal(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm w-full md:w-auto justify-center"><PlusIcon className="w-5 h-5" />Add Item Manually</button>
            </div>

            <InventoryTable items={filteredInventory} loading={inventoryLoading} totalItems={totalItems} totalValue={totalValue} onStartChat={() => setIsChatModalOpen(true)} onAddItemClick={() => startAndGreetSession()} onEdit={setEditingItem} selectedItems={selectedItemIds} onSelectionChange={setSelectedItemIds} onBulkDelete={handleBulkDelete} onBulkPromo={handleBulkPromo} />

            {/* Modals */}
            {isChatModalOpen && userProfile && <ChatListModal currentUserProfile={userProfile} onClose={() => setIsChatModalOpen(false)} onNavigateToChat={onNavigateToChat} />}
            {isCameraOpen && <CameraCapture onCapture={handleImageCapture} onClose={() => setIsCameraOpen(false)} mode={cameraMode} />}
            {isAnalyzingImage && <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center"><div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-2xl flex flex-col items-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div><p className="text-lg font-semibold text-gray-900 dark:text-white">AI is analyzing...</p></div></div>}

            {/* Visual Shelf Doctor Report */}
            {shelfReport && (
                <div className="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden relative flex flex-col max-h-[90vh]">
                        <button onClick={() => setShelfReport(null)} className="absolute top-4 right-4 z-10 text-white hover:text-gray-200 bg-black/50 rounded-full p-1"><XMarkIcon className="w-6 h-6" /></button>
                        
                        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white shrink-0">
                            <div className="flex items-center gap-3 mb-2">
                                <PresentationChartLineIcon className="w-8 h-8" />
                                <h2 className="text-2xl font-bold">Shelf Diagnosis</h2>
                            </div>
                            <p className="text-purple-100 text-sm">Visual Merchandising AI Report</p>
                        </div>

                        <div className="p-4 flex gap-4 border-b border-gray-200 dark:border-gray-700 shrink-0 bg-gray-50 dark:bg-gray-800/50">
                            <button onClick={() => setReportTab('ar')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${reportTab === 'ar' ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>AR Diagnosis</button>
                            <button onClick={() => setReportTab('simulation')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${reportTab === 'simulation' ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>AI Simulation (3D)</button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4">
                            {reportTab === 'ar' && (
                                <div className="space-y-6">
                                    <div className="relative bg-black min-h-[300px] flex items-center justify-center rounded-lg overflow-hidden">
                                        {/* Frame Display with AR Overlays */}
                                        {shelfReport.capturedFrames.length > 0 && (
                                            <div className="relative w-full">
                                                <img 
                                                    src={`data:image/jpeg;base64,${shelfReport.capturedFrames[activeFrameIndex]}`} 
                                                    className="w-full h-auto object-contain max-h-[50vh]" 
                                                    alt="Shelf Analysis" 
                                                />
                                                {/* Render Bounding Boxes for current frame */}
                                                {shelfReport.visualIssues
                                                    .filter(issue => issue.frameIndex === activeFrameIndex)
                                                    .map((issue, idx) => {
                                                        const [ymin, xmin, ymax, xmax] = issue.box2d;
                                                        // Convert 0-1000 scale to percentage
                                                        const style = {
                                                            top: `${ymin / 10}%`,
                                                            left: `${xmin / 10}%`,
                                                            height: `${(ymax - ymin) / 10}%`,
                                                            width: `${(xmax - xmin) / 10}%`,
                                                        };
                                                        return (
                                                            <div key={idx} className="absolute group cursor-pointer" style={style}>
                                                                <div className={`w-full h-full border-2 border-dashed ${issue.type === 'ghost_spot' ? 'border-red-500 bg-red-500/20' : 'border-orange-500 bg-orange-500/20'} animate-pulse`}></div>
                                                                {/* Tooltip on hover/click */}
                                                                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-48 bg-white dark:bg-gray-900 p-2 rounded shadow-lg text-xs z-20 hidden group-hover:block">
                                                                    <p className="font-bold text-gray-900 dark:text-white">{issue.label}</p>
                                                                    <p className="text-gray-500">{issue.suggestion}</p>
                                                                </div>
                                                            </div>
                                                        );
                                                    })
                                                }
                                            </div>
                                        )}
                                        
                                        {/* Navigation Controls */}
                                        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
                                            <button 
                                                onClick={() => setActiveFrameIndex(prev => Math.max(0, prev - 1))}
                                                disabled={activeFrameIndex === 0}
                                                className="p-2 bg-black/50 text-white rounded-full disabled:opacity-30 hover:bg-black/70"
                                            >
                                                <ChevronDownIcon className="w-6 h-6 rotate-90" />
                                            </button>
                                            <span className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">
                                                Frame {activeFrameIndex + 1} / {shelfReport.capturedFrames.length}
                                            </span>
                                            <button 
                                                onClick={() => setActiveFrameIndex(prev => Math.min(shelfReport.capturedFrames.length - 1, prev + 1))}
                                                disabled={activeFrameIndex === shelfReport.capturedFrames.length - 1}
                                                className="p-2 bg-black/50 text-white rounded-full disabled:opacity-30 hover:bg-black/70"
                                            >
                                                <ChevronUpIcon className="w-6 h-6 rotate-90" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
                                        <div>
                                            <p className="text-sm font-bold text-gray-500 uppercase">Merchandising Score</p>
                                            <p className="text-3xl font-bold text-gray-900 dark:text-white">{shelfReport.score}/10</p>
                                        </div>
                                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white ${shelfReport.score >= 8 ? 'bg-green-500' : shelfReport.score >= 5 ? 'bg-yellow-500' : 'bg-red-500'}`}>{shelfReport.score}</div>
                                    </div>
                                    
                                    <div className="text-sm text-gray-600 dark:text-gray-400 p-2">
                                        <p className="font-bold mb-1 text-gray-900 dark:text-white">Analysis Summary:</p>{shelfReport.summary}
                                    </div>
                                </div>
                            )}

                            {reportTab === 'simulation' && (
                                <div className="h-full flex flex-col items-center justify-center">
                                    {shelfReport.improvedFrame ? (
                                        <div className="w-full space-y-6">
                                            {/* 3D Comparison Container */}
                                            <div 
                                                className="relative w-full h-[400px] overflow-hidden rounded-xl shadow-2xl border-4 border-indigo-600 group cursor-col-resize"
                                                ref={comparisonContainerRef}
                                                style={{ transition: 'transform 0.1s ease-out' }}
                                                onMouseMove={(e) => {
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    const x = e.clientX - rect.left;
                                                    const percentage = (x / rect.width) * 100;
                                                    setCompareSliderValue(percentage);
                                                }}
                                            >
                                                {/* Original Image (Background) */}
                                                <img 
                                                    src={`data:image/jpeg;base64,${shelfReport.capturedFrames[activeFrameIndex]}`} 
                                                    className="absolute inset-0 w-full h-full object-cover" 
                                                    alt="Before"
                                                />
                                                <div className="absolute top-4 left-4 bg-black/60 text-white px-2 py-1 rounded text-xs font-bold">BEFORE</div>

                                                {/* Improved Image (Foreground - Clipped) */}
                                                <div 
                                                    className="absolute inset-0 overflow-hidden"
                                                    style={{ width: `${compareSliderValue}%` }}
                                                >
                                                    <img 
                                                        src={`data:image/jpeg;base64,${shelfReport.improvedFrame}`} 
                                                        className="absolute top-0 left-0 w-full h-[400px] object-cover max-w-none" // max-w-none ensures image doesn't scale with div width
                                                        style={{ width: comparisonContainerRef.current?.offsetWidth }} // Force width to match container
                                                        alt="After"
                                                    />
                                                    <div className="absolute top-4 right-4 bg-indigo-600/80 text-white px-2 py-1 rounded text-xs font-bold">AFTER (AI RENOVATION)</div>
                                                </div>

                                                {/* Slider Handle */}
                                                <div 
                                                    className="absolute top-0 bottom-0 w-1 bg-white cursor-col-resize shadow-[0_0_10px_rgba(0,0,0,0.5)] flex items-center justify-center"
                                                    style={{ left: `${compareSliderValue}%` }}
                                                >
                                                    <div className="w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-indigo-600">
                                                        <ArrowsRightLeftIcon className="w-5 h-5" />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="text-center">
                                                <h4 className="text-lg font-bold text-white flex items-center justify-center gap-2">
                                                    <SparklesIcon className="w-5 h-5 text-yellow-400" />
                                                    AI Renovation Plan
                                                </h4>
                                                <p className="text-gray-400 text-sm mt-1">Move your mouse to compare "Current" vs "Ideal" state.</p>
                                            </div>

                                            <div className="bg-indigo-900/30 border border-indigo-500/30 p-4 rounded-lg">
                                                <p className="text-indigo-200 text-sm">
                                                    <strong>Power Move:</strong> {shelfReport.powerMove}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-64 text-center p-6">
                                            <SparklesIcon className="w-12 h-12 text-gray-600 mb-4" />
                                            <p className="text-gray-400">AI Simulation not available for this scan.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        <div className="p-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                            <button onClick={() => setShelfReport(null)} className="w-full py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg font-bold transition-colors">Close Diagnosis</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ... other modals ... */}
            {reviewItems.length > 0 && (
                <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center"><div><h2 className="text-xl font-bold text-gray-900 dark:text-white">Review {isReviewingInvoice ? 'Invoice' : 'Detected'} Items</h2></div><button onClick={() => setReviewItems([])} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="w-6 h-6" /></button></div>
                        <div className="flex-1 overflow-y-auto p-6"><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{reviewItems.map((item, idx) => (<div key={idx} className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg border relative group"><button onClick={() => removeReviewItem(idx)} className="absolute top-2 right-2 text-red-600 opacity-0 group-hover:opacity-100"><XMarkIcon className="w-4 h-4" /></button><div className="space-y-2"><input value={item.name} onChange={(e) => updateReviewItem(idx, 'name', e.target.value)} className="w-full bg-transparent border-b font-bold" /><div className="flex gap-2"><input type="number" value={item.quantity} onChange={(e) => updateReviewItem(idx, 'quantity', parseInt(e.target.value))} className="w-1/2 bg-transparent border-b" /><input type="number" value={item.price} onChange={(e) => updateReviewItem(idx, 'price', parseFloat(e.target.value))} className="w-1/2 bg-transparent border-b" /></div><input value={item.expiryDate} onChange={(e) => updateReviewItem(idx, 'expiryDate', e.target.value)} className="w-full bg-transparent border-b text-xs" placeholder="Expiry" /></div></div>))}</div></div>
                        <div className="p-6 border-t bg-gray-50 dark:bg-gray-800 flex justify-end gap-3"><button onClick={() => setReviewItems([])} className="px-4 py-2 rounded hover:bg-gray-200">Cancel</button><button onClick={handleConfirmReview} className="px-6 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">Confirm All</button></div>
                    </div>
                </div>
            )}
            {editingItem && <EditItemModal item={editingItem} onClose={() => setEditingItem(null)} onSave={handleUpdateItem} />}
            {showAddItemModal && <AddItemModal onClose={() => setShowAddItemModal(false)} onAdd={handleManualAddItem} />}
            {bulkPromoContent && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"><div className="bg-white dark:bg-gray-800 p-6 rounded-xl max-w-sm"><h3 className="font-bold text-xl mb-4">Promo Ready!</h3><p className="bg-gray-100 p-4 rounded italic mb-4 text-black">{bulkPromoContent}</p><button onClick={() => setBulkPromoContent(null)} className="w-full bg-indigo-600 text-white py-2 rounded">Close</button></div></div>}
            {isGeneratingBulkPromo && <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"><div className="bg-white p-6 rounded-xl"><p>Generating Promo...</p></div></div>}
            {showSubscriptionModal && <SubscriptionModal onClose={() => setShowSubscriptionModal(false)} />}
        </main>
    );
};

export default InventoryManager;
