import React from 'react';
import Header from './components/Header';
import AppointmentFlow from './components/AppointmentFlow';

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <AppointmentFlow />
        </div>
      </main>
    </div>
  );
}

export default App;