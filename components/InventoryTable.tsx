
import React from 'react';
import { InventoryItem } from '../types';

interface InventoryTableProps {
    items: InventoryItem[];
    loading: boolean;
    totalItems: number;
    totalValue: number;
}

const InventoryTable: React.FC<InventoryTableProps> = ({ items, loading, totalItems, totalValue }) => {
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
        }).format(amount);
    };

    return (
        <div className="bg-gray-800 bg-opacity-50 backdrop-blur-md rounded-xl shadow-lg overflow-hidden border border-gray-700">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-300">
                    <thead className="text-xs text-gray-400 uppercase bg-gray-700 bg-opacity-50">
                        <tr>
                            <th scope="col" className="px-6 py-3">Product Name</th>
                            <th scope="col" className="px-6 py-3 text-right">Quantity</th>
                            <th scope="col" className="px-6 py-3 text-right">Price/Item</th>
                            <th scope="col" className="px-6 py-3 text-right">Total Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={4} className="text-center p-6">Loading inventory...</td></tr>
                        ) : items.length === 0 ? (
                            <tr><td colSpan={4} className="text-center p-6">Your inventory is empty. Tap the mic to add items.</td></tr>
                        ) : (
                            items.sort((a, b) => a.name.localeCompare(b.name)).map((item) => (
                                <tr key={item.id} className="border-b border-gray-700 hover:bg-gray-700/50">
                                    <th scope="row" className="px-6 py-4 font-medium text-white whitespace-nowrap capitalize">
                                        {item.name}
                                    </th>
                                    <td className="px-6 py-4 text-right">{item.quantity}</td>
                                    <td className="px-6 py-4 text-right">{formatCurrency(item.price)}</td>
                                    <td className="px-6 py-4 text-right font-semibold">{formatCurrency(item.price * item.quantity)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                    <tfoot>
                        <tr className="font-semibold text-white bg-gray-700 bg-opacity-50">
                            <th scope="row" className="px-6 py-3 text-base">Total</th>
                            <td className="px-6 py-3 text-right">{totalItems}</td>
                            <td className="px-6 py-3"></td>
                            <td className="px-6 py-3 text-right">{formatCurrency(totalValue)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
};

export default InventoryTable;