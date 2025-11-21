
export type Mood = 'Great' | 'Good' | 'Okay' | 'Bad';

export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  mood?: Mood;
  createdAt: number;
  updatedAt: number;
  images: JournalImage[];
}

export interface JournalImage {
  id: string;
  data: string; // Base64 string for simplicity in rendering
  mimeType: string;
}

export interface SaveStatus {
  state: 'idle' | 'saving' | 'saved' | 'error';
  lastSaved?: Date;
}
