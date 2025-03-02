import React from 'react';
import { Search } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="bg-[#CD1309] text-white">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
        <div className="text-2xl font-bold tracking-tight">Make An Appointment</div>
        <div className="flex items-center space-x-6">
          <a href="#" className="text-sm hover:underline">Enroll</a>
          <a href="#" className="text-sm hover:underline">Customer Service</a>
          <a href="#" className="text-sm hover:underline">Locations</a>
          <a href="#" className="text-sm hover:underline">Español</a>
          <div className="relative">
            <input
              type="text"
              placeholder="Search"
              className="pl-3 pr-10 py-1 rounded text-black text-sm"
            />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;