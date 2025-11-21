
import React from 'react';
import { SiteConfig } from '../../types';

interface HeroSectionProps {
    onGetStartedClick: () => void;
    config?: SiteConfig['hero'];
}

const HeroSection: React.FC<HeroSectionProps> = ({ onGetStartedClick, config }) => {
    const title = config?.title || 'Smart Inventory,\nSeamless Connections.';
    const subtitle = config?.subtitle || 'Stock Pilot is the all-in-one platform that connects sellers with suppliers and automates inventory management with voice commands, expiry alerts, and real-time chat.';
    const bgImage = config?.imageUrl || 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1470&q=80';

    return (
        <section id="hero" className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden">
            {/* Background Image with Overlay */}
            <div className="absolute inset-0 z-0">
                <img 
                    src={bgImage} 
                    alt="Warehouse Background" 
                    className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-white/90 via-white/80 to-white dark:from-gray-900/90 dark:via-gray-900/80 dark:to-gray-900"></div>
            </div>

            <div className="container mx-auto px-4 sm:px-6 relative z-10">
                <div className="text-center">
                    <h1 className="text-4xl md:text-6xl font-extrabold leading-tighter tracking-tighter mb-4 text-gray-900 dark:text-white whitespace-pre-line" data-aos="zoom-y-out">
                        {title}
                    </h1>
                    <div className="max-w-3xl mx-auto">
                        <p className="text-lg md:text-xl text-gray-700 dark:text-gray-200 mb-8 font-medium" data-aos="zoom-y-out" data-aos-delay="150">
                            {subtitle}
                        </p>
                        <div className="max-w-xs mx-auto sm:max-w-none sm:flex sm:justify-center" data-aos="zoom-y-out" data-aos-delay="300">
                            <button
                                onClick={onGetStartedClick}
                                className="w-full sm:w-auto px-8 py-3 text-white bg-indigo-600 rounded-full hover:bg-indigo-700 shadow-lg transition duration-150 ease-in-out font-bold text-lg transform hover:scale-105"
                            >
                                Get Started
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HeroSection;
