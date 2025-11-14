
import React, { useEffect } from 'react';

interface ToastProps {
    message: string;
    onClose: () => void;
    linkHref?: string;
    linkText?: string;
}

const Toast: React.FC<ToastProps> = ({ message, onClose, linkHref, linkText }) => {
    useEffect(() => {
        if (message) {
            // Don't auto-dismiss if there's a link to click
            if (!linkHref) {
                 const timer = setTimeout(() => {
                    onClose();
                }, 4000); 
                return () => clearTimeout(timer);
            }
        }
    }, [message, onClose, linkHref]);

    if (!message) return null;

    return (
        <div 
            className="fixed top-5 right-5 z-50 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-6 py-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 animate-fade-in-down flex items-center justify-between gap-4"
            role="alert"
        >
            <style>
                {`
                    @keyframes fade-in-down {
                        0% {
                            opacity: 0;
                            transform: translateY(-10px);
                        }
                        100% {
                            opacity: 1;
                            transform: translateY(0);
                        }
                    }
                    .animate-fade-in-down {
                        animation: fade-in-down 0.5s ease-out forwards;
                    }
                `}
            </style>
            <p>{message}</p>
            {linkHref && linkText && (
                <a 
                    href={linkHref} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="ml-4 px-3 py-1 text-sm font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-800 focus:ring-indigo-500"
                >
                    {linkText}
                </a>
            )}
             <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-xl font-light">&times;</button>
        </div>
    );
};

export default Toast;