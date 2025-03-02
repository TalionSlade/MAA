import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Calendar, AlertCircle, CheckCircle } from 'lucide-react';
import clsx from 'clsx';

interface ChatInterfaceProps {
  isLoggedIn: boolean;
  userName: string;
  userType: 'guest' | 'customer' | null;
  token?: string | null;
}

interface Message {
  text: string;
  type: 'assistant' | 'user';
  isLoading?: boolean;
}

interface AppointmentDetails {
  Reason_for_Visit__c: string | null;
  Appointment_Date__c: string | null;
  Appointment_Time__c: string | null;
  Location__c: string | null;
  Customer_Type__c: string | null;
  Id?: string;
}

const API_BASE_URL = 'http://localhost:3000/api';

const CUSTOMER_PROMPTS = [
  "I need an appointment with my preferred banker and branch",
  "Reschedule my upcoming appointment to next Tuesday at 2pm",
  "When is the next available slot for a loan consultation?"
];

const GUEST_PROMPTS = [
  "I'm new and want to open an account",
  "I need help with a loan application",
  "Can I schedule an appointment for tomorrow?"
];

// Typewriter placeholder suggestions
const PLACEHOLDER_SUGGESTIONS = [
  "Book an appointment for next Monday 2pm at Manhattan for a loan consultation",
  "Schedule a card consultation on 6th March at 3pm",
  "Meet with George at Brooklyn tomorrow 3pm",
  "Check my upcoming bookings",
];

const ChatInterface: React.FC<ChatInterfaceProps> = ({ isLoggedIn, userName, userType, token }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [appointmentStatus, setAppointmentStatus] = useState<{
    details: AppointmentDetails | null;
    missingFields: string[];
  }>({
    details: null,
    missingFields: [],
  });
  const [sessionError, setSessionError] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Typewriter state
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [currentPlaceholder, setCurrentPlaceholder] = useState('');
  const [charIndex, setCharIndex] = useState(0);

  const prompts = userType === 'customer' ? CUSTOMER_PROMPTS : GUEST_PROMPTS;

  // Typewriter effect logic
  useEffect(() => {
    if (input || isProcessing || sessionError) return; // Stop animation when typing, processing, or session error

    const typeInterval = setInterval(() => {
      const fullText = PLACEHOLDER_SUGGESTIONS[placeholderIndex];
      if (charIndex < fullText.length) {
        setCurrentPlaceholder(fullText.slice(0, charIndex + 1));
        setCharIndex(charIndex + 1);
      } else {
        clearInterval(typeInterval);
        setTimeout(() => {
          setCharIndex(0);
          setCurrentPlaceholder('');
          setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDER_SUGGESTIONS.length);
        }, 2000); // Pause for 2 seconds before switching
      }
    }, 100); // Typing speed (100ms per character)

    return () => clearInterval(typeInterval);
  }, [charIndex, placeholderIndex, input, isProcessing, sessionError]);

  // Existing session health check function
  const checkSessionHealth = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/session-health`, {
        credentials: 'include',
      });
      return response.ok;
    } catch (error) {
      console.error('Session health check failed:', error);
      return false;
    }
  };

  const chatWithAssistant = async (query: string) => {
    const customerType = userType === 'customer' ? 'Regular' : 'Guest';
    
    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        body: JSON.stringify({ query, customerType }),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 401 && errorData.error === 'SESSION_EXPIRED') {
          console.log('Session expired, attempting to recover...');
          setSessionError(true);
          const healthCheck = await checkSessionHealth();
          if (!healthCheck) throw new Error('Session recovery failed');
          return await chatWithAssistant(query);
        }
        throw new Error(errorData.message || 'Chat request failed');
      }
      
      setSessionError(false);
      return await response.json();
    } catch (error) {
      console.error('Chat error:', error);
      throw error;
    }
  };

  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/chat/state`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          credentials: 'include',
        });

        if (!response.ok) {
          if (response.status === 401) {
            const healthCheck = await checkSessionHealth();
            if (healthCheck) {
              fetchInitialState();
              return;
            }
          }
          setMessages(getDefaultMessages());
          return;
        }
        
        const { messages: initialMessages, appointmentDetails } = await response.json();
        if (initialMessages && initialMessages.length > 0) {
          const parsedMessages = initialMessages
            .filter(msg => msg.role !== 'system')
            .map(msg => ({
              text: msg.role === 'user' 
                ? msg.content 
                : (() => {
                    try {
                      const parsed = JSON.parse(msg.content);
                      return parsed.response || msg.content;
                    } catch (e) {
                      return msg.content;
                    }
                  })(),
              type: msg.role === 'user' ? 'user' : 'assistant',
            }));
          setMessages(parsedMessages.length > 0 ? parsedMessages : getDefaultMessages());
        } else {
          setMessages(getDefaultMessages());
        }
        
        if (appointmentDetails) {
          setAppointmentStatus({ details: appointmentDetails, missingFields: [] });
        }
      } catch (error) {
        console.error('Failed to fetch initial state:', error);
        setMessages(getDefaultMessages());
      }
    };
    
    checkSessionHealth().then(healthy => {
      if (healthy) fetchInitialState();
      else {
        setSessionError(true);
        setMessages(getDefaultMessages());
      }
    });
  }, [token]);

  const getDefaultMessages = () => [
    { type: 'assistant' as const, text: "We're here to make booking an appointment with your banker quick, and easy!" },
    { type: 'assistant' as const, text: "Use our conversational chat option to schedule a meeting. For example, simply type your preferred date, time, banker, branch, and reason for the appointment, and we will take care of it." },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isProcessing) return;

    setIsProcessing(true);
    setMessages(prev => [...prev, { type: 'user', text }]);
    setInput('');

    setMessages(prev => [...prev, { type: 'assistant', text: 'Thinking...', isLoading: true }]);

    try {
      if (sessionError) {
        const isHealthy = await checkSessionHealth();
        if (!isHealthy) throw new Error('Session is not available');
        setSessionError(false);
      }
      
      const { response, appointmentDetails, missingFields } = await chatWithAssistant(text);

      setMessages(prev => prev.filter(msg => !msg.isLoading));
      setMessages(prev => [...prev, { type: 'assistant', text: response }]);
      setAppointmentStatus({ details: appointmentDetails, missingFields });
    } catch (error) {
      console.error('Error in chat:', error);
      setMessages(prev => prev.filter(msg => !msg.isLoading));
      
      if (String(error).includes('Session')) {
        setSessionError(true);
        setMessages(prev => [...prev, { type: 'assistant', text: 'I lost our conversation history. Please try again or refresh the page.' }]);
      } else {
        setMessages(prev => [...prev, { type: 'assistant', text: 'Sorry, something went wrong. Please try again!' }]);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Function to format ISO 8601 date-time to a user-friendly format
  const formatAppointmentTime = (isoDateTime: string | null) => {
    if (!isoDateTime) return '(Not specified)';
    
    const date = new Date(isoDateTime);
    const options = {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    };
    const formatted = date.toLocaleString('en-US', options);
    return formatted.replace(/(\d+),/, '$1th,'); // Add "th" for day (e.g., March 3rd)
  };

  const renderAppointmentStatus = () => {
    const { details, missingFields } = appointmentStatus;
    if (!details || !details.Id) return null;

    return (
      <div className="p-4 mx-4 my-2 bg-white rounded-lg border shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <h3 className="font-medium">Appointment Confirmation</h3>
        </div>
        <div className="space-y-1 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="text-gray-500">Purpose:</div>
            <div>{details.Reason_for_Visit__c || '(Not specified)'}</div>
            <div className="text-gray-500">Date & Time:</div>
            <div>{formatAppointmentTime(details.Appointment_Time__c)}</div>
            <div className="text-gray-500">Location:</div>
            <div>{details.Location__c || '(Not specified)'}</div>
          </div>
          {details.Id && (
            <p className="mt-2 text-gray-600 text-xs">
              Appointment ID: {details.Id}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {sessionError && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-2">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-amber-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-amber-700">
                There seems to be an issue with your session. 
                <button 
                  onClick={() => checkSessionHealth().then(healthy => {
                    setSessionError(!healthy);
                    if (healthy) setMessages(getDefaultMessages());
                  })}
                  className="ml-2 font-medium text-amber-700 underline"
                >
                  Try reconnecting
                </button>
              </p>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex-1 p-4 overflow-y-auto">
        {messages.map((message, index) => (
          <div
            key={index}
            className={clsx(
              'mb-4 p-3 rounded-lg max-w-[85%]',
              message.type === 'user' ? 'ml-auto bg-[#CD1309] text-white' : 'mr-auto bg-gray-100 text-gray-800',
              message.isLoading && 'animate-pulse'
            )}
          >
            {message.text}
          </div>
        ))}
        {renderAppointmentStatus()}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t bg-gray-50">
        <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          {prompts.map((prompt, index) => (
            <button
              key={index}
              onClick={() => handleSend(prompt)}
              disabled={isProcessing || sessionError}
              className="text-left p-2 text-sm bg-white border rounded-lg hover:bg-gray-50 transition-colors flex items-start space-x-2 disabled:opacity-50"
            >
              <MessageSquare className="w-4 h-4 text-[#CD1309] mt-0.5 flex-shrink-0" />
              <span>{prompt}</span>
            </button>
          ))}
        </div>

        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder={currentPlaceholder} // Dynamic placeholder
            disabled={isProcessing || sessionError}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CD1309] disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={isProcessing || sessionError || !input.trim()}
            className="px-4 py-2 bg-[#CD1309] text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:bg-gray-400"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;