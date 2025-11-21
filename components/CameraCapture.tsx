
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { CameraIcon, XMarkIcon, PhotoIcon, ArrowPathIcon, CheckIcon } from './icons';

interface CameraCaptureProps {
    onCapture: (base64Image: string) => void;
    onClose: () => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<{ type: 'denied' | 'unavailable' | 'other'; message: string } | null>(null);
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

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
        if (!previewImage) {
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
        };
    }, [startCamera, previewImage]);

    const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newDeviceId = e.target.value;
        setSelectedDeviceId(newDeviceId);
        startCamera(newDeviceId);
    };

    const handleCapture = () => {
        if (videoRef.current && canvasRef.current) {
            const context = canvasRef.current.getContext('2d');
            if (context) {
                canvasRef.current.width = videoRef.current.videoWidth;
                canvasRef.current.height = videoRef.current.videoHeight;
                context.drawImage(videoRef.current, 0, 0);
                const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
                const base64 = dataUrl.split(',')[1];
                setPreviewImage(base64);
            }
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
    };

    const handleConfirm = () => {
        if (previewImage) {
            onCapture(previewImage);
        }
    };

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
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-white p-6 text-center w-full overflow-y-auto">
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4 flex-shrink-0">
                                <CameraIcon className="w-8 h-8 text-red-500" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">Camera Blocked</h3>
                            
                            {error.type === 'denied' ? (
                                <div className="bg-gray-800 p-4 rounded-lg text-sm text-left mb-6 w-full max-w-xs">
                                    <p className="mb-2 font-semibold text-yellow-400">How to fix:</p>
                                    <ol className="list-decimal list-inside space-y-2 text-gray-300">
                                        <li>Tap the <span className="font-bold text-white">Lock Icon 🔒</span> in your browser's address bar.</li>
                                        <li>Tap <span className="font-bold text-white">Permissions</span> or <span className="font-bold text-white">Site Settings</span>.</li>
                                        <li>Find <strong>Camera</strong> and select <span className="text-green-400 font-bold">Allow</span> or <span className="text-green-400 font-bold">Reset</span>.</li>
                                        <li>Refresh the page.</li>
                                    </ol>
                                </div>
                            ) : (
                                <p className="mb-6 text-gray-400 text-sm max-w-xs mx-auto">{error.message} Please try uploading a file instead.</p>
                            )}
                            
                            <div className="flex flex-col gap-3 w-full max-w-xs">
                                <button 
                                    onClick={() => startCamera()}
                                    className="w-full py-3 px-4 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors border border-gray-600"
                                >
                                    Try Again
                                </button>
                                <label className="w-full cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-lg shadow-lg transition-all flex items-center justify-center gap-2">
                                    <PhotoIcon className="w-5 h-5" />
                                    <span>Upload Photo Instead</span>
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        onChange={handleFileUpload}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                        </div>
                    ) : (
                        <>
                            <video 
                                ref={videoRef} 
                                autoPlay 
                                playsInline 
                                muted
                                className="w-full h-full object-cover"
                            />
                            
                            {/* Camera Selection Dropdown */}
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
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-300">
                                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    <canvas ref={canvasRef} className="hidden" />
                </div>

                {!error && (
                    <div className="p-6 flex justify-center items-center gap-8 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 min-h-[100px]">
                        {previewImage ? (
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
                                <label className="flex flex-col items-center gap-1 cursor-pointer text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
                                    <div className="p-3 rounded-full bg-gray-200 dark:bg-gray-700">
                                        <PhotoIcon className="w-6 h-6" />
                                    </div>
                                    <span className="text-xs font-medium">Upload</span>
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        onChange={handleFileUpload}
                                        className="hidden"
                                    />
                                </label>

                                <button
                                    onClick={handleCapture}
                                    className="w-16 h-16 rounded-full border-4 border-indigo-600 flex items-center justify-center bg-white hover:bg-gray-100 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 active:scale-95 shadow-lg"
                                    aria-label="Take Photo"
                                >
                                    <div className="w-12 h-12 rounded-full bg-indigo-600"></div>
                                </button>

                                {/* Spacer to balance layout */}
                                <div className="w-12"></div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CameraCapture;
