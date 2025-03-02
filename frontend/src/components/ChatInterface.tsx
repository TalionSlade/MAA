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
  "I need an appointment with my preferred banker at my local branch",
  "Reschedule my upcoming appointment to next Tuesday at 2pm",
  "When is the next available slot for a loan consultation?"
];

const GUEST_PROMPTS = [
  "I'm new and want to open an account",
  "I need help with a loan application",
  "Can I schedule an appointment for tomorrow?"
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
    missingFields: []
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const prompts = userType === 'customer' ? CUSTOMER_PROMPTS : GUEST_PROMPTS;

  const chatWithAssistant = async (query: string) => {
    const customerType = userType === 'customer' ? 'Regular' : 'Guest';
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
      },
      body: JSON.stringify({ query, customerType }),
    });
    if (!response.ok) throw new Error((await response.json()).message || 'Chat request failed');
    return await response.json();
  };

  useEffect(() => {
    const fetchInitialState = async () => {
      const response = await fetch(`${API_BASE_URL}/chat/state`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!response.ok) {
        setMessages([
          {
            type: 'assistant',
            text: 'Use our conversational chat option to schedule a meeting. For example, simply type your preferred date, time, banker, branch, and reason for the appointment, and we will take care of it.'
          }
        ]);
        return;
      }
      const { messages: initialMessages, appointmentDetails } = await response.json();
      const parsedMessages = initialMessages.map(msg => ({
        text: msg.role === 'user' ? msg.content : JSON.parse(msg.content).response,
        type: msg.role
      }));
      setMessages(parsedMessages.length > 0 ? parsedMessages : [
        {
          type: 'assistant',
          text: 'We\'re here to make booking an appointment with your banker quick, and easy!'
        },
        {
          
          type: 'assistant',
          text: 'Use our conversational chat option to schedule a meeting. For example, simply type your preferred date, time, banker, branch, and reason for the appointment, and we will take care of it.'
        }
       
      ]);
      if (appointmentDetails) setAppointmentStatus({ details: appointmentDetails, missingFields: [] });
    };
    fetchInitialState();
  }, [token]);

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
      const { response, appointmentDetails, missingFields } = await chatWithAssistant(text);

      setMessages(prev => prev.filter(msg => !msg.isLoading));
      setMessages(prev => [...prev, { type: 'assistant', text: response }]);
      setAppointmentStatus({ details: appointmentDetails, missingFields });
    } catch (error) {
      setMessages(prev => prev.filter(msg => !msg.isLoading));
      setMessages(prev => [...prev, { type: 'assistant', text: 'Sorry, something went wrong. Please try again!' }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const renderAppointmentStatus = () => {
    const { details, missingFields } = appointmentStatus;
    if (!details || (!details.Reason_for_Visit__c && !details.Appointment_Date__c && !details.Appointment_Time__c && !details.Location__c)) return null;

    return (
      <div className="p-4 mx-4 my-2 bg-white rounded-lg border shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-5 h-5 text-[#CD1309]" />
          <h3 className="font-medium">Suggested Appointment</h3>
        </div>
        <div className="space-y-1 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div className="text-gray-500">Purpose:</div>
            <div>{details.Reason_for_Visit__c || '(Not specified)'}</div>
            <div className="text-gray-500">Date:</div>
            <div>{details.Appointment_Date__c || '(Not specified)'}</div>
            <div className="text-gray-500">Time:</div>
            <div>{details.Appointment_Time__c || '(Not specified)'}</div>
            <div className="text-gray-500">Location:</div>
            <div>{details.Location__c || '(Not specified)'}</div>
          </div>
          {missingFields.length > 0 && (
            <div className="mt-3 flex items-start gap-2 text-amber-600 text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5" />
              <div>Let me know if this works or what you'd like to change!</div>
            </div>
          )}
          {details.Id && (
            <div className="mt-3 text-green-600 text-xs flex items-center gap-1">
              <CheckCircle className="w-4 h-4" />
              <div>Appointment confirmed!</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
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
              disabled={isProcessing}
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
            placeholder="Ask about your appointment..."
            disabled={isProcessing}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CD1309] disabled:opacity-50"
          />
          <button
            onClick={() => handleSend()}
            disabled={isProcessing || !input.trim()}
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