import React, { useState, useRef, useEffect } from 'react';
import { Search, TrendingUp, Sparkles, X, ArrowUp, Zap } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// --- Trending Assistant Component ---
export const TrendingAssistant = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [messages, setMessages] = useState([]);
    const [isTyping, setIsTyping] = useState(false);
    const inputRef = useRef(null);
    const messagesEndRef = useRef(null);

    const suggestedPrompts = [
        "What's trending today?",
        "Show election related trends",
        "Analyze political content",
        "Show communal risk alerts"
    ];

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const handleSubmit = async (e) => {
        e?.preventDefault();
        if (!query.trim()) return;

        const userMsg = { role: 'user', content: query };
        setMessages(prev => [...prev, userMsg]);
        setQuery('');
        setIsTyping(true);

        // Simulate AI response
        setTimeout(() => {
            let responseContent = "I've analyzed the latest trends. ";
            if (query.toLowerCase().includes('election')) {
                responseContent += "Election discussions are spiking in Khairatabad (Up 45%). Key topics: by-poll preparations and roll revision.";
            } else if (query.toLowerCase().includes('communal')) {
                responseContent += "Communal sentiment is currently stable. No major inflammatory clusters detected in the last 6 hours.";
            } else {
                responseContent += "Current top trends: #RythuBharosa, #SaveMusi, and local political updates.";
            }

            const aiMsg = { role: 'assistant', content: responseContent };
            setMessages(prev => [...prev, aiMsg]);
            setIsTyping(false);
        }, 1500);
    };

    return (
        <div className="relative flex-1">
            <div
                className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border cursor-pointer hover:bg-muted/70 transition-colors"
                onClick={() => setIsOpen(true)}
            >
                <div className="h-5 w-5 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">AI</span>
                </div>
                <span className="text-sm text-muted-foreground">What's trending today?</span>
                <TrendingUp className="h-4 w-4 text-primary ml-auto" />
            </div>

            {/* Grok-Style Modal */}
            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[600px] sm:max-h-[80vh] bg-card border rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b bg-muted/30">
                            <div className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-primary" />
                                <span className="font-bold">Trending Assistant</span>
                                <Badge variant="secondary" className="text-[10px]">Beta</Badge>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsOpen(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Chat Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px]">
                            {messages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center opacity-70 mt-10">
                                    <div className="h-12 w-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
                                        <Zap className="h-6 w-6 text-primary" />
                                    </div>
                                    <h3 className="font-semibold mb-2">Ask about live trends</h3>
                                    <p className="text-sm text-muted-foreground max-w-xs mb-6">
                                        I can analyze millions of social posts to give you real-time insights.
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                                        {suggestedPrompts.map((p, i) => (
                                            <button
                                                key={i}
                                                onClick={() => { setQuery(p); handleSubmit(); }}
                                                className="text-xs p-2 bg-muted/50 hover:bg-muted border rounded-lg transition-colors text-left"
                                            >
                                                {p}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {messages.map((msg, idx) => (
                                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[80%] p-3 rounded-lg text-sm ${msg.role === 'user'
                                                ? 'bg-primary text-primary-foreground rounded-br-none'
                                                : 'bg-muted rounded-bl-none'
                                                }`}>
                                                {msg.content}
                                            </div>
                                        </div>
                                    ))}
                                    {isTyping && (
                                        <div className="flex justify-start">
                                            <div className="bg-muted p-3 rounded-lg rounded-bl-none flex gap-1">
                                                <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce" />
                                                <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce delay-75" />
                                                <span className="w-2 h-2 bg-foreground/30 rounded-full animate-bounce delay-150" />
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </>
                            )}
                        </div>

                        {/* Input Area */}
                        <div className="p-4 border-t bg-background">
                            <form onSubmit={handleSubmit} className="relative">
                                <input
                                    ref={inputRef}
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Ask anything..."
                                    className="w-full pl-4 pr-12 py-3 bg-muted/50 border rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                                />
                                <Button
                                    type="submit"
                                    size="icon"
                                    disabled={!query.trim() || isTyping}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                                >
                                    <ArrowUp className="h-4 w-4" />
                                </Button>
                            </form>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

// --- Platform Selector Component ---
export const PlatformSelector = ({ selected, onChange }) => {
    return (
        <Select value={selected} onValueChange={onChange}>
            <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="twitter">X (Twitter)</SelectItem>
                <SelectItem value="facebook">Facebook</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="youtube">YouTube</SelectItem>
            </SelectContent>
        </Select>
    );
};

// --- Category Selector Component ---
export const CategorySelector = ({ selected, onChange }) => {
    return (
        <Select value={selected} onValueChange={onChange}>
            <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="political">Political</SelectItem>
                <SelectItem value="communal">Communal</SelectItem>
                <SelectItem value="law_and_order">Law & Order</SelectItem>
            </SelectContent>
        </Select>
    );
};

// --- Status Selector Component ---
export const StatusSelector = ({ selected, onChange }) => {
    return (
        <Select value={selected} onValueChange={onChange}>
            <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="reported">Reported</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
        </Select>
    );
};
