
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { CameraIcon, XMarkIcon, PhotoIcon, ArrowPathIcon, CheckIcon, VideoCameraIcon, StopIcon } from './icons';

interface CameraCaptureProps {
    onCapture: (data: string | string[]) => void;
    onClose: () => void;
    mode?: 'item' | 'invoice' | 'shelf-analysis';
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose, mode = 'item' }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<{ type: 'denied' | 'unavailable' | 'other'; message: string } | null>(null);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    
    // Walkthrough Mode State
    const [isWalkthroughMode, setIsWalkthroughMode] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [recordedFrames, setRecordedFrames] = useState<string[]>([]);
    const recordingIntervalRef = useRef<any>(null);

    // Automatically enable walkthrough mode for shelf analysis
    useEffect(() => {
        if (mode === 'shelf-analysis') {
            setIsWalkthroughMode(true);
        }
    }, [mode]);

    const startCamera = useCallback(async (deviceId?: string) => {
        setError(null);
        
        // Stop existing stream if any
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }

        try {
            // If a specific device ID is requested, use it. Otherwise default to environment (back camera).
            const constraints = deviceId 
                ? { video: { deviceId: { exact: deviceId } } } 
                : { video: { facingMode: 'environment' } };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                setIsStreaming(true);
            }

            // Once we have permission/stream, enumerate devices to get labels
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
            setDevices(videoDevices);

            // Set the selected device ID state
            if (deviceId) {
                setSelectedDeviceId(deviceId);
            } else {
                // If we let the browser choose, try to determine which one it picked
                const track = stream.getVideoTracks()[0];
                const settings = track.getSettings();
                if (settings.deviceId) {
                    setSelectedDeviceId(settings.deviceId);
                }
            }

        } catch (err: any) {
            console.error("Error accessing camera:", err);
            
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setError({
                    type: 'denied',
                    message: 'Camera access was denied.'
                });
            } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                setError({
                    type: 'unavailable',
                    message: 'No camera found on this device.'
                });
            } else {
                setError({
                    type: 'other',
                    message: 'Unable to access camera.'
                });
            }
        }
    }, []);

    useEffect(() => {
        if (!previewImage && recordedFrames.length === 0) {
            startCamera();
        } else {
             if (videoRef.current && videoRef.current.srcObject) {
                const stream = videoRef.current.srcObject as MediaStream;
                stream.getTracks().forEach(track => track.stop());
            }
        }

        return () => {
            if (videoRef.current && videoRef.current.srcObject) {
                const stream = videoRef.current.srcObject as MediaStream;
                stream.getTracks().forEach(track => track.stop());
            }
            if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        };
    }, [startCamera, previewImage, recordedFrames.length]);

    const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newDeviceId = e.target.value;
        setSelectedDeviceId(newDeviceId);
        startCamera(newDeviceId);
    };

    const captureFrame = (): string | null => {
        if (videoRef.current && canvasRef.current) {
            const context = canvasRef.current.getContext('2d');
            if (context) {
                canvasRef.current.width = videoRef.current.videoWidth;
                canvasRef.current.height = videoRef.current.videoHeight;
                context.drawImage(videoRef.current, 0, 0);
                const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.7); // Lower quality for performance
                return dataUrl.split(',')[1];
            }
        }
        return null;
    };

    const handleSingleCapture = () => {
        const base64 = captureFrame();
        if (base64) setPreviewImage(base64);
    };

    const toggleRecording = () => {
        if (isRecording) {
            // Stop Recording
            setIsRecording(false);
            if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        } else {
            // Start Recording
            setRecordedFrames([]);
            setIsRecording(true);
            
            // Capture first frame immediately
            const firstFrame = captureFrame();
            if (firstFrame) setRecordedFrames(prev => [...prev, firstFrame]);

            // Capture frame every 1.5 seconds
            recordingIntervalRef.current = setInterval(() => {
                const frame = captureFrame();
                if (frame) {
                    setRecordedFrames(prev => {
                        if (prev.length >= 10) { // Limit max frames
                             setIsRecording(false);
                             if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
                             return prev;
                        }
                        return [...prev, frame];
                    });
                }
            }, 1500);
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                const base64 = result.split(',')[1];
                setPreviewImage(base64);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRetake = () => {
        setPreviewImage(null);
        setRecordedFrames([]);
        setIsRecording(false);
    };

    const handleConfirm = () => {
        if (isWalkthroughMode && recordedFrames.length > 0) {
            onCapture(recordedFrames);
        } else if (previewImage) {
            onCapture(previewImage);
        }
    };

    const isReviewState = previewImage || (isWalkthroughMode && recordedFrames.length > 0 && !isRecording);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden max-w-lg w-full relative shadow-2xl flex flex-col max-h-[90vh]">
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 z-20 p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-70 transition-all"
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>

                <div className="relative flex-grow bg-black flex items-center justify-center overflow-hidden min-h-[300px]">
                    {previewImage ? (
                        <img 
                            src={`data:image/jpeg;base64,${previewImage}`} 
                            alt="Preview" 
                            className="w-full h-full object-contain"
                        />
                    ) : isWalkthroughMode && recordedFrames.length > 0 && !isRecording ? (
                         <div className="grid grid-cols-3 gap-1 w-full h-full overflow-y-auto p-1">
                             {recordedFrames.map((frame, idx) => (
                                 <img key={idx} src={`data:image/jpeg;base64,${frame}`} className="object-cover h-24 w-full rounded" />
                             ))}
                         </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-white p-6 text-center w-full overflow-y-auto">
                             {/* Error UI same as before */}
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4 flex-shrink-0">
                                <CameraIcon className="w-8 h-8 text-red-500" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">Camera Blocked</h3>
                            <p className="mb-6 text-gray-400 text-sm max-w-xs mx-auto">{error.message} Please try uploading a file instead.</p>
                            <div className="flex flex-col gap-3 w-full max-w-xs">
                                <button onClick={() => startCamera()} className="w-full py-3 px-4 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors border border-gray-600">Try Again</button>
                                <label className="w-full cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-lg shadow-lg transition-all flex items-center justify-center gap-2">
                                    <PhotoIcon className="w-5 h-5" />
                                    <span>Upload Photo Instead</span>
                                    <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                                </label>
                            </div>
                        </div>
                    ) : (
                        <>
                            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                            
                            {/* Recording Indicator */}
                            {isRecording && (
                                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-600 text-white px-3 py-1 rounded-full flex items-center gap-2 animate-pulse z-30">
                                    <div className="w-2 h-2 bg-white rounded-full"></div>
                                    <span className="text-xs font-bold">REC ({recordedFrames.length} frames)</span>
                                </div>
                            )}
                            
                            {isWalkthroughMode && !isRecording && (
                                <div className="absolute bottom-4 left-0 right-0 text-center text-white text-sm bg-black/50 py-2">
                                    Walk slowly to scan the whole shop
                                </div>
                            )}

                            {devices.length > 1 && (
                                <div className="absolute top-4 left-4 z-20">
                                    <div className="relative">
                                        <select 
                                            value={selectedDeviceId}
                                            onChange={handleDeviceChange}
                                            className="appearance-none bg-black bg-opacity-50 text-white border border-gray-500 rounded-lg py-2 pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 backdrop-blur-sm"
                                        >
                                            {devices.map((device, index) => (
                                                <option key={device.deviceId} value={device.deviceId}>
                                                    {device.label || `Camera ${index + 1}`}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    <canvas ref={canvasRef} className="hidden" />
                </div>

                {!error && (
                    <div className="p-6 flex justify-center items-center gap-8 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 min-h-[100px]">
                        {isReviewState ? (
                            <>
                                <button
                                    onClick={handleRetake}
                                    className="flex flex-col items-center gap-1 text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
                                >
                                    <div className="p-3 rounded-full bg-gray-200 dark:bg-gray-700">
                                        <ArrowPathIcon className="w-6 h-6" />
                                    </div>
                                    <span className="text-xs font-medium">Retake</span>
                                </button>

                                <button
                                    onClick={handleConfirm}
                                    className="flex flex-col items-center gap-1 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                                >
                                    <div className="p-4 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transform hover:scale-105 transition-all">
                                        <CheckIcon className="w-8 h-8" />
                                    </div>
                                    <span className="text-xs font-bold">Analyze</span>
                                </button>
                            </>
                        ) : (
                            <>
                                {!isWalkthroughMode ? (
                                    <>
                                         <label className="flex flex-col items-center gap-1 cursor-pointer text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
                                            <div className="p-3 rounded-full bg-gray-200 dark:bg-gray-700">
                                                <PhotoIcon className="w-6 h-6" />
                                            </div>
                                            <span className="text-xs font-medium">Upload</span>
                                            <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                                        </label>

                                        <button
                                            onClick={handleSingleCapture}
                                            className="w-16 h-16 rounded-full border-4 border-indigo-600 flex items-center justify-center bg-white hover:bg-gray-100 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 active:scale-95 shadow-lg"
                                            aria-label="Take Photo"
                                        >
                                            <div className="w-12 h-12 rounded-full bg-indigo-600"></div>
                                        </button>
                                        <div className="w-12"></div>
                                    </>
                                ) : (
                                    // Walkthrough Mode Controls
                                    <button
                                        onClick={toggleRecording}
                                        className={`w-16 h-16 rounded-full border-4 flex items-center justify-center transition-all focus:outline-none shadow-lg transform active:scale-95
                                            ${isRecording ? 'border-red-600 bg-white' : 'border-gray-300 bg-red-600'}
                                        `}
                                    >
                                        {isRecording ? (
                                            <div className="w-6 h-6 rounded-sm bg-red-600"></div>
                                        ) : (
                                            <VideoCameraIcon className="w-8 h-8 text-white" />
                                        )}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CameraCapture;
