import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Calendar, AlertCircle, CheckCircle, Mic } from 'lucide-react';
import clsx from 'clsx';

// Add at the top of your file
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

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
  "Find me a branch within 5 miles with 24hrs Drive-thru ATM service"
];

const GUEST_PROMPTS = [
  "I'm new and want to open an account",
  "I need help with a loan application",
  "Can I schedule an appointment for tomorrow?"
];

// Typewriter placeholder suggestions
const PLACEHOLDER_SUGGESTIONS = [
  "For Example .... Book an appointment for next Monday 2pm at Manhattan for a loan consultation",
  "For Example .... Find me the nearest branch with 24hrs Check Deposit with drive-thru service",
  "For Example .... Reschedule my upcoming appointment on 6th March at 3pm",
  "For Example .... Check my upcoming bookings",
];

const ChatInterface: React.FC<ChatInterfaceProps> = ({ isLoggedIn, userName, userType, token }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [formattedOptions, setFormattedOptions] = useState<string[]>([]);
  const [appointmentStatus, setAppointmentStatus] = useState<{
    details: AppointmentDetails | null;
    missingFields: string[];
  }>({
    details: null,
    missingFields: [],
  });
  const [sessionError, setSessionError] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const retryCount = useRef(0);
  const MAX_RETRIES = 2;

  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [currentPlaceholder, setCurrentPlaceholder] = useState('');
  const [charIndex, setCharIndex] = useState(0);

  const prompts = userType === 'customer' ? CUSTOMER_PROMPTS : GUEST_PROMPTS;

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
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({
        query,
        customerType: userType === 'customer' ? 'Regular' : 'Guest',
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Session expired or invalid');
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
      response: data.response,
      appointmentDetails: data.appointmentDetails || null,
      missingFields: data.missingFields || [],
    };
  };

  useEffect(() => {
    setMessages(getDefaultMessages());
  }, []);

  useEffect(() => {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognitionAPI();
    
    // Configure for more reliable short-phrase recognition
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = true; // Change to true to get partial results
    recognitionRef.current.maxAlternatives = 3; // Get multiple alternatives
    recognitionRef.current.lang = 'en-US';

    recognitionRef.current.onresult = (event) => {
      // Only set isRecording to false for final results
      if (event.results[0].isFinal) {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsRecording(false);
        retryCount.current = 0;
      } else {
        // For interim results, just update the input but keep recording
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
      }
    };

    recognitionRef.current.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      
      // Handle different error types
      if (event.error === 'network' || event.error === 'service-not-allowed') {
        if (retryCount.current < MAX_RETRIES) {
          retryCount.current += 1;
          setMessages(prev => [...prev, { 
            type: 'assistant', 
            text: `Connection issue detected. Switching to local processing mode. Retrying (${retryCount.current}/${MAX_RETRIES})...` 
          }]);
          
          // Use a progressive backoff strategy
          setTimeout(() => {
            if (recognitionRef.current) {
              // Try with different settings
              recognitionRef.current.continuous = false;
              recognitionRef.current.interimResults = false;
              recognitionRef.current.start();
            }
          }, 1000 * retryCount.current); // Increasing delay with each retry
        } else {
          setIsRecording(false);
          setMessages(prev => [...prev, { 
            type: 'assistant', 
            text: 'Speech recognition service is currently unavailable. Please try typing your message instead.' 
          }]);
          retryCount.current = 0;
        }
      } else if (event.error === 'no-speech') {
        setMessages(prev => [...prev, { 
          type: 'assistant', 
          text: 'I didn\'t hear anything. Please try speaking again or type your message.' 
        }]);
        setIsRecording(false);
      } else if (event.error === 'aborted') {
        // User or system aborted, no need for error message
        setIsRecording(false);
      } else {
        setMessages(prev => [...prev, { 
          type: 'assistant', 
          text: `Speech recognition error: ${event.error}. Please try typing instead.` 
        }]);
        setIsRecording(false);
      }
    };

    recognitionRef.current.onend = () => {
      setIsRecording(false);
    };
    
    // Add this handler to better detect when recognition has started
    recognitionRef.current.onstart = () => {
      console.log('Speech recognition started');
      setIsRecording(true);
    };
  } else {
    console.warn('Speech Recognition not supported in this browser.');
  }
}, []);

  useEffect(() => {
    if (input || isProcessing || sessionError || isRecording) return;

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
        }, 2000);
      }
    }, 100);

    return () => clearInterval(typeInterval);
  }, [charIndex, placeholderIndex, input, isProcessing, sessionError, isRecording]);

  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        console.log('Fetching initial chat state...');
        const response = await fetch(`${API_BASE_URL}/chat/state`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          credentials: 'include',
        });

        console.log('Initial state response:', response);

        if (!response.ok) {
          if (response.status === 401) {
            const healthCheck = await checkSessionHealth();
            if (healthCheck) {
              console.log('Session valid, retrying initial state fetch...');
              fetchInitialState();
              return;
            }
          }
          console.log('Failed to fetch initial state, using default messages');
          setMessages(getDefaultMessages());
          return;
        }
        
        const { messages: initialMessages, appointmentDetails } = await response.json();
        console.log('Received initial state:', { initialMessages, appointmentDetails });

        if (initialMessages && initialMessages.length > 0) {
          const parsedMessages = initialMessages
            .filter((msg: any) => msg.role !== 'system')
            .map((msg: any) => ({
              text: msg.role === 'user' 
                ? msg.content 
                : (() => {
                    try {
                      const parsed = JSON.parse(msg.content);
                      return parsed.response || msg.content;
                    } catch (e) {
                      console.error('Error parsing message content:', e);
                      return msg.content;
                    }
                  })(),
              type: msg.role === 'user' ? 'user' : 'assistant',
            }));
          setMessages(parsedMessages.length > 0 ? parsedMessages : getDefaultMessages());
        } else {
          console.log('No initial messages, using default messages');
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
      if (healthy) {
        fetchInitialState();
      } else {
        console.log('Session unhealthy, setting default messages');
        setSessionError(true);
        setMessages(getDefaultMessages());
      }
    });
  }, [token]);

  const getDefaultMessages = () => [
    { type: 'assistant' as const, text: "We're here to make booking an appointment with your banker quick, and easy!" },
    { type: 'assistant' as const, text: "Use our conversational chat option or speak to schedule a meeting. For example, say or type your preferred date, time, banker, branch, and reason." },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
// ///////////////////////////////////////////
  const processResponse = async (response: string): Promise<{ processedResponse: string, options: string[] }> => {
  // Call OpenAI API to extract options from the response
    const openaiResponse = await fetch(`${API_BASE_URL}/extract-options`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ response }),
    });

    if (!openaiResponse.ok) {
      throw new Error(`HTTP error! status: ${openaiResponse.status}`);
    }

    const data = await openaiResponse.json();
    const options = data.options || [];

    // Add your custom processing logic here
    const processedResponse = `Assistant: ${response}`;

    return { processedResponse, options };
  };
  // ///////////////////////////////////////////

  const handleSend = async (text: string = input) => {
    if (!text.trim() || isProcessing) return;

    setIsProcessing(true);
    setMessages(prev => [...prev, { type: 'user', text }]);
    setInput('');

    setMessages(prev => [...prev, { type: 'assistant', text: 'Working...', isLoading: true }]);

    try {
      if (sessionError) {
        const isHealthy = await checkSessionHealth();
        if (!isHealthy) throw new Error('Session is not available');
        setSessionError(false);
      }
      
      const { response, appointmentDetails, missingFields } = await chatWithAssistant(text);

      const { processedResponse, options } = await processResponse(response);
      console.log('Processed response:', processedResponse);
      console.log('Options:', options);
      if (options[0].includes('NotFound')) {
        
        setFormattedOptions([]);
      } else {
        const formattedOptions = options.length > 0 ? options[0].split(',').map(opt => opt.trim()) : [];
        console.log('Formatted options:', formattedOptions);
        setFormattedOptions(formattedOptions);
      }      

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

  const checkInternetConnection = () => {
    return navigator.onLine;
  };

  const handleMicClick = () => {
    if (!recognitionRef.current) {
      setMessages(prev => [...prev, { 
        type: 'assistant', 
        text: 'Speech recognition is not supported in your browser.' 
      }]);
      return;
    }
  
    if (!checkInternetConnection()) {
      setMessages(prev => [...prev, { 
        type: 'assistant', 
        text: 'Your device appears to be offline. Speech recognition requires an internet connection.' 
      }]);
      return;
    }
  
    if (isRecording) {
      // Stop recognition
      try {
        recognitionRef.current.stop();
        // Don't set isRecording false here; let onend handle it
      } catch (e) {
        console.error('Error stopping recognition:', e);
        setIsRecording(false); // Fallback if stop fails
      }
    } else {
      // Start recognition
      setInput(''); // Clear input
      try {
        recognitionRef.current.start();
        // Don't set isRecording true here; let onstart handle it
      } catch (e) {
        console.error('Error starting recognition:', e);
        setIsRecording(false);
        setMessages(prev => [...prev, { 
          type: 'assistant', 
          text: 'Could not start speech recognition. Please try again.' 
        }]);
      }
    }
  };
  
  const formatAppointmentTime = (isoDateTime: string | null) => {
    if (!isoDateTime) return '(Not specified)';
    
    const date = new Date(isoDateTime);
    const options = {
      timeZone: 'UTC', // Force UTC to avoid local timezone shifts
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    };
    const formatted = date.toLocaleString('en-US', options);
    return formatted.replace(/(\d+),/, '$1th,');
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
        <div className="suggested-prompts">
        {formattedOptions.map((option, index) => (
          <button
            key={index}
            className="prompt-bubble"
            onClick={() => handleSend(option)}
          >
            {option}
          </button>
        ))}
      </div>
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
            placeholder={currentPlaceholder}
            disabled={isProcessing || sessionError || isRecording}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#CD1309] disabled:opacity-50"
          />
          <button
            onClick={handleMicClick}
            disabled={isProcessing || sessionError}
            className={clsx(
              'px-4 py-2 rounded-lg transition-colors flex items-center justify-center',
              isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-200 text-gray-800 hover:bg-gray-300',
              'disabled:opacity-50'
            )}
          >
            <Mic className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleSend()}
            disabled={isProcessing || sessionError || !input.trim() || isRecording}
            className="px-4 py-2 bg-[#CD1309] text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:bg-gray-400"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

// CSS for pulse animation
const styles = `
  @keyframes pulse {
    0% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.1); opacity: 0.7; }
    100% { transform: scale(1); opacity: 1; }
  }

  .animate-pulse {
    animation: pulse 1.5s infinite;
  }
`;

export default ChatInterface;