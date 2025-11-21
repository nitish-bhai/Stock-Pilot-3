
import React, { useState, useEffect } from 'react';
import Header from './Header';
import HeroSection from './HeroSection';
import FeaturesSection from './FeaturesSection';
import BenefitsSection from './BenefitsSection';
import ForSellersSection from './ForSellersSection';
import ForSuppliersSection from './ForSuppliersSection';
import PricingSection from './PricingSection';
import TestimonialsSection from './TestimonialsSection';
import FAQSection from './FAQSection';
import Footer from './Footer';
import LoginComponent from '../Login';
import AOS from 'aos';
import { useSiteContent } from '../../hooks/useSiteContent';

interface LandingPageProps {
    onAdminClick?: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onAdminClick }) => {
    const [isLoginModalOpen, setLoginModalOpen] = useState(false);
    const { config, loading } = useSiteContent();

    useEffect(() => {
        AOS.init({
            once: true,
            duration: 600,
            easing: 'ease-out-sine',
        });
    }, []);

    const handleOpenLoginModal = () => setLoginModalOpen(true);
    const handleCloseLoginModal = () => setLoginModalOpen(false);
    
    if (loading && !config) {
        // Optional loading state if needed, but fetching defaults is fast
    }

    return (
        <div className="bg-white dark:bg-gray-900">
            <Header onLoginClick={handleOpenLoginModal} />
            <main>
                <HeroSection onGetStartedClick={handleOpenLoginModal} config={config?.hero} />
                <FeaturesSection features={config?.features} />
                <BenefitsSection />
                <ForSellersSection />
                <ForSuppliersSection />
                <PricingSection />
                <TestimonialsSection testimonials={config?.testimonials} />
                <FAQSection faqs={config?.faqs} />
            </main>
            <Footer onAdminClick={onAdminClick} />
            <LoginComponent isOpen={isLoginModalOpen} onClose={handleCloseLoginModal} />
        </div>
    );
};

export default LandingPage;
