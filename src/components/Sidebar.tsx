
import React, { useState } from 'react';
import { Plus, Trash2, BookOpen, Cloud, CloudOff, LogOut, Settings, Loader2, Filter, Table as TableIcon, List, RefreshCw } from 'lucide-react';
import { JournalEntry, Mood } from '../types';

interface SidebarProps {
  entries: JournalEntry[];
  activeId: string | null;
  viewMode: 'editor' | 'table';
  onViewChange: (mode: 'editor' | 'table') => void;
  onSelect: (entry: JournalEntry) => void;
  onCreate: () => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  isLoggedIn: boolean;
  isSyncing: boolean;
  onLogin: () => void;
  onLogout: () => void;
  onSync?: () => void;
  onResetConfig: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
  entries, 
  activeId, 
  viewMode,
  onViewChange,
  onSelect, 
  onCreate, 
  onDelete,
  isLoggedIn,
  isSyncing,
  onLogin,
  onLogout,
  onSync,
  onResetConfig
}) => {
  
  const [filterMood, setFilterMood] = useState<Mood | 'All'>('All');

  const moodConfig: Record<Mood, { icon: string, className: string, label: string }> = {
    'Great': { icon: '😁', className: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Great' },
    'Good': { icon: '🙂', className: 'bg-sky-100 text-sky-700 border-sky-200', label: 'Good' },
    'Okay': { icon: '😐', className: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Okay' },
    'Bad': { icon: '☹️', className: 'bg-rose-100 text-rose-700 border-rose-200', label: 'Bad' }
  };

  // Filter entries based on selection
  const filteredEntries = entries.filter(entry => {
    if (filterMood === 'All') return true;
    return entry.mood === filterMood;
  });

  return (
    <div className="w-full md:w-80 bg-white border-r border-stone-200 h-full flex flex-col flex-shrink-0 z-20 shadow-lg md:shadow-none">
      {/* Sidebar Header */}
      <div className="p-5 border-b border-stone-100 flex justify-between items-center bg-white sticky top-0 z-10">
        <div className="flex items-center space-x-2 text-ink font-serif font-bold text-lg">
          <BookOpen className="w-5 h-5 text-stone-500" />
          <span>Library</span>
          {isLoggedIn && (
            <button 
                onClick={onSync} 
                disabled={isSyncing}
                className={`ml-2 p-1.5 rounded-full bg-stone-50 hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-all ${isSyncing ? 'animate-spin text-stone-600' : ''}`}
                title="Analyze & Sync from Drive"
            >
                {isSyncing ? <Loader2 className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
            </button>
          )}
        </div>
        
        <div className="flex gap-2">
            {/* View Toggle */}
            <div className="flex bg-stone-100 rounded-lg p-0.5">
                <button 
                    onClick={() => onViewChange('editor')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'editor' ? 'bg-white shadow-sm text-ink' : 'text-stone-400 hover:text-stone-600'}`}
                    title="List View"
                >
                    <List className="w-4 h-4" />
                </button>
                <button 
                    onClick={() => onViewChange('table')}
                    className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white shadow-sm text-ink' : 'text-stone-400 hover:text-stone-600'}`}
                    title="Sheet View"
                >
                    <TableIcon className="w-4 h-4" />
                </button>
            </div>

            <button 
            onClick={onCreate}
            className="p-2 bg-stone-900 text-white rounded-full hover:bg-stone-700 transition-colors shadow-sm active:scale-95 transform ml-2"
            title="New Entry"
            >
            <Plus className="w-4 h-4" />
            </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-4 py-3 border-b border-stone-50 flex gap-2 overflow-x-auto no-scrollbar items-center">
         <button
            onClick={() => setFilterMood('All')}
            className={`
                px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap border
                ${filterMood === 'All' 
                    ? 'bg-stone-800 text-white border-stone-800' 
                    : 'bg-white text-stone-500 border-stone-200 hover:bg-stone-50'
                }
            `}
         >
            All
         </button>
         {(Object.keys(moodConfig) as Mood[]).map((m) => (
             <button
                key={m}
                onClick={() => setFilterMood(filterMood === m ? 'All' : m)}
                className={`
                    px-2 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap border flex items-center gap-1
                    ${filterMood === m
                        ? moodConfig[m].className + ' ring-1 ring-offset-1 ring-stone-200' // Active style
                        : 'bg-white text-stone-400 border-stone-100 hover:bg-stone-50 grayscale hover:grayscale-0' // Inactive style
                    }
                `}
                title={`Filter by ${m}`}
             >
                <span>{moodConfig[m].icon}</span>
                {filterMood === m && <span>{m}</span>}
             </button>
         ))}
      </div>

      {/* Entry List */}
      <div className="flex-grow overflow-y-auto p-3 space-y-2 scrollbar-thin">
        {entries.length === 0 ? (
          <div className="text-center py-10 text-stone-400 text-sm px-4">
            <p>No entries yet.</p>
            <p className="mt-2">Click + to start writing.</p>
          </div>
        ) : filteredEntries.length === 0 ? (
           <div className="text-center py-10 text-stone-400 text-sm px-4">
            <div className="w-10 h-10 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <Filter className="w-4 h-4 text-stone-300" />
            </div>
            <p>No entries found with this mood.</p>
            <button onClick={() => setFilterMood('All')} className="mt-2 text-stone-600 underline text-xs">Clear filter</button>
          </div> 
        ) : (
          filteredEntries.map(entry => {
            const isActive = activeId === entry.id && viewMode === 'editor';
            // Format date for Morocco
            const dateStr = new Date(entry.createdAt).toLocaleDateString('en-GB', { 
                timeZone: 'Africa/Casablanca',
                month: 'short', 
                day: 'numeric' 
            });

            return (
              <div 
                key={entry.id}
                onClick={() => onSelect(entry)}
                className={`
                  group relative p-4 rounded-xl cursor-pointer transition-all duration-200 border select-none
                  ${isActive
                    ? 'bg-stone-100 border-stone-200 shadow-sm' 
                    : 'bg-white border-transparent hover:bg-stone-50 hover:border-stone-100'
                  }
                `}
              >
                <div className="flex justify-between items-start mb-1">
                    <h3 className={`font-semibold text-sm truncate flex-1 ${isActive ? 'text-ink' : 'text-stone-700'}`}>
                    {entry.title || "Untitled Entry"}
                    </h3>
                    {entry.mood && moodConfig[entry.mood] && (
                        <div 
                            className={`ml-2 px-1.5 py-0.5 rounded-full border text-[10px] font-medium flex items-center gap-1 shadow-sm shrink-0 ${moodConfig[entry.mood].className}`} 
                            title={`Mood: ${entry.mood}`}
                        >
                           <span>{moodConfig[entry.mood].icon}</span>
                        </div>
                    )}
                </div>

                <p className="text-xs text-stone-500 line-clamp-2 mb-2 h-8">
                  {entry.content || "No content..."}
                </p>
                <div className="flex justify-between items-center pt-2 border-t border-stone-100/50 mt-1">
                  <span className="text-[10px] uppercase tracking-wider text-stone-400 font-medium">
                    {dateStr}
                  </span>
                  
                  {/* Delete Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // Crucial: Stop event from bubbling to parent div
                      onDelete(e, entry.id);
                    }}
                    className={`
                        relative z-20 p-2 -mr-2 rounded-lg transition-all duration-200
                        text-stone-400 hover:text-red-600 hover:bg-red-50
                        opacity-100 md:opacity-0 md:group-hover:opacity-100
                        ${isActive ? 'md:opacity-100' : ''}
                        active:bg-red-100
                    `}
                    title="Delete Entry"
                    aria-label="Delete entry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer / Login Section */}
      <div className="p-4 border-t border-stone-100 bg-stone-50/50">
        {isLoggedIn ? (
          <div className="flex flex-col space-y-2">
             <div className="flex items-center justify-between text-xs font-medium text-green-600 bg-green-50 px-3 py-2 rounded-lg border border-green-100">
                <div className="flex items-center space-x-2">
                  <Cloud className="w-3 h-3" />
                  <span>Sync Active</span>
                </div>
                <button onClick={onLogout} title="Sign Out" className="text-green-700 hover:text-green-900">
                  <LogOut className="w-3 h-3" />
                </button>
             </div>
             <div className="flex justify-between items-center">
               <p className="text-[10px] text-stone-400">Saved to ZenJournal</p>
               <button onClick={onResetConfig} className="text-[10px] text-stone-400 underline hover:text-stone-600">Settings</button>
             </div>
          </div>
        ) : (
          <div className="flex flex-col space-y-3">
            <button 
              onClick={onLogin}
              className="w-full flex items-center justify-center space-x-2 py-2.5 bg-white border border-stone-200 hover:bg-stone-50 text-stone-600 rounded-lg transition-all text-xs font-semibold shadow-sm"
            >
              <CloudOff className="w-3 h-3" />
              <span>Connect Google Drive</span>
            </button>
            <div className="text-center">
               <button onClick={onResetConfig} className="text-[10px] text-stone-400 flex items-center justify-center w-full hover:text-stone-600">
                  <Settings className="w-3 h-3 mr-1" /> Configure Client ID
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
