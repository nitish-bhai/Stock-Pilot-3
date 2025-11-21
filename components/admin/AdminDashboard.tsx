
import React, { useState, useEffect } from 'react';
import { getSiteConfig, updateSiteConfig, getAppStats } from '../../services/siteConfigService';
import { SiteConfig, SiteFeature, Testimonial, FAQ } from '../../types';
import { LogoutIcon, ChartBarIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '../icons';
import Toast from '../Toast';

interface AdminDashboardProps {
    onLogout: () => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
    const [config, setConfig] = useState<SiteConfig | null>(null);
    const [stats, setStats] = useState<{ sellers: number; suppliers: number } | null>(null);
    const [activeTab, setActiveTab] = useState<'stats' | 'hero' | 'features' | 'testimonials' | 'faq'>('stats');
    const [toastMessage, setToastMessage] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchData = async () => {
            const conf = await getSiteConfig();
            setConfig(conf);
            const appStats = await getAppStats();
            setStats(appStats);
        };
        fetchData();
    }, []);

    const handleSave = async () => {
        if (!config) return;
        setSaving(true);
        try {
            await updateSiteConfig(config);
            setToastMessage('Changes saved successfully!');
        } catch (error) {
            setToastMessage('Failed to save changes.');
        } finally {
            setSaving(false);
        }
    };

    const updateConfig = (key: keyof SiteConfig, value: any) => {
        if (!config) return;
        setConfig({ ...config, [key]: value });
    };

    const handleFeatureChange = (index: number, field: keyof SiteFeature, value: string) => {
        if (!config) return;
        const newFeatures = [...config.features];
        newFeatures[index] = { ...newFeatures[index], [field]: value };
        updateConfig('features', newFeatures);
    };

    if (!config) return <div className="min-h-screen flex items-center justify-center text-white">Loading Admin Panel...</div>;

    return (
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
            <Toast message={toastMessage} onClose={() => setToastMessage('')} />
            
            {/* Admin Header */}
            <header className="bg-indigo-700 text-white p-4 shadow-lg">
                <div className="container mx-auto flex justify-between items-center">
                    <h1 className="text-xl font-bold flex items-center gap-2">
                        <PencilSquareIcon className="w-6 h-6" />
                        Stock Pilot Admin
                    </h1>
                    <button onClick={onLogout} className="flex items-center gap-2 bg-indigo-800 hover:bg-indigo-900 px-4 py-2 rounded-lg transition-colors">
                        <LogoutIcon className="w-5 h-5" />
                        Exit
                    </button>
                </div>
            </header>

            <div className="container mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Sidebar Nav */}
                <nav className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 h-fit">
                    <ul className="space-y-2">
                        {[
                            { id: 'stats', label: 'Dashboard Stats' },
                            { id: 'hero', label: 'Hero Section' },
                            { id: 'features', label: 'Features' },
                            { id: 'testimonials', label: 'Testimonials' },
                            { id: 'faq', label: 'FAQs' }
                        ].map(tab => (
                            <li key={tab.id}>
                                <button 
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === tab.id ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                                >
                                    {tab.label}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                         <button 
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-md transition-all active:scale-95 disabled:opacity-50"
                         >
                             {saving ? 'Saving...' : 'Save All Changes'}
                         </button>
                    </div>
                </nav>

                {/* Main Content */}
                <main className="lg:col-span-3 bg-white dark:bg-gray-800 rounded-lg shadow p-6 md:p-8">
                    
                    {activeTab === 'stats' && stats && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Platform Overview</h2>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-xl border border-blue-100 dark:border-blue-800">
                                    <p className="text-blue-600 dark:text-blue-400 font-medium uppercase text-xs">Total Users</p>
                                    <p className="text-4xl font-bold text-gray-900 dark:text-white mt-2">{stats.sellers + stats.suppliers}</p>
                                </div>
                                <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-xl border border-green-100 dark:border-green-800">
                                    <p className="text-green-600 dark:text-green-400 font-medium uppercase text-xs">Active Sellers</p>
                                    <p className="text-4xl font-bold text-gray-900 dark:text-white mt-2">{stats.sellers}</p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-900/20 p-6 rounded-xl border border-purple-100 dark:border-purple-800">
                                    <p className="text-purple-600 dark:text-purple-400 font-medium uppercase text-xs">Active Suppliers</p>
                                    <p className="text-4xl font-bold text-gray-900 dark:text-white mt-2">{stats.suppliers}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'hero' && (
                        <div className="space-y-6">
                             <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Hero Section</h2>
                             <div>
                                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Main Title</label>
                                 <textarea 
                                    value={config.hero.title}
                                    onChange={(e) => updateConfig('hero', { ...config.hero, title: e.target.value })}
                                    className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    rows={2}
                                 />
                             </div>
                             <div>
                                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subtitle</label>
                                 <textarea 
                                    value={config.hero.subtitle}
                                    onChange={(e) => updateConfig('hero', { ...config.hero, subtitle: e.target.value })}
                                    className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                    rows={3}
                                 />
                             </div>
                             <div>
                                 <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Background Image URL</label>
                                 <input 
                                    type="text"
                                    value={config.hero.imageUrl}
                                    onChange={(e) => updateConfig('hero', { ...config.hero, imageUrl: e.target.value })}
                                    className="w-full p-3 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                 />
                                 <img src={config.hero.imageUrl} alt="Preview" className="mt-2 h-40 w-full object-cover rounded-lg opacity-75" />
                             </div>
                        </div>
                    )}

                    {activeTab === 'features' && (
                         <div className="space-y-6">
                            <div className="flex justify-between items-center">
                                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Features Cards</h2>
                            </div>
                            {config.features.map((feature, idx) => (
                                <div key={idx} className="p-4 border rounded-lg dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold mb-1 dark:text-gray-300">Title</label>
                                            <input 
                                                value={feature.title}
                                                onChange={(e) => handleFeatureChange(idx, 'title', e.target.value)}
                                                className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold mb-1 dark:text-gray-300">Icon Name</label>
                                            <select 
                                                value={feature.iconName}
                                                onChange={(e) => handleFeatureChange(idx, 'iconName', e.target.value)}
                                                className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            >
                                                {['SmartMatch', 'Chat', 'Inventory', 'Expiry', 'Secure', 'Cloud', 'Camera', 'Invoice', 'Analytics'].map(ic => (
                                                    <option key={ic} value={ic}>{ic}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="md:col-span-3">
                                            <label className="block text-xs font-bold mb-1 dark:text-gray-300">Description</label>
                                            <input 
                                                value={feature.description}
                                                onChange={(e) => handleFeatureChange(idx, 'description', e.target.value)}
                                                className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {activeTab === 'testimonials' && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Testimonials</h2>
                             {config.testimonials.map((t, idx) => (
                                <div key={idx} className="p-4 border rounded-lg dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 relative">
                                     <button 
                                        onClick={() => {
                                            const newT = config.testimonials.filter((_, i) => i !== idx);
                                            updateConfig('testimonials', newT);
                                        }}
                                        className="absolute top-2 right-2 text-red-500 hover:text-red-700"
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                    <div className="grid gap-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <input 
                                                value={t.name}
                                                onChange={(e) => {
                                                    const newT = [...config.testimonials];
                                                    newT[idx].name = e.target.value;
                                                    updateConfig('testimonials', newT);
                                                }}
                                                placeholder="Name"
                                                className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                            <input 
                                                value={t.role}
                                                onChange={(e) => {
                                                    const newT = [...config.testimonials];
                                                    newT[idx].role = e.target.value;
                                                    updateConfig('testimonials', newT);
                                                }}
                                                placeholder="Role"
                                                className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            />
                                        </div>
                                        <textarea 
                                            value={t.quote}
                                            onChange={(e) => {
                                                const newT = [...config.testimonials];
                                                newT[idx].quote = e.target.value;
                                                updateConfig('testimonials', newT);
                                            }}
                                            placeholder="Quote"
                                            className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            rows={2}
                                        />
                                        <input 
                                            value={t.image}
                                            onChange={(e) => {
                                                const newT = [...config.testimonials];
                                                newT[idx].image = e.target.value;
                                                updateConfig('testimonials', newT);
                                            }}
                                            placeholder="Image URL"
                                            className="p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                        />
                                    </div>
                                </div>
                            ))}
                            <button 
                                onClick={() => updateConfig('testimonials', [...config.testimonials, { name: '', role: '', quote: '', image: '' }])}
                                className="flex items-center gap-2 text-indigo-600 font-bold"
                            >
                                <PlusIcon className="w-5 h-5" /> Add Testimonial
                            </button>
                        </div>
                    )}

                    {activeTab === 'faq' && (
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">FAQs</h2>
                            {config.faqs.map((faq, idx) => (
                                <div key={idx} className="p-4 border rounded-lg dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 relative">
                                    <button 
                                        onClick={() => {
                                            const newF = config.faqs.filter((_, i) => i !== idx);
                                            updateConfig('faqs', newF);
                                        }}
                                        className="absolute top-2 right-2 text-red-500 hover:text-red-700"
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                    <div className="space-y-2">
                                        <input 
                                            value={faq.question}
                                            onChange={(e) => {
                                                const newF = [...config.faqs];
                                                newF[idx].question = e.target.value;
                                                updateConfig('faqs', newF);
                                            }}
                                            placeholder="Question"
                                            className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white font-bold"
                                        />
                                        <textarea 
                                            value={faq.answer}
                                            onChange={(e) => {
                                                const newF = [...config.faqs];
                                                newF[idx].answer = e.target.value;
                                                updateConfig('faqs', newF);
                                            }}
                                            placeholder="Answer"
                                            className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                            rows={2}
                                        />
                                    </div>
                                </div>
                            ))}
                            <button 
                                onClick={() => updateConfig('faqs', [...config.faqs, { question: '', answer: '' }])}
                                className="flex items-center gap-2 text-indigo-600 font-bold"
                            >
                                <PlusIcon className="w-5 h-5" /> Add FAQ
                            </button>
                        </div>
                    )}

                </main>
            </div>
        </div>
    );
};

export default AdminDashboard;
