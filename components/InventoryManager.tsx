
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { LiveSession, LiveServerMessage, Modality, Blob as GenaiBlob, FunctionCall } from '@google/genai';
import { INITIATE_ADD_ITEM_TOOL, PROVIDE_ITEM_QUANTITY_TOOL, PROVIDE_ITEM_PRICE_TOOL, REMOVE_ITEM_TOOL, QUERY_INVENTORY_TOOL, PROVIDE_ITEM_EXPIRY_DATE_TOOL } from '../constants';
import { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import InventoryTable from './InventoryTable';
import MicButton from './MicButton';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { getAi } from '../services/geminiService';
import { addOrUpdateItem, removeItem } from '../services/inventoryService';
import { getChatsStream } from '../services/chatService';
import { LogoutIcon, SearchIcon, ChatIcon } from './icons';
import { InventoryItem, Chat, UserProfile } from '../types';
import { ChatParams } from '../App';
import ChatListModal from './ChatListModal';

type AwaitingPriceInfo = { itemName: string; quantity: number };
type AwaitingQuantityInfo = { itemName: string };
type AwaitingExpiryInfo = { itemName: string; quantity: number; price: number };

interface InventoryManagerProps {
    onNavigateToChat: (params: ChatParams) => void;
}

const InventoryManager: React.FC<InventoryManagerProps> = ({ onNavigateToChat }) => {
    const { user, userProfile, logOut } = useAuth();
    const { inventory, loading: inventoryLoading } = useInventory();
    
    const [isListening, setIsListening] = useState(false);
    const [isGreeting, setIsGreeting] = useState(false);
    const [statusText, setStatusText] = useState("Tap the mic to manage your stock with Stock Pilot.");
    const [searchTerm, setSearchTerm] = useState('');
    const [expiringItems, setExpiringItems] = useState<InventoryItem[]>([]);
    const [isChatModalOpen, setIsChatModalOpen] = useState(false);
    const [totalUnreadCount, setTotalUnreadCount] = useState(0);

    const awaitingPriceInfoRef = useRef<AwaitingPriceInfo | null>(null);
    const awaitingQuantityInfoRef = useRef<AwaitingQuantityInfo | null>(null);
    const awaitingExpiryInfoRef = useRef<AwaitingExpiryInfo | null>(null);

    const sessionRef = useRef<Promise<LiveSession> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const isSessionActiveRef = useRef(false);
    const audioPlaybackTimeRef = useRef(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const greetingAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    
    // Listen for chat notifications
    useEffect(() => {
        if (!user) return;
        const unsubscribe = getChatsStream(user.uid, (chats: Chat[]) => {
            const unreadSum = chats.reduce((sum, chat) => sum + (chat.unreadCount[user.uid] || 0), 0);
            setTotalUnreadCount(unreadSum);
        });
        return () => unsubscribe();
    }, [user]);

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

                    if (needsExpiry) {
                        awaitingExpiryInfoRef.current = { itemName, quantity, price };
                        result = { success: true, message: `The price is set. Now, what is the expiry date? Please provide it in YYYY-MM-DD format.` };
                    } else {
                        await addOrUpdateItem(user.uid, itemName, quantity, price);
                        result = { success: true, message: `Great, I've added ${quantity} ${itemName} to your inventory.` };
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
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
                        result = { success: false, message: "That doesn't look like a valid date format. Please provide it in YYYY-MM-DD format." };
                    } else {
                        await addOrUpdateItem(user.uid, itemName, quantity, price, expiryDate);
                        result = { success: true, message: `Got it. I've added ${quantity} ${itemName} with an expiry date of ${expiryDate}.` };
                        awaitingExpiryInfoRef.current = null;
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
        }

        session.sendToolResponse({
            functionResponses: {
                id: fc.id,
                name: fc.name,
                response: { result: result.message },
            }
        });
    }, [user, userProfile, inventory]);
    
    const stopSession = useCallback(() => {
        if (!isSessionActiveRef.current) return;
        isSessionActiveRef.current = false;
    
        if (greetingAudioSourceRef.current) {
            greetingAudioSourceRef.current.stop();
            greetingAudioSourceRef.current = null;
        }

        setIsListening(false);
        setIsGreeting(false);
        setStatusText("Tap the mic to manage your stock with Stock Pilot.");

        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        
        if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
            inputAudioContextRef.current.close().catch(e => console.error("Error closing input audio context:", e));
            inputAudioContextRef.current = null;
        }

        if (outputAudioContextRef.current) {
            audioSourcesRef.current.forEach(source => source.stop());
            audioSourcesRef.current.clear();
            if (outputAudioContextRef.current.state !== 'closed') {
                outputAudioContextRef.current.close().catch(e => console.error("Error closing output audio context:", e));
                outputAudioContextRef.current = null;
            }
        }

        if (sessionRef.current) {
            sessionRef.current.then(session => session.close()).catch(e => console.error("Error closing session:", e));
            sessionRef.current = null;
        }
        
        awaitingPriceInfoRef.current = null;
        awaitingQuantityInfoRef.current = null;
        awaitingExpiryInfoRef.current = null;
    }, []);

    const startListeningSession = async () => {
        if (!process.env.API_KEY || !user || !userProfile?.categories || !isSessionActiveRef.current) return;
        
        setIsListening(true);
        setStatusText("Connecting...");
        
        if (!inputAudioContextRef.current || inputAudioContextRef.current.state === 'closed') {
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        }
       
        try {
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            console.error("Microphone access denied:", error);
            setStatusText("Microphone access is required.");
            stopSession();
            return;
        }
        
        const ai = getAi();
        const userCategories = userProfile.categories;
        const needsExpiry = userCategories.some(cat => ['medical', 'grocery', 'sweets'].includes(cat));
        const systemInstruction = `You are a voice-first inventory assistant for a store with categories: ${userCategories.join(', ')}.
- You must only accept items that are relevant for these categories. If a user tries to add something irrelevant, politely decline.
- To add an item: Use 'initiateAddItem'. If the user doesn't say how many, the system will ask. Once you know the quantity, you must ask for the price.
- ${needsExpiry ? "For this store type, items may have an expiry date. After getting the price, you MUST ask for the expiry date and get it in YYYY-MM-DD format." : "For this store type, items DO NOT have an expiry date, so DO NOT ask for one."}
- To remove an item: Use 'removeItem'.
- To answer questions: Use 'queryInventory' and then answer based on the provided inventory context.
Keep responses brief and conversational. Current inventory is: ${JSON.stringify(inventory.slice(0, 50))}`;

        sessionRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            config: {
                systemInstruction,
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                tools: [{ functionDeclarations: [INITIATE_ADD_ITEM_TOOL, PROVIDE_ITEM_QUANTITY_TOOL, PROVIDE_ITEM_PRICE_TOOL, REMOVE_ITEM_TOOL, QUERY_INVENTORY_TOOL, PROVIDE_ITEM_EXPIRY_DATE_TOOL] }]
            },
            callbacks: {
                onopen: () => {
                    setStatusText("Listening... Say something.");
                    if (!inputAudioContextRef.current || !mediaStreamRef.current) return;

                    const source = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
                    scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);

                    scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const l = inputData.length;
                        const int16 = new Int16Array(l);
                        for (let i = 0; i < l; i++) {
                            int16[i] = inputData[i] * 32768;
                        }
                        const pcmBlob: GenaiBlob = {
                            data: encode(new Uint8Array(int16.buffer)),
                            mimeType: 'audio/pcm;rate=16000',
                        };
                        sessionRef.current?.then((session) => {
                            if (isSessionActiveRef.current) {
                                session.sendRealtimeInput({ media: pcmBlob });
                            }
                        });
                    };

                    source.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
                        const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
                        if (outputAudioContextRef.current) {
                            audioPlaybackTimeRef.current = Math.max(audioPlaybackTimeRef.current, outputAudioContextRef.current.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current, 24000, 1);
                            const source = outputAudioContextRef.current.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputAudioContextRef.current.destination);
                            
                            source.addEventListener('ended', () => {
                                audioSourcesRef.current.delete(source);
                            });

                            source.start(audioPlaybackTimeRef.current);
                            audioPlaybackTimeRef.current += audioBuffer.duration;
                            audioSourcesRef.current.add(source);
                        }
                    }

                    if (message.toolCall?.functionCalls) {
                        const session = await sessionRef.current;
                        if (session) {
                            for (const fc of message.toolCall.functionCalls) {
                                handleToolCall(fc, session);
                            }
                        }
                    }

                    if (message.serverContent?.outputTranscription?.text) {
                        setStatusText(`Gemini: "${message.serverContent.outputTranscription.text}"`);
                    } else if (message.serverContent?.inputTranscription?.text) {
                         setStatusText(`You: "${message.serverContent.inputTranscription.text}"`);
                    }

                    if (message.serverContent?.interrupted) {
                         audioSourcesRef.current.forEach(source => source.stop());
                         audioSourcesRef.current.clear();
                         audioPlaybackTimeRef.current = 0;
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error("Session error:", e);
                    setStatusText("An error occurred. Please try again.");
                    stopSession();
                },
                onclose: () => {
                    if (isSessionActiveRef.current) {
                        stopSession();
                    }
                },
            },
        });
    };

    const startAndGreetSession = async () => {
        if (!process.env.API_KEY || !user) return;
        
        isSessionActiveRef.current = true;
        setIsGreeting(true);
        setStatusText("Assistant is speaking...");

        if (!outputAudioContextRef.current || outputAudioContextRef.current.state === 'closed') {
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const outputCtx = outputAudioContextRef.current;
        audioPlaybackTimeRef.current = outputCtx.currentTime;

        try {
            const ai = getAi();
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: 'Say cheerfully: Hello, how can I help you?' }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) throw new Error("TTS response was empty.");

            const audioBuffer = await decodeAudioData(decode(base64Audio), outputCtx, 24000, 1);
            const source = outputCtx.createBufferSource();
            greetingAudioSourceRef.current = source;
            source.buffer = audioBuffer;
            source.connect(outputCtx.destination);
            
            source.onended = () => {
                greetingAudioSourceRef.current = null;
                if (isSessionActiveRef.current) {
                    setIsGreeting(false);
                    startListeningSession();
                }
            };
            source.start();

        } catch (error) {
            console.error("Failed to play greeting:", error);
            setStatusText("Error starting. Tap mic to try again.");
            stopSession();
        }
    };
    
    useEffect(() => {
        if (inventory.length > 0) {
            const now = new Date();
            const tenDaysFromNow = new Date();
            tenDaysFromNow.setDate(now.getDate() + 10);

            const expiring = inventory.filter(item => {
                if (!item.expiryDate) return false;
                const expiry = new Date(item.expiryDate);
                return expiry >= now && expiry <= tenDaysFromNow;
            });
            setExpiringItems(expiring);
        }
    }, [inventory]);

    const handleMicClick = () => {
        if (isListening || isGreeting) {
            stopSession();
        } else {
            startAndGreetSession();
        }
    };

    const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(event.target.value);
    };

    const filteredInventory = inventory.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const totalItems = inventory.reduce((sum, item) => sum + item.quantity, 0);
    const totalValue = inventory.reduce((sum, item) => sum + item.quantity * item.price, 0);
    
    useEffect(() => {
        return () => stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            <main className="container mx-auto p-4 md:p-8">
                <header className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white text-center md:text-left">Stock Pilot</h1>
                        <p className="text-gray-500 dark:text-gray-400 text-center md:text-left">by SoundSync | Welcome, {userProfile?.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                <SearchIcon className="w-5 h-5 text-gray-400" />
                            </span>
                            <input
                                type="text"
                                placeholder="Search inventory..."
                                value={searchTerm}
                                onChange={handleSearchChange}
                                className="w-full md:w-48 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-md py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <button onClick={() => setIsChatModalOpen(true)} title="Chats" className="relative p-3 text-sm font-medium text-gray-500 dark:text-white bg-gray-200 dark:bg-gray-700 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                            <ChatIcon className="w-5 h-5" />
                            {totalUnreadCount > 0 && (
                                <span className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white ring-2 ring-white dark:ring-gray-700">
                                    {totalUnreadCount}
                                </span>
                            )}
                        </button>
                        <MicButton isListening={isListening || isGreeting} onClick={handleMicClick} />
                        <button onClick={logOut} title="Logout" className="p-3 text-sm font-medium text-gray-500 dark:text-white bg-gray-200 dark:bg-gray-700 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                            <LogoutIcon className="w-5 h-5" />
                        </button>
                    </div>
                </header>

                <div className="text-center mb-4">
                    <p className="text-gray-600 dark:text-gray-300 h-5 transition-opacity duration-300">{statusText}</p>
                </div>

                {expiringItems.length > 0 && (
                     <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 dark:bg-yellow-900/50 dark:border-yellow-600 dark:text-yellow-300 px-4 py-3 rounded-lg relative mb-4" role="alert">
                        <strong className="font-bold">Expiry Alert!</strong>
                        <span className="block sm:inline ml-2">
                            {expiringItems.length} item(s) are expiring within 10 days.
                        </span>
                        <ul className="list-disc list-inside mt-2 text-sm">
                            {expiringItems.map(item => (
                                <li key={item.id} className="capitalize">{item.name} (Expires on: {item.expiryDate})</li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="mb-8">
                    <InventoryTable 
                        items={filteredInventory} 
                        loading={inventoryLoading} 
                        totalItems={totalItems} 
                        totalValue={totalValue}
                        expiringItems={expiringItems}
                        onStartChat={() => setIsChatModalOpen(true)} // Re-route chat button to modal
                    />
                </div>
            </main>
            {isChatModalOpen && userProfile && (
                <ChatListModal 
                    currentUserProfile={userProfile}
                    onClose={() => setIsChatModalOpen(false)}
                    onNavigateToChat={onNavigateToChat}
                />
            )}
        </>
    );
};

export default InventoryManager;
