
import React, { useState, useEffect } from 'react';
import Header from './Header';
import HeroSection from './HeroSection';
import FeaturesSection from './FeaturesSection';
import BenefitsSection from './BenefitsSection';
import ForSellersSection from './ForSellersSection';
import ForSuppliersSection from './ForSuppliersSection';
import TestimonialsSection from './TestimonialsSection';
import Footer from './Footer';
import LoginComponent from '../Login';
import AOS from 'aos';

const LandingPage: React.FC = () => {
    const [isLoginModalOpen, setLoginModalOpen] = useState(false);

    useEffect(() => {
        AOS.init({
            once: true,
            duration: 600,
            easing: 'ease-out-sine',
        });
    }, []);

    const handleOpenLoginModal = () => setLoginModalOpen(true);
    const handleCloseLoginModal = () => setLoginModalOpen(false);
    
    return (
        <div className="bg-white dark:bg-gray-900">
            <Header onLoginClick={handleOpenLoginModal} />
            <main>
                <HeroSection onGetStartedClick={handleOpenLoginModal} />
                <FeaturesSection />
                <BenefitsSection />
                <ForSellersSection />
                <ForSuppliersSection />
                <TestimonialsSection />
            </main>
            <Footer />
            <LoginComponent isOpen={isLoginModalOpen} onClose={handleCloseLoginModal} />
        </div>
    );
};

export default LandingPage;