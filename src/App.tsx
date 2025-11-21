
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Layout } from './components/Layout';
import { Sidebar } from './components/Sidebar';
import { JournalEditor } from './components/JournalEditor';
import { JournalTable } from './components/JournalTable';
import { JournalEntry } from './types';
import { GOOGLE_CLIENT_ID, SCOPES, AUTOSAVE_INTERVAL_MS } from './constants';
import { syncEntryToDrive, deleteEntryFromDrive, AUTH_ERROR_MSG } from './services/driveService';
import { getAllEntries, saveEntry, deleteEntry } from './services/storage';
import { Cloud, Settings, AlertCircle, Loader2, Trash2, Smartphone, Globe, Copy, Check } from 'lucide-react';

export default function App() {
  // --- State ---
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [viewMode, setViewMode] = useState<'editor' | 'table'>('editor'); // New View State
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [clientId, setClientId] = useState(localStorage.getItem('zenjournal_client_id') || GOOGLE_CLIENT_ID);
  const [showSetup, setShowSetup] = useState(!clientId || clientId === 'YOUR_CLIENT_ID');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Delete Confirmation State
  const [entryToDelete, setEntryToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // --- Refs ---
  const tokenClient = useRef<any>(null);
  const lastSavedHash = useRef<string>('');
  const saveTimeoutRef = useRef<any>(null);

  // --- Initialization ---
  useEffect(() => {
    // Load Local Data
    loadLocalEntries();

    // Restore Google Session if valid
    const storedToken = localStorage.getItem('zenjournal_token');
    const storedExpiry = localStorage.getItem('zenjournal_token_expiry');

    if (storedToken && storedExpiry) {
      const now = Date.now();
      // Check if token is still valid (with 60s buffer)
      if (now < parseInt(storedExpiry, 10) - 60000) {
        setAccessToken(storedToken);
        setIsLoggedIn(true);
      } else {
        // Expired, clean up
        localStorage.removeItem('zenjournal_token');
        localStorage.removeItem('zenjournal_token_expiry');
      }
    }

    // Initialize Google OAuth if Client ID is present
    if (clientId && (window as any).google) {
      initGoogleAuth(clientId);
    }
  }, [clientId]);

  const initGoogleAuth = (cid: string) => {
    try {
      tokenClient.current = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: SCOPES,
        callback: (response: any) => {
          if (response.access_token) {
            // Default to 1 hour if expires_in is missing
            const expiresInSeconds = response.expires_in || 3599;
            const expiryTime = Date.now() + (expiresInSeconds * 1000);

            setAccessToken(response.access_token);
            setIsLoggedIn(true);

            // Save session to local storage
            localStorage.setItem('zenjournal_token', response.access_token);
            localStorage.setItem('zenjournal_token_expiry', expiryTime.toString());
          }
        },
      });
    } catch (e) {
      console.error("Failed to init Google Auth", e);
    }
  };

  // --- Data Methods ---
  const loadLocalEntries = async () => {
    const loaded = await getAllEntries();
    setEntries(loaded);
    if (loaded.length > 0 && !activeEntry) {
      setActiveEntry(loaded[0]);
      lastSavedHash.current = JSON.stringify(loaded[0]);
    }
  };

  const createNewEntry = () => {
    const newEntry: JournalEntry = {
      id: Date.now().toString(),
      title: '',
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      images: []
    };
    
    setEntries([newEntry, ...entries]);
    setActiveEntry(newEntry);
    setViewMode('editor'); // Switch to editor on create
    lastSavedHash.current = JSON.stringify(newEntry);
    
    // Save immediately to local
    saveEntry(newEntry);
  };

  const handleRequestDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setEntryToDelete(id);
  };

  const confirmDelete = async () => {
    if (!entryToDelete) return;
    
    setIsDeleting(true);

    const entry = entries.find(e => e.id === entryToDelete);

    if (entry && accessToken) {
      try {
        await deleteEntryFromDrive(entry, accessToken);
      } catch (e: any) {
        console.error("Failed to delete from Drive", e);
        if (e.message === AUTH_ERROR_MSG) {
          handleLogout();
          alert("Session expired while deleting. Please reconnect.");
        }
      }
    }
    
    await deleteEntry(entryToDelete);
    const newEntries = entries.filter(x => x.id !== entryToDelete);
    setEntries(newEntries);
    
    if (activeEntry?.id === entryToDelete) {
      setActiveEntry(newEntries[0] || null);
    }
    
    setIsDeleting(false);
    setEntryToDelete(null);
  };

  // --- Save Logic ---
  const handleUpdateEntry = (updated: JournalEntry) => {
    const entryWithTimestamp = { ...updated, updatedAt: Date.now() };
    
    setActiveEntry(entryWithTimestamp);
    
    setEntries(prev => {
      const updatedList = prev.map(e => e.id === entryWithTimestamp.id ? entryWithTimestamp : e);
      return updatedList.sort((a, b) => b.updatedAt - a.updatedAt);
    });

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    
    saveTimeoutRef.current = setTimeout(() => {
      performSave(entryWithTimestamp);
    }, AUTOSAVE_INTERVAL_MS);
  };

  const performSave = async (entry: JournalEntry) => {
    const currentHash = JSON.stringify({ t: entry.title, c: entry.content, i: entry.images, m: entry.mood });
    if (currentHash === lastSavedHash.current) return;

    setIsSaving(true);
    try {
      await saveEntry(entry);
      lastSavedHash.current = currentHash;

      if (accessToken) {
        setIsSyncing(true);
        await syncEntryToDrive(entry, accessToken);
      }
    } catch (err: any) {
      console.error("Save failed", err);
      if (err.message === AUTH_ERROR_MSG) {
        handleLogout();
        console.warn("Session expired. Disconnected from Drive.");
      }
    } finally {
      setIsSaving(false);
      setIsSyncing(false);
    }
  };

  // --- Auth Methods ---
  const handleLogin = () => {
    if (tokenClient.current) {
      tokenClient.current.requestAccessToken();
    } else {
      alert("Google Auth not initialized. Please check your Client ID in settings.");
    }
  };

  const handleLogout = () => {
    if (accessToken && (window as any).google) {
      try {
        (window as any).google.accounts.oauth2.revoke(accessToken, () => {});
      } catch (e) {
        console.error("Revoke failed", e);
      }
    }
    
    localStorage.removeItem('zenjournal_token');
    localStorage.removeItem('zenjournal_token_expiry');
    setAccessToken(null);
    setIsLoggedIn(false);
  };

  const handleSaveClientId = (id: string) => {
    localStorage.setItem('zenjournal_client_id', id);
    setClientId(id);
    setShowSetup(false);
    window.location.reload();
  };

  const [copied, setCopied] = useState(false);
  const copyOrigin = () => {
      navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  }

  // --- Views ---

  if (showSetup) {
    const currentOrigin = window.location.origin;
    const isLocal = currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1');

    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-stone-100 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-center mb-6">
            <div className="bg-stone-100 p-4 rounded-full">
              <Settings className="w-8 h-8 text-stone-600" />
            </div>
          </div>
          <h1 className="text-2xl font-serif font-bold text-center text-ink mb-2">Setup ZenJournal</h1>
          <p className="text-stone-500 text-center mb-6 text-sm">
            Configure Google Cloud to enable syncing across devices.
          </p>
          
          <div className="mb-6 bg-amber-50 border border-amber-100 rounded-lg p-4">
             <div className="flex items-start gap-3">
                 <Globe className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                 <div className="flex-1">
                    <h3 className="text-sm font-bold text-amber-900 mb-1">Authorize This Website</h3>
                    <p className="text-xs text-amber-800 leading-relaxed mb-2">
                        You must add this exact URL to "Authorized JavaScript origins" in your Google Cloud Console for login to work.
                    </p>
                    <div className="flex items-center bg-white border border-amber-200 rounded px-2 py-1.5">
                        <code className="text-xs text-stone-600 flex-1 overflow-hidden text-ellipsis font-mono">{currentOrigin}</code>
                        <button onClick={copyOrigin} className="text-amber-600 hover:text-amber-800 p-1">
                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </button>
                    </div>
                 </div>
             </div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleSaveClientId((e.target as any).cid.value); }}>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">Google Client ID</label>
            <input 
              name="cid"
              defaultValue={clientId === 'YOUR_CLIENT_ID' ? '' : clientId}
              placeholder="12345...apps.googleusercontent.com"
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-400 mb-4 font-mono"
              required
            />
            
            <div className="bg-blue-50 text-blue-800 p-4 rounded-lg text-xs mb-6 leading-relaxed">
              <strong>Instructions:</strong><br/>
              1. Go to <a href="https://console.cloud.google.com/" target="_blank" className="underline">Google Cloud Console</a>.<br/>
              2. Create a Project &gt; APIs &amp; Services &gt; Credentials.<br/>
              3. Create "OAuth Client ID" &gt; Web Application.<br/>
              4. Paste <code className="bg-blue-100 px-1 rounded">{currentOrigin}</code> into "Authorized JavaScript origins".
            </div>

            {isLocal && (
                <div className="mb-6 p-4 border border-stone-200 rounded-lg bg-stone-50">
                    <div className="flex items-center gap-2 mb-2 text-stone-800 font-bold text-xs uppercase tracking-wider">
                        <Smartphone className="w-4 h-4" />
                        Want to use on Mobile?
                    </div>
                    <p className="text-xs text-stone-500 mb-3">
                        You are currently on Localhost. To use this on your phone:
                    </p>
                    <ol className="list-decimal list-inside text-xs text-stone-600 space-y-1 mb-3">
                        <li>Drag this project folder to <strong>Netlify Drop</strong> or deploy to <strong>Vercel</strong>.</li>
                        <li>Open the new link they give you (e.g., my-app.netlify.app).</li>
                        <li>Add that NEW link to Google Cloud Console.</li>
                    </ol>
                </div>
            )}

            <button className="w-full bg-stone-900 text-white font-bold py-3 rounded-lg hover:bg-stone-800 transition-colors shadow-lg">
              Save & Connect
            </button>
            
            <button 
              type="button"
              onClick={() => setShowSetup(false)}
              className="w-full mt-3 text-stone-400 text-xs hover:text-stone-600 underline"
            >
              Skip (Offline Mode Only)
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <div className="flex h-screen w-full bg-paper fade-in overflow-hidden">
        
        <div className={`fixed inset-y-0 left-0 z-30 transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 transition-transform duration-300 ease-in-out h-full flex`}>
          <Sidebar 
            entries={entries}
            activeId={activeEntry?.id || null}
            viewMode={viewMode}
            onViewChange={setViewMode}
            onSelect={(entry) => { setActiveEntry(entry); setViewMode('editor'); setIsMobileMenuOpen(false); }}
            onCreate={createNewEntry}
            onDelete={handleRequestDelete}
            isLoggedIn={isLoggedIn}
            isSyncing={isSyncing}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onResetConfig={() => setShowSetup(true)}
          />
        </div>

        {isMobileMenuOpen && (
          <div 
            className="fixed inset-0 bg-black/20 z-20 md:hidden backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          ></div>
        )}

        <main className="flex-grow flex flex-col h-full relative w-full">
            <div className="md:hidden absolute top-4 left-4 z-10">
                <button 
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="p-2 bg-white border border-stone-200 rounded-full shadow-sm text-stone-600"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                </button>
            </div>

            {/* MAIN AREA LOGIC */}
            {viewMode === 'table' ? (
                 <JournalTable 
                    entries={entries} 
                    onSelect={(entry) => { setActiveEntry(entry); setViewMode('editor'); }}
                    onDelete={handleRequestDelete}
                 />
            ) : activeEntry ? (
                <JournalEditor 
                    entry={activeEntry} 
                    onUpdate={handleUpdateEntry}
                    isSaving={isSaving}
                />
            ) : (
                <div className="flex flex-col items-center justify-center h-full text-stone-300">
                    <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mb-4">
                        <Settings className="w-8 h-8 text-stone-300" />
                    </div>
                    <p className="text-lg font-serif">Select an entry or create a new one</p>
                </div>
            )}
        </main>

        {entryToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/20 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl border border-stone-100 p-6 max-w-sm w-full transform transition-all scale-100">
              <div className="flex items-center space-x-3 mb-4 text-red-600">
                <div className="p-2 bg-red-50 rounded-full">
                  <Trash2 className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-stone-900">Delete Entry?</h3>
              </div>
              
              <p className="text-stone-600 text-sm leading-relaxed mb-6">
                Are you sure you want to delete this journal entry? This action cannot be undone.
              </p>
              
              <div className="flex justify-end space-x-3">
                <button 
                  onClick={() => !isDeleting && setEntryToDelete(null)}
                  disabled={isDeleting}
                  className="px-4 py-2.5 text-stone-600 text-sm font-medium hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDelete}
                  disabled={isDeleting}
                  className="px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 shadow-sm transition-colors flex items-center disabled:bg-red-400"
                >
                  {isDeleting ? (
                    <>
                       <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting...
                    </>
                  ) : (
                    "Yes, Delete"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
