
import React from 'react';
import { CheckIcon } from '../icons';

const plans = [
    {
        name: 'Vyapar Shuru (Free)',
        price: '₹0',
        period: '/ forever',
        description: 'Perfect for small shops starting their digital journey.',
        features: [
            'Up to 50 Inventory Items',
            'Basic Voice Commands',
            'Real-time Supplier Chat',
            'Manual Item Entry',
            'Single Photo Snap'
        ],
        cta: 'Start for Free',
        popular: false,
    },
    {
        name: 'Vyapar Pro',
        price: '₹299',
        period: '/ month',
        description: 'For serious shopkeepers who want to grow sales.',
        features: [
            'Unlimited Inventory Items',
            'AI Invoice Scanning (Paper to Digital)',
            'Shelf Doctor (Visual Merchandising)',
            'WhatsApp Promo Generator',
            '360° Shop Walkthrough Analysis',
            'Priority Support'
        ],
        cta: 'Upgrade to Pro',
        popular: true,
    },
];

const PricingSection: React.FC = () => {
    return (
        <section id="pricing" className="py-16 md:py-24 bg-white dark:bg-gray-900">
            <div className="container mx-auto px-4 sm:px-6">
                <div className="text-center max-w-3xl mx-auto mb-16" data-aos="fade-up">
                    <h2 className="text-3xl md:text-4xl font-extrabold text-gray-900 dark:text-white">
                        Simple Pricing. <span className="text-indigo-600">Maximum Profit.</span>
                    </h2>
                    <p className="text-lg text-gray-600 dark:text-gray-300 mt-4">
                        Cost less than a daily chai ☕. Recover the investment with a single optimized sale.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
                    {plans.map((plan, index) => (
                        <div 
                            key={index} 
                            className={`relative p-8 rounded-2xl border ${plan.popular ? 'border-indigo-600 shadow-xl ring-2 ring-indigo-600 dark:ring-indigo-500' : 'border-gray-200 dark:border-gray-700 shadow-lg'} bg-white dark:bg-gray-800 flex flex-col`}
                            data-aos="fade-up"
                            data-aos-delay={index * 100}
                        >
                            {plan.popular && (
                                <div className="absolute top-0 right-0 -mt-4 mr-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                                    Best Value
                                </div>
                            )}
                            <div className="mb-4">
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">{plan.name}</h3>
                                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{plan.description}</p>
                            </div>
                            <div className="mb-6">
                                <span className="text-4xl font-extrabold text-gray-900 dark:text-white">{plan.price}</span>
                                <span className="text-gray-500 dark:text-gray-400 font-medium">{plan.period}</span>
                            </div>
                            <ul className="mb-8 space-y-4 flex-1">
                                {plan.features.map((feature, i) => (
                                    <li key={i} className="flex items-start">
                                        <div className="flex-shrink-0 p-1 bg-green-100 dark:bg-green-900 rounded-full mr-3">
                                            <CheckIcon className="w-3 h-3 text-green-600 dark:text-green-400" />
                                        </div>
                                        <span className="text-gray-600 dark:text-gray-300 text-sm">{feature}</span>
                                    </li>
                                ))}
                            </ul>
                            <button className={`w-full py-3 px-6 rounded-lg font-bold transition-all duration-200 ${plan.popular 
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg hover:shadow-xl' 
                                : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-white'}`}>
                                {plan.cta}
                            </button>
                        </div>
                    ))}
                </div>
                
                <div className="mt-12 text-center">
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                        Prices inclusive of GST. Cancel anytime. 
                        <span className="block mt-2 text-indigo-600 dark:text-indigo-400 font-medium">Made with ❤️ for India 🇮🇳</span>
                    </p>
                </div>
            </div>
        </section>
    );
};

export default PricingSection;
