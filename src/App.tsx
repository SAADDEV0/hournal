
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Layout } from './components/Layout';
import { Sidebar } from './components/Sidebar';
import { JournalEditor } from './components/JournalEditor';
import { JournalTable } from './components/JournalTable';
import { JournalEntry } from './types';
import { GOOGLE_CLIENT_ID, SCOPES, AUTOSAVE_INTERVAL_MS } from './constants';
import { syncEntryToDrive, deleteEntryFromDrive, fetchAllEntriesFromDrive, AUTH_ERROR_MSG } from './services/driveService';
import { getAllEntries, saveEntry, deleteEntry } from './services/storage';
import { Cloud, Settings, AlertCircle, Loader2, Trash2, Smartphone, Globe, Copy, Check, RefreshCw, CloudUpload } from 'lucide-react';

export default function App() {
  // --- State ---
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [viewMode, setViewMode] = useState<'editor' | 'table'>('editor');
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

  // Save To Cloud Modal State
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveFileName, setSaveFileName] = useState('');

  // --- Refs ---
  const tokenClient = useRef<any>(null);
  const lastSavedHash = useRef<string>('');
  const saveTimeoutRef = useRef<any>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef<JournalEntry | null>(null);

  // --- Initialization ---
  useEffect(() => {
    loadLocalEntries();

    const storedToken = localStorage.getItem('zenjournal_token');
    const storedExpiry = localStorage.getItem('zenjournal_token_expiry');

    if (storedToken && storedExpiry) {
      const now = Date.now();
      if (now < parseInt(storedExpiry, 10) - 60000) {
        setAccessToken(storedToken);
        setIsLoggedIn(true);
      } else {
        localStorage.removeItem('zenjournal_token');
        localStorage.removeItem('zenjournal_token_expiry');
      }
    }

    // Robust Google Auth Initialization
    // We poll for the google object in case the script loads asynchronously later
    if (clientId) {
        const checkGoogle = setInterval(() => {
            if ((window as any).google && (window as any).google.accounts) {
                clearInterval(checkGoogle);
                initGoogleAuth(clientId);
            }
        }, 500);
        
        // Timeout after 10 seconds to stop checking
        setTimeout(() => clearInterval(checkGoogle), 10000);
    }
  }, [clientId]);

  // Trigger Cloud Sync when logged in
  useEffect(() => {
    if (isLoggedIn && accessToken) {
        // Small delay to ensure UI is ready
        setTimeout(() => handleCloudSync(), 500);
    }
  }, [isLoggedIn, accessToken]);

  const initGoogleAuth = (cid: string) => {
    try {
      if (!tokenClient.current) {
          console.log("Initializing Google Token Client...");
          tokenClient.current = (window as any).google.accounts.oauth2.initTokenClient({
            client_id: cid,
            scope: SCOPES,
            callback: (response: any) => {
              if (response.access_token) {
                const expiresInSeconds = response.expires_in || 3599;
                const expiryTime = Date.now() + (expiresInSeconds * 1000);

                setAccessToken(response.access_token);
                setIsLoggedIn(true);

                localStorage.setItem('zenjournal_token', response.access_token);
                localStorage.setItem('zenjournal_token_expiry', expiryTime.toString());
              }
            },
          });
      }
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
      lastSavedHash.current = JSON.stringify({ t: loaded[0].title, c: loaded[0].content, i: loaded[0].images, m: loaded[0].mood });
    }
  };

  const handleCloudSync = async () => {
      if (!accessToken) return;
      setIsSyncing(true);
      try {
          const cloudEntries = await fetchAllEntriesFromDrive(accessToken);
          
          const localMap = new Map<string, JournalEntry>(entries.map(e => [e.id, e]));
          let hasChanges = false;
          const mergedEntries = [...entries];

          for (const cloudEntry of cloudEntries) {
              const localEntry = localMap.get(cloudEntry.id);
              if (!localEntry) {
                  mergedEntries.push(cloudEntry);
                  await saveEntry(cloudEntry);
                  hasChanges = true;
              } else if (cloudEntry.updatedAt > localEntry.updatedAt) {
                  const index = mergedEntries.findIndex(e => e.id === cloudEntry.id);
                  if (index !== -1) {
                      mergedEntries[index] = cloudEntry;
                      await saveEntry(cloudEntry);
                      hasChanges = true;
                  }
              }
          }
          
          if (hasChanges) {
              mergedEntries.sort((a, b) => b.updatedAt - a.updatedAt);
              setEntries(mergedEntries);
              if (activeEntry) {
                 const updatedActive = mergedEntries.find(e => e.id === activeEntry.id);
                 if (updatedActive && updatedActive.updatedAt !== activeEntry.updatedAt) {
                     setActiveEntry(updatedActive);
                 }
              } else if (mergedEntries.length > 0) {
                  setActiveEntry(mergedEntries[0]);
              }
          }

      } catch (err) {
          console.error("Cloud sync failed", err);
      } finally {
          setIsSyncing(false);
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
    setViewMode('editor'); 
    lastSavedHash.current = JSON.stringify({ t: newEntry.title, c: newEntry.content, i: newEntry.images, m: newEntry.mood });
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

  // --- Manual Save Logic ---
  const handleManualSaveRequest = () => {
    console.log("Manual save requested");
    if (!isLoggedIn) {
        console.log("User not logged in, attempting login...");
        handleLogin();
        return;
    }
    if (!activeEntry) return;
    
    // Default filename
    const safeTitle = activeEntry.title.replace(/[/\\?%*:|"<>\x00-\x1F]/g, '_').trim() || 'Untitled';
    const defaultName = activeEntry.driveFileName || `${safeTitle}.txt`;
    
    setSaveFileName(defaultName);
    setShowSaveModal(true);
  };

  const confirmManualSave = async () => {
    if (!activeEntry || !accessToken) return;
    
    // Update entry with the preferred filename
    const updatedEntry = { ...activeEntry, driveFileName: saveFileName };
    setActiveEntry(updatedEntry);
    setEntries(prev => prev.map(e => e.id === updatedEntry.id ? updatedEntry : e));
    await saveEntry(updatedEntry); // Save preference locally
    
    setShowSaveModal(false);
    setIsSaving(true);
    
    try {
        await syncEntryToDrive(updatedEntry, accessToken);
    } catch (err: any) {
        if (err.message === AUTH_ERROR_MSG) handleLogout();
        console.error("Manual save failed", err);
        alert("Failed to save to Drive. Please check connection.");
    } finally {
        setIsSaving(false);
    }
  };

  // --- Auto Save Logic ---
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
    if (currentHash === lastSavedHash.current && !pendingSaveRef.current) return;

    if (isSavingRef.current) {
        pendingSaveRef.current = entry;
        return;
    }

    isSavingRef.current = true;
    setIsSaving(true);

    try {
      await saveEntry(entry);
      lastSavedHash.current = currentHash;
      if (accessToken) {
        await syncEntryToDrive(entry, accessToken);
      }
    } catch (err: any) {
      if (err.message === AUTH_ERROR_MSG) {
        handleLogout();
      }
    } finally {
      setIsSaving(false);
      isSavingRef.current = false;

      const nextEntry = pendingSaveRef.current;
      pendingSaveRef.current = null;

      if (nextEntry) {
          performSave(nextEntry);
      }
    }
  };

  // --- Auth Methods ---
  const handleLogin = () => {
    if (tokenClient.current) {
      tokenClient.current.requestAccessToken();
    } else {
      // Try to init immediately if missed
      if ((window as any).google) {
         initGoogleAuth(clientId);
         // Retry request after short delay
         setTimeout(() => {
             if(tokenClient.current) tokenClient.current.requestAccessToken();
             else alert("Google Auth service not ready. Please refresh or check internet.");
         }, 500);
      } else {
         alert("Google Auth script not loaded. Please check internet connection.");
      }
    }
  };

  const handleLogout = () => {
    if (accessToken && (window as any).google) {
      try { (window as any).google.accounts.oauth2.revoke(accessToken, () => {}); } catch (e) {}
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

  // --- Setup View ---
  if (showSetup) {
    const currentOrigin = window.location.origin;
    const isLocal = currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1');

    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-stone-100 max-h-[90vh] overflow-y-auto">
          {/* Setup Form Content */}
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
                        Add this URL to "Authorized JavaScript origins" in Google Cloud Console.
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
            </div>

            {isLocal && (
                <div className="mb-6 p-4 border border-stone-200 rounded-lg bg-stone-50">
                    <div className="flex items-center gap-2 mb-2 text-stone-800 font-bold text-xs uppercase tracking-wider">
                        <Smartphone className="w-4 h-4" />
                        Mobile Testing
                    </div>
                    <p className="text-xs text-stone-500">
                        To use on phone, deploy to Netlify/Vercel and add the new URL to Google Cloud.
                    </p>
                </div>
            )}

            <button className="w-full bg-stone-900 text-white font-bold py-3 rounded-lg hover:bg-stone-800 transition-colors shadow-lg">
              Save & Connect
            </button>
            
            <button type="button" onClick={() => setShowSetup(false)} className="w-full mt-3 text-stone-400 text-xs hover:text-stone-600 underline">
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
            onSelect={(entry) => { 
                setActiveEntry(entry); 
                setViewMode('editor'); 
                setIsMobileMenuOpen(false); 
                lastSavedHash.current = JSON.stringify({ t: entry.title, c: entry.content, i: entry.images, m: entry.mood });
            }}
            onCreate={createNewEntry}
            onDelete={handleRequestDelete}
            isLoggedIn={isLoggedIn}
            isSyncing={isSyncing}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onSync={handleCloudSync}
            onResetConfig={() => setShowSetup(true)}
          />
        </div>

        {isMobileMenuOpen && (
          <div className="fixed inset-0 bg-black/20 z-20 md:hidden backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}></div>
        )}

        <main className="flex-grow flex flex-col h-full relative w-full">
            <div className="md:hidden absolute top-4 left-4 z-10">
                <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 bg-white border border-stone-200 rounded-full shadow-sm text-stone-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
                </button>
            </div>

            {viewMode === 'table' ? (
                 <JournalTable 
                    entries={entries} 
                    onSelect={(entry) => { 
                        setActiveEntry(entry); 
                        setViewMode('editor');
                        lastSavedHash.current = JSON.stringify({ t: entry.title, c: entry.content, i: entry.images, m: entry.mood });
                    }}
                    onDelete={handleRequestDelete}
                 />
            ) : activeEntry ? (
                <JournalEditor 
                    entry={activeEntry} 
                    onUpdate={handleUpdateEntry}
                    onSaveToCloud={handleManualSaveRequest}
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

        {/* Delete Confirmation Modal */}
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
                <button onClick={() => !isDeleting && setEntryToDelete(null)} disabled={isDeleting} className="px-4 py-2.5 text-stone-600 text-sm font-medium hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={confirmDelete} disabled={isDeleting} className="px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 shadow-sm transition-colors flex items-center disabled:bg-red-400">
                  {isDeleting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Deleting...</>) : "Yes, Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Save To Cloud Modal */}
        {showSaveModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-stone-900/20 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl border border-stone-100 p-6 max-w-sm w-full transform transition-all scale-100">
              <div className="flex items-center space-x-3 mb-4 text-stone-900">
                <div className="p-2 bg-stone-100 rounded-full">
                  <CloudUpload className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-stone-900">Save to Drive</h3>
              </div>
              
              <p className="text-stone-500 text-sm mb-4">
                 Choose a filename for this entry.
              </p>

              <div className="mb-6">
                  <label className="block text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">Filename</label>
                  <input 
                    type="text" 
                    value={saveFileName} 
                    onChange={(e) => setSaveFileName(e.target.value)}
                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-400 font-mono"
                  />
                  <p className="text-[10px] text-stone-400 mt-1 text-right">.txt will be added automatically if missing</p>
              </div>
              
              <div className="flex justify-end space-x-3">
                <button 
                  onClick={() => setShowSaveModal(false)}
                  className="px-4 py-2.5 text-stone-600 text-sm font-medium hover:bg-stone-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmManualSave}
                  className="px-4 py-2.5 bg-stone-900 text-white text-sm font-medium rounded-lg hover:bg-stone-700 shadow-sm transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </Layout>
  );
}
