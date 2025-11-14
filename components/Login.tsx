import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const LoginComponent: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLogin, setIsLogin] = useState(true);
    const { signUp, logIn } = useAuth();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            if (isLogin) {
                await logIn(email, password);
            } else {
                await signUp(email, password);
            }
        } catch (err: any) {
            setError(err.message);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-lg shadow-lg">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-white">Stock Pilot</h1>
                    <p className="text-gray-400">by SoundSync</p>
                </div>
                <p className="text-center text-gray-400">{isLogin ? 'Sign in to your account' : 'Create a new account'}</p>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="email" className="text-sm font-medium text-gray-300">Email</label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full px-3 py-2 mt-1 text-white bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div>
                        <label htmlFor="password"className="text-sm font-medium text-gray-300">Password</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="w-full px-3 py-2 mt-1 text-white bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    <button type="submit" className="w-full py-2 text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-indigo-500 transition duration-150">
                        {isLogin ? 'Log In' : 'Sign Up'}
                    </button>
                </form>
                <div className="text-center">
                    <button onClick={() => setIsLogin(!isLogin)} className="text-sm text-indigo-400 hover:underline">
                        {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Log In'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default LoginComponent;