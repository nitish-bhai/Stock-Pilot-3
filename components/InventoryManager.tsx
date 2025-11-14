import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob as GenaiBlob, FunctionCall } from '@google/genai';
import { INITIATE_ADD_ITEM_TOOL, PROVIDE_ITEM_QUANTITY_TOOL, PROVIDE_ITEM_PRICE_TOOL, REMOVE_ITEM_TOOL, QUERY_INVENTORY_TOOL } from '../constants';
import { useAuth } from '../hooks/useAuth';
import { useInventory } from '../hooks/useInventory';
import InventoryTable from './InventoryTable';
import MicButton from './MicButton';
import { encode, decode, decodeAudioData } from '../utils/audioUtils';
import { getAi } from '../services/geminiService';
import { addOrUpdateItem, removeItem } from '../services/inventoryService';
import { LogoutIcon, SearchIcon } from './icons';

type AwaitingPriceInfo = {
    itemName: string;
    quantity: number;
};

type AwaitingQuantityInfo = {
    itemName: string;
};

const InventoryManager: React.FC = () => {
    const { user, logOut } = useAuth();
    const { inventory, loading: inventoryLoading } = useInventory();
    
    const [isListening, setIsListening] = useState(false);
    const [statusText, setStatusText] = useState("Tap the mic to manage your stock with Stock Pilot.");
    const [searchTerm, setSearchTerm] = useState('');

    const awaitingPriceInfoRef = useRef<AwaitingPriceInfo | null>(null);
    const awaitingQuantityInfoRef = useRef<AwaitingQuantityInfo | null>(null);
    const sessionRef = useRef<Promise<LiveSession> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const isSessionActiveRef = useRef(false);
    const audioPlaybackTimeRef = useRef(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    
    const handleToolCall = useCallback(async (fc: FunctionCall, session: LiveSession): Promise<void> => {
        if (!user) return;
        let result: any = { success: false, message: "Sorry, I couldn't do that." };

        console.log("Function call received:", fc.name, fc.args);

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
            case 'provideItemPrice':
                if (awaitingPriceInfoRef.current) {
                    const { itemName, quantity } = awaitingPriceInfoRef.current;
                    const { price } = fc.args;
                    await addOrUpdateItem(user.uid, itemName, quantity, price);
                    result = { success: true, message: `Great, I've added ${quantity} ${itemName} to your inventory.` };
                    awaitingPriceInfoRef.current = null;
                } else {
                    result = { success: false, message: "I'm sorry, I don't know which item you're providing the price for. Let's start over." };
                }
                break;
            case 'removeItem':
                const removeResult = await removeItem(user.uid, fc.args.itemName, fc.args.quantity);
                result = { success: removeResult.success, message: removeResult.message };
                break;
            case 'queryInventory':
                result = { success: true, message: "Query acknowledged. Proceed with your answer." };
                break;
            default:
                break;
        }

        session.sendToolResponse({
            functionResponses: {
                id: fc.id,
                name: fc.name,
                response: { result: result.message },
            }
        });
    }, [user]);
    
    const stopSession = useCallback(() => {
        if (!isSessionActiveRef.current) return;
        isSessionActiveRef.current = false;

        setIsListening(false);
        setStatusText("Tap the mic to manage your stock with Stock Pilot.");
        
        sessionRef.current?.then(session => session.close());
        sessionRef.current = null;
        
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        
        scriptProcessorRef.current?.disconnect();
        scriptProcessorRef.current = null;
        
        inputAudioContextRef.current?.close().catch(console.error);
        inputAudioContextRef.current = null;

        audioSourcesRef.current.forEach(source => source.stop());
        audioSourcesRef.current.clear();
        outputAudioContextRef.current?.close().catch(console.error);
        outputAudioContextRef.current = null;
        audioPlaybackTimeRef.current = 0;
        
        awaitingPriceInfoRef.current = null;
        awaitingQuantityInfoRef.current = null;
    }, []);

    const startSession = async () => {
        if (!process.env.API_KEY || !user) return;
        
        isSessionActiveRef.current = true;
        setIsListening(true);
        setStatusText("Connecting...");

        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        audioPlaybackTimeRef.current = outputAudioContextRef.current.currentTime;

        try {
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
            console.error("Microphone access denied:", error);
            setStatusText("Microphone access is required.");
            stopSession();
            return;
        }
        
        const ai = getAi();
        const systemInstruction = `You are a voice-first inventory assistant. You can understand and respond in both English and Hindi.
- To add an item: Use 'initiateAddItem'. If the user doesn't say how many, the system will ask. Once you know the quantity, you must ask for the price. Use 'provideItemPrice' when the user gives a price.
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
                tools: [{ functionDeclarations: [INITIATE_ADD_ITEM_TOOL, PROVIDE_ITEM_QUANTITY_TOOL, PROVIDE_ITEM_PRICE_TOOL, REMOVE_ITEM_TOOL, QUERY_INVENTORY_TOOL] }]
            },
            callbacks: {
                onopen: async () => {
                    setStatusText("Listening...");
                    const session = await sessionRef.current;
                    if (!session) return;
                    session.sendRealtimeInput({ text: "Hello sir, how can I help you?" });

                    const source = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current!);
                    scriptProcessorRef.current = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                    scriptProcessorRef.current.onaudioprocess = (event) => {
                        if (!isSessionActiveRef.current) return;
                        const inputData = event.inputBuffer.getChannelData(0);
                        const int16 = new Int16Array(inputData.length);
                        for (let i = 0; i < inputData.length; i++) {
                            int16[i] = inputData[i] * 32767;
                        }
                        const pcmBlob: GenaiBlob = {
                            data: encode(new Uint8Array(int16.buffer)),
                            mimeType: 'audio/pcm;rate=16000',
                        };
                        sessionRef.current?.then(s => s.sendRealtimeInput({ media: pcmBlob }));
                    };
                    source.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(inputAudioContextRef.current!.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (!isSessionActiveRef.current) return;

                    if (message.serverContent?.outputTranscription) {
                        setStatusText(prev => prev + message.serverContent.outputTranscription.text);
                    }

                    if(message.serverContent?.turnComplete && message.serverContent?.outputTranscription?.text) {
                        setStatusText(message.serverContent.outputTranscription.text)
                    } else if (message.serverContent?.turnComplete) {
                        // Reset if there was no text in this turn.
                    }


                    if (message.toolCall) {
                        const session = await sessionRef.current;
                        if(session){
                            for (const fc of message.toolCall.functionCalls) {
                                await handleToolCall(fc, session);
                            }
                        }
                    }

                    const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                    if (base64Audio) {
                        const audioContext = outputAudioContextRef.current;
                        if (!audioContext) return;

                        const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                        
                        const now = audioContext.currentTime;
                        if (audioPlaybackTimeRef.current < now) {
                            audioPlaybackTimeRef.current = now;
                        }

                        const source = audioContext.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(audioContext.destination);
                        source.onended = () => audioSourcesRef.current.delete(source);
                        source.start(audioPlaybackTimeRef.current);
                        
                        audioPlaybackTimeRef.current += audioBuffer.duration;
                        audioSourcesRef.current.add(source);
                    }
                },
                onclose: () => console.log('Session closed'),
                onerror: (e) => {
                    console.error('Session error:', e);
                    setStatusText("An error occurred. Please try again.");
                    stopSession();
                },
            },
        });
    };

    const handleMicClick = () => {
        if (isListening) {
            stopSession();
        } else {
            startSession();
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
        <main className="container mx-auto p-4 md:p-8">
            <header className="flex flex-col md:flex-row justify-between items-center mb-4 gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-bold text-white text-center md:text-left">Stock Pilot</h1>
                    <p className="text-gray-400 text-center md:text-left">by SoundSync | Welcome, {user?.email}</p>
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
                            className="w-full md:w-48 bg-gray-700 text-white rounded-md py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <MicButton isListening={isListening} onClick={handleMicClick} />
                    <button onClick={logOut} title="Logout" className="p-3 text-sm font-medium text-white bg-gray-700 rounded-full hover:bg-gray-600 transition-colors">
                        <LogoutIcon className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <div className="text-center mb-4">
                <p className="text-gray-300 h-5 transition-opacity duration-300">{statusText}</p>
            </div>

            <div className="mb-8">
                <InventoryTable 
                    items={filteredInventory} 
                    loading={inventoryLoading} 
                    totalItems={totalItems} 
                    totalValue={totalValue} 
                />
            </div>
        </main>
    );
};

export default InventoryManager;