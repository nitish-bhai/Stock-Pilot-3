
import React, { useRef, useState, useEffect } from 'react';
import { CameraIcon, XMarkIcon } from './icons';

interface CameraCaptureProps {
    onCapture: (base64Image: string) => void;
    onClose: () => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let stream: MediaStream | null = null;

        const startCamera = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { facingMode: 'environment' } 
                });
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    setIsStreaming(true);
                }
                setError(''); // Clear any previous errors
            } catch (err) {
                console.error("Error accessing camera:", err);
                setError('Permission denied or camera unavailable.');
            }
        };

        startCamera();

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const handleCapture = () => {
        if (videoRef.current && canvasRef.current) {
            const context = canvasRef.current.getContext('2d');
            if (context) {
                canvasRef.current.width = videoRef.current.videoWidth;
                canvasRef.current.height = videoRef.current.videoHeight;
                context.drawImage(videoRef.current, 0, 0);
                const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
                // Remove data:image/jpeg;base64, prefix for the API
                const base64 = dataUrl.split(',')[1];
                onCapture(base64);
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
                onCapture(base64);
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden max-w-lg w-full relative shadow-2xl">
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 z-10 p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-70"
                >
                    <XMarkIcon className="w-6 h-6" />
                </button>

                <div className="relative aspect-[3/4] bg-black flex items-center justify-center overflow-hidden">
                    {error ? (
                        <div className="flex flex-col items-center justify-center h-full text-white p-6 text-center w-full">
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                                <CameraIcon className="w-8 h-8 text-red-500" />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">Camera Access Failed</h3>
                            <p className="mb-6 text-gray-400 text-sm max-w-xs mx-auto">{error} Please check your browser permissions or upload a photo instead.</p>
                            
                            <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-6 rounded-full shadow-lg transition-all transform active:scale-95 flex items-center gap-2">
                                <CameraIcon className="w-5 h-5" />
                                <span>Upload Image</span>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    onChange={handleFileUpload}
                                    className="hidden"
                                />
                            </label>
                        </div>
                    ) : (
                        <video 
                            ref={videoRef} 
                            autoPlay 
                            playsInline 
                            muted
                            className="w-full h-full object-cover"
                        />
                    )}
                    <canvas ref={canvasRef} className="hidden" />
                </div>

                {!error && (
                    <div className="p-6 flex justify-center gap-4 bg-white dark:bg-gray-800">
                        <button
                            onClick={handleCapture}
                            className="w-16 h-16 rounded-full border-4 border-indigo-600 flex items-center justify-center bg-white hover:bg-gray-100 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            aria-label="Take Photo"
                        >
                            <div className="w-12 h-12 rounded-full bg-indigo-600"></div>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CameraCapture;
