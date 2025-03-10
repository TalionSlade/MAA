import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, AlertCircle, CheckCircle, Mic } from 'lucide-react';
import clsx from 'clsx';

// SpeechRecognition support
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
  isGuidedMode: boolean; // Add isGuidedMode prop  
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

// Example API base (adjust for your environment)
const API_BASE_URL = 'http://localhost:3000/api';

// Example prompts for unguided flow
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

// Guided flow reason choices
const GUIDED_REASONS = [
  "Open a new account",
  "Apply for a credit card",
  "Manage spending and saving",
  "Build credit and reduce debt",
  "Death of a loved one",
  "Questions or assistance with Wells Fargo products and services",
  "Save for retirement",
];

// Possible guided steps
type GuidedStep = 'reason' | 'date' | 'location' | 'confirmation' | 'completed';

/**
 * Helper function to format an ISO 8601 date/time string
 * (e.g. "2025-03-09T10:00:00.000Z") into a more readable format
 * (e.g. "March 9, 2025, 10:00 AM").
 */
function formatAppointmentTime(isoDateTime: string | null): string {
  if (!isoDateTime) return '(Not specified)';

  // Convert to a Date object
  const date = new Date(isoDateTime);

  // Example: show "March 9, 2025, 10:00 AM" in UTC or local
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC',  // or remove if you want local timezone
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  };
  let formatted = date.toLocaleString('en-US', options);
  // Optionally add "th" after the day (quick hack)
  // E.g. "March 9, 2025" => "March 9th, 2025"
  formatted = formatted.replace(/(\d+),/, '$1th,');
  return formatted;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ isLoggedIn, userName, userType, token,isGuidedMode }) => {
  // Chat states
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sessionError, setSessionError] = useState<boolean>(false);

  // Appointment status for final display
  const [appointmentStatus, setAppointmentStatus] = useState<{
    details: AppointmentDetails | null;
    missingFields: string[];
  }>({ details: null, missingFields: [] });

  // Toggle between guided and unguided flow
  const [isGuidedFlow, setIsGuidedFlow] = useState(false);

  // Guided flow states
  const [guidedStep, setGuidedStep] = useState<GuidedStep>('reason');
  const [selectedReason, setSelectedReason] = useState('');
  // Store both the readable format and the raw ISO format for date/time
  const [llmDateSuggestions, setLLMDateSuggestions] = useState<{ display: string; raw: string }[]>([]);
  const [selectedDateTime, setSelectedDateTime] = useState<{ display: string; raw: string }>({ display: '', raw: '' });
  const [llmLocationOptions, setLLMLocationOptions] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState('');

  // For auto-scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Speech recognition references
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const retryCount = useRef(0);
  const MAX_RETRIES = 2;

  // Typewriter placeholder
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [currentPlaceholder, setCurrentPlaceholder] = useState('');
  const [charIndex, setCharIndex] = useState(0);

  // Different default prompts for customers vs. guests
  const prompts = userType === 'customer' ? CUSTOMER_PROMPTS : GUEST_PROMPTS;

  // ---- Session check
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

  // ---- Unguided chat function
  const chatWithAssistant = async (query: string) => {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  // ---- On initial mount, set default messages
  useEffect(() => {
    setMessages(getDefaultMessages());
  }, []);

  // ---- Speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognitionAPI();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.maxAlternatives = 3;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event) => {
        if (event.results[0].isFinal) {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
          setIsRecording(false);
          retryCount.current = 0;
        } else {
          const transcript = event.results[0][0].transcript;
          setInput(transcript);
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'network' || event.error === 'service-not-allowed') {
          if (retryCount.current < MAX_RETRIES) {
            retryCount.current += 1;
            setMessages(prev => [...prev, {
              type: 'assistant',
              text: `Connection issue detected. Retrying (${retryCount.current}/${MAX_RETRIES})...`
            }]);
            setTimeout(() => {
              if (recognitionRef.current) {
                recognitionRef.current.continuous = false;
                recognitionRef.current.interimResults = false;
                recognitionRef.current.start();
              }
            }, 1000 * retryCount.current);
          } else {
            setIsRecording(false);
            setMessages(prev => [...prev, {
              type: 'assistant',
              text: 'Speech recognition is currently unavailable. Please type your message.'
            }]);
            retryCount.current = 0;
          }
        } else if (event.error === 'no-speech') {
          setMessages(prev => [...prev, {
            type: 'assistant',
            text: 'I didn’t hear anything. Please try again or type your message.'
          }]);
          setIsRecording(false);
        } else if (event.error === 'aborted') {
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

      recognitionRef.current.onstart = () => {
        console.log('Speech recognition started');
        setIsRecording(true);
      };
    } else {
      console.warn('Speech Recognition not supported in this browser.');
    }
  }, []);

  // ---- Typewriter placeholders
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
          setPlaceholderIndex(prev => (prev + 1) % PLACEHOLDER_SUGGESTIONS.length);
        }, 2000);
      }
    }, 100);
    return () => clearInterval(typeInterval);
  }, [charIndex, placeholderIndex, input, isProcessing, sessionError, isRecording]);

  // ---- Load chat state from the server
  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        console.log('Fetching initial chat state...');
        const response = await fetch(`${API_BASE_URL}/chat/state`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (!response.ok) {
          if (response.status === 401) {
            const healthy = await checkSessionHealth();
            if (healthy) {
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

  // Default messages
  const getDefaultMessages = (): Message[] => [
    { type: 'assistant', text: "We're here to make booking an appointment with your banker quick, and easy!" },
    { type: 'assistant', text: "You can chat with us or use our guided flow to book your appointment step-by-step." },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---- Unguided free-form message send
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
      setMessages(prev => prev.filter(msg => !msg.isLoading));
      setMessages(prev => [...prev, { type: 'assistant', text: response }]);
      setAppointmentStatus({ details: appointmentDetails, missingFields });
    } catch (error) {
      console.error('Error in chat:', error);
      setMessages(prev => prev.filter(msg => !msg.isLoading));
      if (String(error).includes('Session')) {
        setSessionError(true);
        setMessages(prev => [...prev, {
          type: 'assistant',
          text: 'I lost our conversation history. Please try again or refresh the page.'
        }]);
      } else {
        setMessages(prev => [...prev, { type: 'assistant', text: 'Sorry, something went wrong. Please try again!' }]);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // ---- Guided flow calls
  const callGuidedFlow = async (userQuery: string, step: GuidedStep) => {
    const response = await fetch(`${API_BASE_URL}/guidedFlow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        query: userQuery,
        customerType: userType === 'customer' ? 'Regular' : 'Guest',
        guidedStep: step,
      }),
    });
    return response.json();
  };

  // Step 1: Reason
  const handleReasonSelection = async (reason: string) => {
    setSelectedReason(reason);
    setMessages(prev => [...prev, { type: 'user', text: reason }]);
    setIsProcessing(true);
    try {
      const data = await callGuidedFlow(reason, 'reasonSelection');
      if (data.timeSlots && Array.isArray(data.timeSlots)) {
        setLLMDateSuggestions(data.timeSlots);
      }
      setMessages(prev => [
        ...prev.filter(msg => !msg.isLoading),
        { type: 'assistant', text: data.response || "Here are some suggested appointment slots..." }
      ]);
      setGuidedStep('date');
    } catch (error) {
      console.error('Error in guided flow (reason):', error);
      setMessages(prev => [...prev, {
        type: 'assistant',
        text: 'Error retrieving date suggestions. Please try again.'
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 2: Date/time
  const handleTimeSelection = async (slot: { display: string; raw: string }) => {
    setSelectedDateTime(slot);
    setMessages(prev => [...prev, { type: 'user', text: slot.display }]);
    setIsProcessing(true);
    try {
      const data = await callGuidedFlow(slot.raw, 'timeSelection');
      if (data.locationOptions && Array.isArray(data.locationOptions)) {
        setLLMLocationOptions(data.locationOptions);
      }
      setMessages(prev => [
        ...prev.filter(msg => !msg.isLoading),
        { type: 'assistant', text: data.response || "Please choose a location." }
      ]);
      setGuidedStep('location');
    } catch (error) {
      console.error('Error selecting time:', error);
      setMessages(prev => [...prev, {
        type: 'assistant',
        text: 'Could not fetch location options. Please try again.'
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 3: Location
  const handleLocationSelection = async (loc: string) => {
    setSelectedLocation(loc);
    setMessages(prev => [...prev, { type: 'user', text: loc }]);
    setIsProcessing(true);
    try {
      const data = await callGuidedFlow(loc, 'locationSelection');
      setMessages(prev => [
        ...prev.filter(msg => !msg.isLoading),
        { type: 'assistant', text: data.response || "Confirm your appointment details?" }
      ]);
      setGuidedStep('confirmation');
    } catch (error) {
      console.error('Error selecting location:', error);
      setMessages(prev => [...prev, {
        type: 'assistant',
        text: 'Could not finalize location step. Please try again.'
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 4: Confirmation (creates record in Salesforce)
  const handleConfirmAppointment = async () => {
    setMessages(prev => [...prev, { type: 'user', text: 'Confirm appointment' }]);
    setIsProcessing(true);
    try {
      const data = await callGuidedFlow('Confirm appointment', 'confirmation');
      setMessages(prev => [
        ...prev.filter(msg => !msg.isLoading),
        { type: 'assistant', text: data.response || "Your appointment has been booked." }
      ]);
      if (data.appointmentDetails?.Id) {
        setAppointmentStatus({ details: data.appointmentDetails, missingFields: [] });
      }
      setGuidedStep('completed');
      // Reset guided flow states
      setSelectedReason('');
      setSelectedDateTime({ display: '', raw: '' });
      setSelectedLocation('');
      setLLMDateSuggestions([]);
      setLLMLocationOptions([]);
    } catch (error) {
      console.error('Error confirming appointment:', error);
      setMessages(prev => [...prev, {
        type: 'assistant',
        text: 'Could not confirm appointment. Please try again.'
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  // ---- Microphone
  const handleMicClick = () => {
    if (!recognitionRef.current) {
      setMessages(prev => [...prev, {
        type: 'assistant',
        text: 'Speech recognition is not supported in your browser.'
      }]);
      return;
    }
    if (!navigator.onLine) {
      setMessages(prev => [...prev, {
        type: 'assistant',
        text: 'Your device appears to be offline. Speech recognition requires an internet connection.'
      }]);
      return;
    }
    if (isRecording) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error('Error stopping recognition:', e);
        setIsRecording(false);
      }
    } else {
      setInput('');
      try {
        recognitionRef.current.start();
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

  // ---- Render final confirmation if we have an appointment ID
  const renderAppointmentStatus = () => {
    const { details } = appointmentStatus;
    if (!details || !details.Id ) return null;

    // Log the details for debugging
    console.log('Appointment Details:', details);

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
            <div>{formatAppointmentTime(details.Appointment_Time__c) || '(Not specified)'}</div>
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
      {/* Toggle guided/unguided */}
      <div className="p-2 flex justify-end">
      </div>

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

      {/* Chat messages */}
      <div className="flex-1 p-4 overflow-y-auto">
        {messages.map((message, index) => (
          <div
            key={index}
            className={clsx(
              'mb-4 p-3 rounded-lg max-w-[85%]',
              message.type === 'user'
                ? 'ml-auto bg-[#CD1309] text-white'
                : 'mr-auto bg-gray-100 text-gray-800',
              message.isLoading && 'animate-pulse'
            )}
          >
            {message.text}
          </div>
        ))}
        {guidedStep !== 'completed' && renderAppointmentStatus()}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer: either guided steps or normal input */}
      <div className="p-4 border-t bg-gray-50">
        {isGuidedMode ? (
          <>
            {/* STEP 1: Reason */}
            {guidedStep === 'reason' && (
              <div className="mb-4">
                <p className="mb-2 font-medium">Please select a reason for your appointment:</p>
                <div className="flex flex-wrap gap-2">
                  {GUIDED_REASONS.map(option => (
                    <button
                      key={option}
                      onClick={() => handleReasonSelection(option)}
                      disabled={isProcessing}
                      className="px-4 py-2 bg-[#CD1309] text-white rounded-lg"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 2: Date/time */}
            {guidedStep === 'date' && (
              <div className="mb-4">
                <p className="mb-2 font-medium">Here are some suggested appointment slots:</p>
                {llmDateSuggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {llmDateSuggestions.map(slot => (
                      <button
                        key={slot.raw}
                        onClick={() => handleTimeSelection(slot)}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-[#CD1309] text-white rounded-lg"
                      >
                        {slot.display}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">Loading suggestions...</p>
                )}
              </div>
            )}

            {/* STEP 3: Location */}
            {guidedStep === 'location' && (
              <div className="mb-4">
                <p className="mb-2 font-medium">Please select a location for your appointment:</p>
                {llmLocationOptions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {llmLocationOptions.map(loc => (
                      <button
                        key={loc}
                        onClick={() => handleLocationSelection(loc)}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-[#CD1309] text-white rounded-lg"
                      >
                        {loc}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">Loading location options...</p>
                )}
              </div>
            )}

            {/* STEP 4: Confirmation */}
            {guidedStep === 'confirmation' && (
              <div className="mb-4">
                <p className="mb-2 font-medium">Review your details before confirming:</p>
                <div className="p-4 border rounded-lg bg-gray-100 text-sm space-y-1">
                  <p><strong>Reason:</strong> {selectedReason}</p>
                  <p><strong>Date/Time:</strong> {selectedDateTime.display}</p>
                  <p><strong>Location:</strong> {selectedLocation}</p>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleConfirmAppointment}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg"
                  >
                    Confirm Appointment
                  </button>
                  <button
                    onClick={() => {
                      setGuidedStep('reason');
                      setSelectedReason('');
                      setSelectedDateTime({ display: '', raw: '' });
                      setSelectedLocation('');
                      setLLMDateSuggestions([]);
                      setLLMLocationOptions([]);
                    }}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* STEP 5: Completed */}
            {guidedStep === 'completed' && (
              <div className="mb-4">
                {/* Show the detailed confirmation window */}
                {renderAppointmentStatus()}
                <button
                  onClick={() => {
                    setGuidedStep('reason');
                    setAppointmentStatus({ details: null, missingFields: [] });
                  }}
                  className="mt-4 px-4 py-2 bg-[#CD1309] text-white rounded-lg"
                >
                  Book Another Appointment
                </button>
              </div>
            )}

            {/* Always show free text input as fallback in guided mode */}
            <div className="flex space-x-2 mt-4">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Or type a message..."
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
          </>
        ) : (
          // Unguided flow
          <>
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
          </>
        )}
      </div>
    </div>
  );
};

// Optional CSS for pulse animation
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