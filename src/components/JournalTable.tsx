
import React, { useState } from 'react';
import { JournalEntry, Mood } from '../types';
import { Search, Calendar, Smile, Image as ImageIcon, Edit2, Trash2, FileText, ArrowUpDown } from 'lucide-react';

interface JournalTableProps {
  entries: JournalEntry[];
  onSelect: (entry: JournalEntry) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}

export const JournalTable: React.FC<JournalTableProps> = ({ entries, onSelect, onDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [moodFilter, setMoodFilter] = useState<Mood | 'All'>('All');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Filter & Sort
  const filteredEntries = entries
    .filter(entry => {
      const matchesSearch = 
        entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.content.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesMood = moodFilter === 'All' || entry.mood === moodFilter;
      return matchesSearch && matchesMood;
    })
    .sort((a, b) => {
      return sortDir === 'asc' 
        ? a.createdAt - b.createdAt 
        : b.createdAt - a.createdAt;
    });

  const moodIcons: Record<string, string> = {
    'Great': '😁',
    'Good': '🙂',
    'Okay': '😐',
    'Bad': '☹️'
  };

  return (
    <div className="flex flex-col h-full bg-paper overflow-hidden animate-in fade-in duration-300">
      
      {/* Table Toolbar */}
      <div className="p-6 border-b border-stone-200 bg-white flex flex-col md:flex-row gap-4 justify-between items-center sticky top-0 z-10 shadow-sm">
        <h2 className="text-2xl font-serif font-bold text-ink flex items-center">
            <span className="mr-2">📊</span> Sheet View
        </h2>
        
        <div className="flex gap-3 w-full md:w-auto">
            {/* Search */}
            <div className="relative flex-grow md:flex-grow-0 md:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-stone-400 w-4 h-4" />
                <input 
                    type="text" 
                    placeholder="Filter title or content..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-400 focus:ring-1 focus:ring-stone-200"
                />
            </div>

            {/* Mood Filter */}
            <select 
                value={moodFilter}
                onChange={(e) => setMoodFilter(e.target.value as Mood | 'All')}
                className="px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-stone-400 cursor-pointer"
            >
                <option value="All">All Moods</option>
                <option value="Great">😁 Great</option>
                <option value="Good">🙂 Good</option>
                <option value="Okay">😐 Okay</option>
                <option value="Bad">☹️ Bad</option>
            </select>
        </div>
      </div>

      {/* Table Area */}
      <div className="flex-grow overflow-auto p-6">
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-stone-50 border-b border-stone-200 text-xs font-bold text-stone-500 uppercase tracking-wider">
                        <th className="p-4 w-32 cursor-pointer hover:bg-stone-100 transition-colors group" onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')}>
                            <div className="flex items-center">
                                <Calendar className="w-3 h-3 mr-1" /> Date
                                <ArrowUpDown className={`w-3 h-3 ml-1 opacity-0 group-hover:opacity-50 ${sortDir === 'asc' ? 'rotate-180' : ''} transition-transform`} />
                            </div>
                        </th>
                        <th className="p-4 w-24">
                            <div className="flex items-center">
                                <Smile className="w-3 h-3 mr-1" /> Mood
                            </div>
                        </th>
                        <th className="p-4 w-1/4">Title</th>
                        <th className="p-4">
                            <div className="flex items-center">
                                <FileText className="w-3 h-3 mr-1" /> Content Preview
                            </div>
                        </th>
                        <th className="p-4 w-24">
                             <div className="flex items-center">
                                <ImageIcon className="w-3 h-3 mr-1" /> Media
                            </div>
                        </th>
                        <th className="p-4 w-24 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-sm text-stone-700">
                    {filteredEntries.length === 0 ? (
                        <tr>
                            <td colSpan={6} className="p-12 text-center text-stone-400">
                                No entries found matching your filters.
                            </td>
                        </tr>
                    ) : (
                        filteredEntries.map(entry => (
                            <tr 
                                key={entry.id} 
                                className="hover:bg-stone-50 transition-colors group cursor-pointer"
                                onClick={() => onSelect(entry)}
                            >
                                <td className="p-4 font-mono text-xs text-stone-500 whitespace-nowrap">
                                    {new Date(entry.createdAt).toLocaleDateString('en-GB', { 
                                        year: 'numeric', month: '2-digit', day: '2-digit' 
                                    })}
                                </td>
                                <td className="p-4">
                                    {entry.mood ? (
                                        <span className="text-lg" title={entry.mood}>{moodIcons[entry.mood]}</span>
                                    ) : (
                                        <span className="text-stone-300">-</span>
                                    )}
                                </td>
                                <td className="p-4 font-semibold text-stone-900">
                                    {entry.title || <span className="italic text-stone-400">Untitled</span>}
                                </td>
                                <td className="p-4 text-stone-500 max-w-md truncate">
                                    {entry.content || "-"}
                                </td>
                                <td className="p-4">
                                    {entry.images.length > 0 ? (
                                        <div className="flex items-center space-x-1">
                                            <img 
                                                src={entry.images[0].data} 
                                                alt="thumbnail" 
                                                className="w-8 h-8 rounded object-cover border border-stone-200 shadow-sm"
                                            />
                                            {entry.images.length > 1 && (
                                                <span className="text-xs font-bold text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded-full">
                                                    +{entry.images.length - 1}
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-stone-300">-</span>
                                    )}
                                </td>
                                <td className="p-4 text-right">
                                    <div className="flex items-center justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); onSelect(entry); }}
                                            className="p-1.5 hover:bg-white hover:text-blue-600 text-stone-400 rounded-md border border-transparent hover:border-stone-200 shadow-sm"
                                            title="Edit"
                                        >
                                            <Edit2 className="w-3 h-3" />
                                        </button>
                                        <button 
                                            onClick={(e) => onDelete(e, entry.id)}
                                            className="p-1.5 hover:bg-red-50 hover:text-red-600 text-stone-400 rounded-md border border-transparent hover:border-red-100 shadow-sm"
                                            title="Delete"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};
