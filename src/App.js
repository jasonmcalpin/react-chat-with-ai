import { useState, useEffect, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import './App.css';

const OLLAMA_API = 'http://localhost:11434';
const STORAGE_KEY = 'ollama-chat';
const LEGACY_STORAGE_KEY = 'ollama-multi-chat';

export default function App() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [input, setInput] = useState('');
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [showSystemPanel, setShowSystemPanel] = useState(false);

  const [sessions, setSessions] = useState(() => {
    let stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);

    // Try legacy key
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      localStorage.setItem(STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return JSON.parse(legacy);
    }
    return {};
  });

  const [activeSessionId, setActiveSessionId] = useState(() => {
    let stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const keys = Object.keys(JSON.parse(stored));
      return keys[0] || null;
    }
    // Try legacy key
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const keys = Object.keys(JSON.parse(legacy));
      return keys[0] || null;
    }
    return null;
  });

  const messagesEndRef = useRef(null);

  const conversation = useMemo(() => {
    return sessions[activeSessionId]?.messages || [];
  }, [sessions, activeSessionId]);

  const systemPrompt = sessions[activeSessionId]?.system || '';

  useEffect(() => {
    document.documentElement.className = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'));

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    fetch(`${OLLAMA_API}/api/tags`)
      .then(res => res.json())
      .then(data => {
        const modelNames = data.models.map(m => m.name);
        setModels(modelNames);
        if (modelNames.length > 0) setSelectedModel(modelNames[0]);
      })
      .catch(console.error);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || !activeSessionId) return;

    const userMessage = { role: 'user', content: input };
    setInput('');

    setSessions(prev => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        messages: [...prev[activeSessionId].messages, userMessage],
      },
    }));

    const messagesToSend = [
      ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }] : []),
      ...(sessions[activeSessionId]?.messages || []),
      userMessage,
    ];

    const res = await fetch(`${OLLAMA_API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: selectedModel,
        messages: messagesToSend,
        stream: true,
      }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let assistantContent = '';
    const assistantMessage = { role: 'assistant', content: '' };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.done) break;
          if (json.message?.content) {
            assistantContent += json.message.content;
            assistantMessage.content = assistantContent;

            setSessions(prev => {
              const current = prev[activeSessionId];
              const msgs = current.messages;
              const last = msgs[msgs.length - 1];

              const updatedMsgs = last?.role === 'assistant'
                ? [...msgs.slice(0, -1), { ...assistantMessage }]
                : [...msgs, { ...assistantMessage }];

              return {
                ...prev,
                [activeSessionId]: {
                  ...current,
                  messages: updatedMsgs,
                },
              };
            });
          }
        } catch {
          // Ignore parse error
        }
      }
    }
  };

  const createSession = () => {
    const id = Date.now().toString();
    const name = `Chat ${Object.keys(sessions).length + 1}`;
    const newSessions = {
      ...sessions,
      [id]: { name, messages: [], system: '' },
    };
    setSessions(newSessions);
    setActiveSessionId(id);
  };

  const deleteSession = (e, id) => {
    e.stopPropagation();
    const updated = { ...sessions };
    delete updated[id];
    setSessions(updated);
    if (activeSessionId === id) {
      const remaining = Object.keys(updated);
      setActiveSessionId(remaining[0] || null);
    }
  };

  const renameSession = (id, newName) => {
    setSessions(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        name: newName,
      },
    }));
  };

  const updateSystemPrompt = (e) => {
    const newPrompt = e.target.value;
    setSessions(prev => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        system: newPrompt,
      },
    }));
  };

  return (
    <div className="chat-container">
      <div className="chat-sidebar">
        <button onClick={createSession}>➕ New</button>
        {Object.entries(sessions).map(([id, session]) => (
          <div
            key={id}
            className={`chat-session ${id === activeSessionId ? 'active' : ''}`}
            onClick={() => {
              if (editingSessionId !== id) setActiveSessionId(id);
            }}
          >
            {editingSessionId === id ? (
              <input
                autoFocus
                className="session-edit"
                value={session.name}
                onChange={(e) => renameSession(id, e.target.value)}
                onBlur={() => setEditingSessionId(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setEditingSessionId(null);
                }}
              />
            ) : (
              <span onDoubleClick={() => setEditingSessionId(id)}>
                {session.name}
              </span>
            )}
            <button
              onClick={(e) => deleteSession(e, id)}
              title="Delete session"
            >
              🗑
            </button>
          </div>
        ))}
      </div>

      <div className="chat-main">
        <div className="chat-header">
          <h1>Ollama Chat</h1>
          <label>
            Model:
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <button onClick={toggleTheme} className="theme-toggle">
            {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
          </button>
          <button onClick={() => setShowSystemPanel(s => !s)}>
            {showSystemPanel ? '📂 Hide Prompt' : '⚙️ System Prompt'}
          </button>
        </div>

        {showSystemPanel && (
          <div className="system-panel">
            <textarea
              value={systemPrompt}
              onChange={updateSystemPrompt}
              placeholder="System prompt: how should the AI behave?"
            />
          </div>
        )}

        <div className="chat-history">
          {conversation.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="message-role">
                {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'AI' : 'System'}
              </div>
              <ReactMarkdown
                children={msg.content}
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              />
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-input" onSubmit={handleSubmit}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type your message..."
          />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  );
}