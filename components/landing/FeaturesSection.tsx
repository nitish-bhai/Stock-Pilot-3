
import React from 'react';
import { ChatIcon, ExpiryAlertIcon, SmartMatchIcon, SecureAuthIcon, CloudSyncIcon, InventoryIcon, CameraIcon, DocumentTextIcon, ChartBarIcon } from '../icons';
import { SiteFeature } from '../../types';

interface FeaturesSectionProps {
    features?: SiteFeature[];
}

const IconMap: Record<string, React.ReactNode> = {
    'SmartMatch': <SmartMatchIcon className="w-8 h-8 text-indigo-500" />,
    'Chat': <ChatIcon className="w-8 h-8 text-indigo-500" />,
    'Inventory': <InventoryIcon className="w-8 h-8 text-indigo-500" />,
    'Expiry': <ExpiryAlertIcon className="w-8 h-8 text-indigo-500" />,
    'Secure': <SecureAuthIcon className="w-8 h-8 text-indigo-500" />,
    'Cloud': <CloudSyncIcon className="w-8 h-8 text-indigo-500" />,
    'Camera': <CameraIcon className="w-8 h-8 text-indigo-500" />,
    'Invoice': <DocumentTextIcon className="w-8 h-8 text-indigo-500" />,
    'Analytics': <ChartBarIcon className="w-8 h-8 text-indigo-500" />
};

const FeaturesSection: React.FC<FeaturesSectionProps> = ({ features }) => {
    // Fallback features if none provided (though main logic handles this in siteConfigService)
    const displayFeatures = features || [];

    return (
        <section id="features" className="py-12 md:py-20 bg-gray-50 dark:bg-gray-800/50">
            <div className="container mx-auto px-4 sm:px-6">
                <div className="max-w-3xl mx-auto text-center pb-12 md:pb-16" data-aos="fade-up">
                    <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 dark:text-white">Everything You Need to Pilot Your Stock</h2>
                    <p className="text-lg text-gray-600 dark:text-gray-300 mt-4">
                        From intelligent matchmaking to automated AI analysis, Stock Pilot provides the tools to streamline your business operations.
                    </p>
                </div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {displayFeatures.map((feature, index) => (
                        <div key={index} className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300" data-aos="fade-up" data-aos-delay={100 * (index % 3)}>
                            <div className="flex items-center mb-4">
                                <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 dark:bg-indigo-900/50">
                                    {IconMap[feature.iconName] || IconMap['Inventory']}
                                </div>
                                <h4 className="text-xl font-bold ml-4 text-gray-900 dark:text-white">{feature.title}</h4>
                            </div>
                            <p className="text-gray-600 dark:text-gray-300">
                                {feature.description}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default FeaturesSection;
