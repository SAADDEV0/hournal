
import React, { useEffect, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Download, X } from 'lucide-react';
import { JournalEntry, JournalImage, Mood } from '../types';

interface JournalEditorProps {
  entry: JournalEntry;
  onUpdate: (updatedEntry: JournalEntry) => void;
  isSaving: boolean;
}

export const JournalEditor: React.FC<JournalEditorProps> = ({ entry, onUpdate, isSaving }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fullScreenImage, setFullScreenImage] = useState<JournalImage | null>(null);

  const moods: { value: Mood, label: string, icon: string }[] = [
    { value: 'Great', label: 'Great', icon: '😁' },
    { value: 'Good', label: 'Good', icon: '🙂' },
    { value: 'Okay', label: 'Okay', icon: '😐' },
    { value: 'Bad', label: 'Bad', icon: '☹️' },
  ];

  // Handle Title Change
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate({ ...entry, title: e.target.value, updatedAt: Date.now() });
  };

  // Handle Content Change
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onUpdate({ ...entry, content: e.target.value, updatedAt: Date.now() });
  };

  // Handle Mood Change
  const handleMoodChange = (mood: Mood) => {
    onUpdate({ ...entry, mood, updatedAt: Date.now() });
  };

  // Handle Image Upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const newImage: JournalImage = {
        id: Date.now().toString(),
        data: base64,
        mimeType: file.type
      };
      
      onUpdate({
        ...entry,
        images: [...entry.images, newImage],
        updatedAt: Date.now()
      });
    };
    reader.readAsDataURL(file);
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Remove Image
  const removeImage = (imageId: string) => {
    onUpdate({
      ...entry,
      images: entry.images.filter(img => img.id !== imageId),
      updatedAt: Date.now()
    });
  };

  // Download single image
  const downloadImage = (img: JournalImage) => {
    const link = document.createElement('a');
    link.href = img.data;
    // Simple extension guess
    const ext = img.mimeType.split('/')[1] || 'png';
    link.download = `journal-photo-${img.id}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Download entry as text file
  const downloadAsFile = () => {
    const moodStr = entry.mood ? `Mood: ${entry.mood}\n` : '';
    const textContent = `Title: ${entry.title}\nDate: ${new Date(entry.createdAt).toLocaleString()}\n${moodStr}\n${entry.content}`;
    const element = document.createElement("a");
    const file = new Blob([textContent], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `${entry.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'journal'}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Date Formatter for Morocco
  const formattedDate = new Date(entry.createdAt).toLocaleDateString('en-GB', { 
    timeZone: 'Africa/Casablanca',
    weekday: 'long', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full bg-paper shadow-sm min-h-screen md:min-h-0 relative">
      
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-sm border-b border-stone-100 px-8 py-4 flex justify-between items-center">
        <div className="text-xs font-medium text-stone-400 uppercase tracking-widest">
          {formattedDate}
        </div>
        
        <div className="flex items-center space-x-3">
          {isSaving ? (
             <span className="text-xs text-stone-400 animate-pulse">Saving...</span>
          ) : (
            <span className="flex items-center text-stone-300 text-xs">
               <Check className="w-3 h-3 mr-1" /> Saved
            </span>
          )}
          
          <div className="h-4 w-px bg-stone-200 mx-2"></div>

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-2 hover:bg-stone-100 text-stone-500 rounded-full transition-colors"
            title="Add Image"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImageUpload} 
            accept="image/*" 
            className="hidden" 
          />

          <button 
            onClick={downloadAsFile}
            className="p-2 hover:bg-stone-100 text-stone-500 rounded-full transition-colors"
            title="Download Entry as .txt"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-grow overflow-y-auto px-8 py-8 md:px-12">
        
        {/* Mood Selector */}
        <div className="flex space-x-2 mb-6">
            {moods.map((m) => (
            <button
                key={m.value}
                onClick={() => handleMoodChange(m.value)}
                className={`
                flex items-center space-x-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 transform active:scale-95
                ${entry.mood === m.value 
                    ? 'bg-stone-800 text-white shadow-md scale-105 ring-2 ring-stone-200 ring-offset-2' 
                    : 'bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700'
                }
                `}
            >
                <span className="text-base">{m.icon}</span>
                <span>{m.label}</span>
            </button>
            ))}
        </div>

        {/* Title Input */}
        <input
          type="text"
          value={entry.title}
          onChange={handleTitleChange}
          placeholder="Untitled Entry"
          className="w-full text-3xl md:text-4xl font-serif font-bold text-ink bg-transparent border-none focus:outline-none placeholder-stone-300 mb-6"
        />

        {/* Body Text */}
        <textarea
          value={entry.content}
          onChange={handleContentChange}
          placeholder="Start writing..."
          className="w-full h-[60vh] resize-none bg-transparent text-lg leading-relaxed font-serif text-stone-800 placeholder-stone-300 focus:outline-none"
          spellCheck={false}
        />

        {/* Image Grid */}
        {entry.images.length > 0 && (
          <div className="mt-8 pt-8 border-t border-stone-100">
            <h3 className="text-xs font-bold uppercase text-stone-400 mb-4 tracking-wider">Attachments</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {entry.images.map((img) => (
                <div 
                  key={img.id} 
                  onClick={() => setFullScreenImage(img)}
                  className="group relative aspect-square rounded-lg overflow-hidden bg-stone-100 shadow-sm ring-1 ring-stone-200 cursor-zoom-in"
                >
                  <img 
                    src={img.data} 
                    alt="Attachment" 
                    className="w-full h-full object-cover"
                  />
                  {/* Hover Overlay with Delete Button */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(img.id);
                      }}
                      className="p-2 bg-white rounded-full shadow-md text-red-500 hover:bg-red-50"
                      title="Remove Image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Full Screen Image Modal */}
      {fullScreenImage && (
        <div 
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setFullScreenImage(null)}
        >
            {/* Close Button */}
            <button 
                onClick={() => setFullScreenImage(null)}
                className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white rounded-full transition-all"
            >
                <X className="w-8 h-8" />
            </button>

            {/* Image */}
            <img 
                src={fullScreenImage.data} 
                alt="Full screen view" 
                className="max-w-full max-h-[80vh] object-contain shadow-2xl rounded-sm"
                onClick={(e) => e.stopPropagation()} 
            />

            {/* Actions */}
            <div className="mt-8 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                 <button 
                    onClick={() => downloadImage(fullScreenImage)}
                    className="flex items-center space-x-2 bg-white text-stone-900 px-6 py-3 rounded-full font-medium shadow-lg hover:bg-stone-100 hover:scale-105 transition-all active:scale-95"
                >
                    <Download className="w-5 h-5" />
                    <span>Download Photo</span>
                </button>
            </div>
        </div>
      )}
    </div>
  );
};
